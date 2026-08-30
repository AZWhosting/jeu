/* Neon Four — puissance 4 contre une IA. Le plateau ne bouge qu'entre deux
   coups : la boucle du socle ne sert qu'à la chute des jetons. L'adversaire
   explore l'arbre des coups en minimax avec élagage alpha-bêta. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.four;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/four/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Four : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  /* ------------------------------------------------------------------ */
  /* Constantes                                                          */
  /* ------------------------------------------------------------------ */

  var COLS = 7, ROWS = 6, LINE = 4;
  var YOU = 1, AI = 2;
  var ORDER = [3, 2, 4, 1, 5, 0, 6];    // colonnes du centre d'abord : meilleur élagage
  var DROP_SPEED = 3.4;                 // hauteurs de case par seconde… au carré
  var THINK_MS = 320;                   // temps de réflexion affiché avant le coup de l'IA
  var MOVE_POINTS = 10;
  var RESTART_GRACE = 700;
  var WIN_SCORE = 100000;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';                   // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var grid, turn, cursor, busy, drop, winning, history, particles;
  var score, moves, alternateStart;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function at(g, x, y) { return g[y * COLS + x]; }

  function firstPlayer() {
    var setting = progress.getSetting('first');
    if (setting === 'ai') { return AI; }
    if (setting === 'alternate') { return alternateStart ? AI : YOU; }
    return YOU;
  }

  function resetRun() {
    grid = new Array(COLS * ROWS).fill(0);
    cursor = 3;
    busy = false;
    drop = null;
    winning = null;
    history = [];
    particles = [];
    score = 0;
    moves = 0;
    run = progress.newRun(difficulty);
    runStartedAt = performance.now();
    runCommitted = false;
    turn = firstPlayer();
    renderHud();
    if (turn === AI) { scheduleAi(); }
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function dropRow(g, col) {
    for (var y = ROWS - 1; y >= 0; y--) { if (!at(g, col, y)) { return y; } }
    return -1;                          // colonne pleine
  }

  function validColumns(g) {
    return ORDER.filter(function (c) { return dropRow(g, c) >= 0; });
  }

  /* Renvoie les quatre cases alignées passant par (x, y), ou null. */
  function lineThrough(g, x, y) {
    var disc = at(g, x, y);
    if (!disc) { return null; }
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var d = 0; d < dirs.length; d++) {
      var dx = dirs[d][0], dy = dirs[d][1];
      var cells = [[x, y]];
      [-1, 1].forEach(function (sign) {
        var nx = x + dx * sign, ny = y + dy * sign;
        while (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && at(g, nx, ny) === disc) {
          cells.push([nx, ny]);
          nx += dx * sign;
          ny += dy * sign;
        }
      });
      if (cells.length >= LINE) { return cells; }
    }
    return null;
  }

  function isFull(g) { return g.every(function (v) { return v !== 0; }); }

  /* ------------------------------------------------------------------ */
  /* L'adversaire                                                        */
  /* ------------------------------------------------------------------ */

  /* Chaque fenêtre de quatre cases vaut d'autant plus qu'elle est proche
     d'être complète, et rien si les deux camps s'y mélangent. */
  function windowScore(cells, disc) {
    var mine = 0, theirs = 0, empty = 0;
    cells.forEach(function (v) {
      if (v === disc) { mine++; }
      else if (v === 0) { empty++; }
      else { theirs++; }
    });
    if (mine && theirs) { return 0; }
    if (mine === 4) { return 500; }
    if (mine === 3 && empty === 1) { return 50; }
    if (mine === 2 && empty === 2) { return 8; }
    if (theirs === 3 && empty === 1) { return -60; }   // menace adverse : à traiter
    if (theirs === 2 && empty === 2) { return -6; }
    return 0;
  }

  function evaluate(g, disc) {
    var total = 0;
    // La colonne centrale ouvre plus d'alignements : elle vaut un bonus.
    for (var y = 0; y < ROWS; y++) { if (at(g, 3, y) === disc) { total += 6; } }

    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var yy = 0; yy < ROWS; yy++) {
      for (var xx = 0; xx < COLS; xx++) {
        for (var d = 0; d < dirs.length; d++) {
          var dx = dirs[d][0], dy = dirs[d][1];
          var ex = xx + dx * 3, ey = yy + dy * 3;
          if (ex < 0 || ey < 0 || ex >= COLS || ey >= ROWS) { continue; }
          var cells = [];
          for (var k = 0; k < LINE; k++) { cells.push(at(g, xx + dx * k, yy + dy * k)); }
          total += windowScore(cells, disc);
        }
      }
    }
    return total;
  }

  function terminalFor(g, col, row) {
    var line = lineThrough(g, col, row);
    return line ? line : null;
  }

  function negamax(g, depth, alpha, beta, disc, lastCol, lastRow) {
    if (lastCol >= 0 && terminalFor(g, lastCol, lastRow)) {
      // Le coup précédent a gagné : c'est mauvais pour celui qui doit jouer.
      return -(WIN_SCORE + depth);
    }
    var options = validColumns(g);
    if (!options.length) { return 0; }
    if (depth === 0) { return evaluate(g, disc); }

    var bestValue = -Infinity;
    for (var i = 0; i < options.length; i++) {
      var col = options[i];
      var row = dropRow(g, col);
      g[row * COLS + col] = disc;
      var value = -negamax(g, depth - 1, -beta, -alpha, disc === YOU ? AI : YOU, col, row);
      g[row * COLS + col] = 0;
      if (value > bestValue) { bestValue = value; }
      if (bestValue > alpha) { alpha = bestValue; }
      if (alpha >= beta) { break; }               // élagage
    }
    return bestValue;
  }

  function chooseColumn() {
    var options = validColumns(grid);
    if (!options.length) { return -1; }
    var c = conf();

    // Un coup gagnant immédiat se prend toujours ; une défaite immédiate
    // se pare toujours — même en mode maladroit.
    for (var i = 0; i < options.length; i++) {
      var row = dropRow(grid, options[i]);
      grid[row * COLS + options[i]] = AI;
      var wins = !!lineThrough(grid, options[i], row);
      grid[row * COLS + options[i]] = 0;
      if (wins) { return options[i]; }
    }
    if (c.depth > 0) {
      for (var j = 0; j < options.length; j++) {
        var r2 = dropRow(grid, options[j]);
        grid[r2 * COLS + options[j]] = YOU;
        var loses = !!lineThrough(grid, options[j], r2);
        grid[r2 * COLS + options[j]] = 0;
        if (loses) { return options[j]; }
      }
    }

    if (c.depth === 0 || Math.random() < (c.blunder || 0)) {
      return options[Math.floor(Math.random() * options.length)];
    }

    var bestValue = -Infinity;
    var bestCol = options[0];
    for (var k = 0; k < options.length; k++) {
      var col = options[k];
      var row2 = dropRow(grid, col);
      grid[row2 * COLS + col] = AI;
      var value = -negamax(grid, c.depth - 1, -Infinity, Infinity, YOU, col, row2);
      grid[row2 * COLS + col] = 0;
      if (value > bestValue) { bestValue = value; bestCol = col; }
    }
    return bestCol;
  }

  function scheduleAi() {
    if (state !== 'playing' && state !== 'menu') { return; }
    busy = true;
    renderHud();
    setTimeout(function () {
      if (state !== 'playing') { busy = false; return; }
      var col = chooseColumn();
      if (col < 0) { busy = false; return; }
      startDrop(col, AI);
    }, THINK_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Coups et chute                                                      */
  /* ------------------------------------------------------------------ */

  function startDrop(col, disc) {
    var row = dropRow(grid, col);
    if (row < 0) { return false; }
    busy = true;
    drop = { col: col, row: row, disc: disc, y: -1, vy: 0 };
    audio.pickup();
    return true;
  }

  function play(col) {
    if (state !== 'playing' || busy || turn !== YOU) { return; }
    if (dropRow(grid, col) < 0) { return; }
    history.push(grid.slice());
    startDrop(col, YOU);
  }

  function land() {
    var col = drop.col, row = drop.row, disc = drop.disc;
    grid[row * COLS + col] = disc;
    drop = null;
    moves++;
    run.moves = moves;
    score += MOVE_POINTS;
    run.score = score;

    var line = lineThrough(grid, col, row);
    if (line) {
      winning = line;
      burst(col, row, disc === YOU ? palette().you : palette().ai, 24);
      finish(disc === YOU ? 'win' : 'loss');
      return;
    }
    if (isFull(grid)) { finish('draw'); return; }

    turn = disc === YOU ? AI : YOU;
    busy = false;
    checkUnlocks();
    renderHud();
    if (turn === AI) { scheduleAi(); }
  }

  /* Zen : revenir sur son coup, et sur la réponse de l'adversaire. */
  function undo() {
    if (!forgiving() || state !== 'playing' || busy || !history.length) { return; }
    grid = history.pop();
    turn = YOU;
    moves = Math.max(0, moves - 2);
    run.moves = moves;
    winning = null;
    floatText(3, 0, 'Coup annulé', '#8b9ac0');
    audio.bonus();
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Issues                                                              */
  /* ------------------------------------------------------------------ */

  function finish(outcome) {
    state = 'over';
    overSince = performance.now();
    busy = false;

    var c = conf();
    if (outcome === 'win') {
      run.wins = 1;
      // Gagner vite rapporte davantage.
      score += c.base + Math.max(0, (42 - moves) * 20);
      audio.unlocked();
    } else if (outcome === 'draw') {
      run.draws = 1;
      score += Math.round(c.base / 3);
      audio.bonus();
    } else {
      audio.fail();
      if (effectsOn()) {
        boardWrap.classList.remove('shake');
        void boardWrap.offsetWidth;
        boardWrap.classList.add('shake');
      }
    }
    run.score = score;

    // En alternance, le prochain premier joueur change.
    if (progress.getSetting('first') === 'alternate') { alternateStart = !alternateStart; }

    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();

    panel.show({
      title: outcome === 'win' ? (beaten ? 'Nouveau record !' : 'Gagné !')
        : outcome === 'draw' ? 'Match nul' : 'Perdu',
      subtitle: outcome === 'win' ? 'Quatre jetons alignés.'
        : outcome === 'draw' ? 'La grille est pleine, personne ne l\'emporte.'
        : 'L\'adversaire a aligné quatre jetons.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Jetons joués',
        extra: moves,
        best: Math.max(best(), score)
      }
    });
  }

  function checkUnlocks() {
    run.durationMs = performance.now() - runStartedAt;
    var fresh = progress.evaluate(run);
    if (!fresh.length) { return; }
    fresh.forEach(function (item) { sheets.toast(item); });
    audio.unlocked();
  }

  function commitRun() {
    if (!run || runCommitted || run.moves === 0) {
      runCommitted = true;
      return null;
    }
    runCommitted = true;
    run.durationMs = performance.now() - runStartedAt;
    run.score = score;
    var result = progress.finishRun(run);
    result.unlocked.forEach(function (item) { sheets.toast(item); });
    if (result.unlocked.length) { audio.unlocked(); }
    return result;
  }

  function quitToHub() {
    commitRun();
    location.href = 'index.html';
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burst(col, row, color, count) {
    if (!effectsOn()) { return; }
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.15;
      particles.push({
        x: g.x + (col + 0.5) * g.cell, y: g.y + (row + 0.5) * g.cell,
        vx: Math.cos(angle) * speed * g.cell, vy: Math.sin(angle) * speed * g.cell,
        life: 1, decay: 0.002 + Math.random() * 0.002,
        size: 1.5 + Math.random() * 2.5, color: color
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= p.decay * dt;
      if (p.life <= 0) { particles.splice(i, 1); }
    }
  }

  function floatText(col, row, text, color) {
    if (!effectsOn()) { return; }
    var g = geometry();
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = ((g.x + (col + 0.5) * g.cell) / loop.size() * 100) + '%';
    el.style.top = ((g.y + (row + 0.5) * g.cell) / loop.size() * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function palette() {
    var skin = progress.currentSkin();
    return skin.palette || manifest.palettes.neon;
  }

  function discColor(disc, col, row) {
    var skin = progress.currentSkin();
    if (skin.rainbow) {
      return disc === YOU
        ? 'hsl(' + ((col * 26 + row * 12) % 360) + ', 85%, 62%)'
        : 'hsl(' + ((col * 26 + row * 12 + 180) % 360) + ', 85%, 66%)';
    }
    return disc === YOU ? palette().you : palette().ai;
  }

  /* Le plateau n'est pas carré : on le centre dans le canvas, en réservant
     une bande au-dessus pour le jeton en attente. */
  function geometry() {
    var size = loop.size();
    var cell = Math.min(size * 0.94 / COLS, size * 0.80 / ROWS);
    return {
      cell: cell,
      x: (size - cell * COLS) / 2,
      y: size - cell * ROWS - size * 0.02,
      size: size
    };
  }

  function columnAt(pos) {
    var g = geometry();
    var col = Math.floor((pos.x * g.size - g.x) / g.cell);
    return col >= 0 && col < COLS ? col : null;
  }

  function roundRect(x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawDisc(cx, cy, r, color, glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow || 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    var size = g.size;
    var r = g.cell * 0.38;
    updateParticles(dt);
    ctx.clearRect(0, 0, size, size);

    // Chute en cours : la case visée reste vide jusqu'à l'atterrissage.
    if (drop) {
      drop.vy += DROP_SPEED * (dt / 1000) * 60 * 0.02;
      drop.y += drop.vy;
      if (drop.y >= drop.row) { drop.y = drop.row; land(); }
    }

    // Jeton en attente au-dessus de la colonne visée.
    if (state === 'playing' && !drop && turn === YOU && !busy) {
      drawDisc(g.x + (cursor + 0.5) * g.cell, g.y - g.cell * 0.55, r * 0.8,
               discColor(YOU, cursor, 0), 18);
    }
    if (drop) {
      drawDisc(g.x + (drop.col + 0.5) * g.cell, g.y + (drop.y + 0.5) * g.cell, r,
               discColor(drop.disc, drop.col, Math.round(drop.y)), 16);
    }

    // Le plateau : une plaque percée de trous, dessinée par-dessus les jetons
    // pour que la chute passe derrière.
    ctx.fillStyle = palette().board;
    roundRect(g.x, g.y, g.cell * COLS, g.cell * ROWS, g.cell * 0.18);
    ctx.fill();

    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var cx = g.x + (x + 0.5) * g.cell;
        var cy = g.y + (y + 0.5) * g.cell;
        var disc = at(grid, x, y);

        // Le trou est découpé dans la plaque : on le remplit du fond.
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (disc) { drawDisc(cx, cy, r, discColor(disc, x, y), 12); }
      }
    }

    // Colonne visée et colonnes pleines.
    if (state === 'playing') {
      ctx.strokeStyle = 'rgba(232, 238, 252, 0.35)';
      ctx.lineWidth = Math.max(1.5, g.cell * 0.04);
      roundRect(g.x + cursor * g.cell + 2, g.y + 2, g.cell - 4, g.cell * ROWS - 4, g.cell * 0.16);
      ctx.stroke();

      if (progress.getSetting('hints')) {
        ctx.fillStyle = 'rgba(10, 16, 24, 0.45)';
        for (var c = 0; c < COLS; c++) {
          if (dropRow(grid, c) < 0) {
            roundRect(g.x + c * g.cell, g.y, g.cell, g.cell * ROWS, g.cell * 0.16);
            ctx.fill();
          }
        }
      }
    }

    // Alignement gagnant.
    if (winning) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = Math.max(2, g.cell * 0.09);
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 18;
      var a = winning[0], b = winning[winning.length - 1];
      ctx.beginPath();
      ctx.moveTo(g.x + (a[0] + 0.5) * g.cell, g.y + (a[1] + 0.5) * g.cell);
      ctx.lineTo(g.x + (b[0] + 0.5) * g.cell, g.y + (b[1] + 0.5) * g.cell);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.save();
    particles.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: state !== 'playing' ? '—' : (busy || turn === AI ? 'Adversaire' : 'Toi'),
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Jetons',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : moves
    });
  }

  function startGame() {
    audio.unlock();
    commitRun();
    resetRun();
    state = 'playing';
    loop.resetClock();
    panel.hide();
    renderHud();
    if (turn === AI) { scheduleAi(); }
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      panel.show({ title: 'Pause', subtitle: 'Reprends quand tu veux.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      loop.resetClock();
      panel.hide();
      if (turn === AI && !drop) { scheduleAi(); }
    }
  }

  function guardedStart() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return true; }
    if (state === 'menu' || state === 'over') { startGame(); return true; }
    return false;
  }

  function onDirection(dx, dy) {
    if (guardedStart()) { return; }
    if (state !== 'playing') { return; }
    if (dx) { cursor = clamp(cursor + dx, 0, COLS - 1); }
    if (dy > 0) { play(cursor); }        // vers le bas : on lâche le jeton
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { play(cursor); }
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  hud = Core.createHud(progress);
  panel = Core.createPanel(function () {
    if (state === 'paused') { togglePause(); } else { startGame(); }
  }, function () { quitToHub(); });

  sheets = Core.createSheets(progress, {
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* le rendu suivant lit déjà la nouvelle palette */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // rien n'avance seul : la chute est animée au rendu
    render: draw
  });
  ctx = loop.ctx;

  Core.attachInput({
    canvas: canvas,
    dpad: $('dpad'),
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onDirection: onDirection,
    onAction: action,
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    onPointer: function (pos) {
      var col = columnAt(pos);
      if (col !== null) { cursor = col; }
    },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var col = columnAt(pos);
      if (col !== null) { cursor = col; play(col); }
    },
    keys: { u: undo }
  });

  toolbar = Core.wireToolbar({
    progress: progress,
    sheets: sheets,
    onPause: function () { if (state === 'playing' || state === 'paused') { togglePause(); } },
    onRestart: startGame,
    onQuit: quitToHub,
    onSoundOn: function () { audio.unlock(); audio.pickup(); },
    isPlaying: function () { return state === 'playing'; }
  });

  picker = Core.createDifficultyPicker(progress, function (id) {
    difficulty = id;
    if (run && (state === 'menu' || state === 'over')) {
      resetRun();
      state = 'menu';
    }
    renderHud();
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  window.__neonFour = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        turn: turn === YOU ? 'you' : 'ai',
        busy: busy,
        dropping: !!drop,
        cursor: cursor,
        moves: moves,
        score: score,
        grid: grid.slice(),
        winning: winning ? winning.slice() : null,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : poser une position et faire jouer un camp.
    setGrid: function (values) { grid = values.slice(); winning = null; renderHud(); },
    play: function (col) { play(col); },
    aiColumn: function () { return chooseColumn(); },
    setTurn: function (who) {
      turn = who === 'ai' ? AI : YOU;
      busy = false;
      renderHud();
      // Rendre la main à l'adversaire, c'est le faire jouer.
      if (turn === AI && state === 'playing') { scheduleAi(); }
    },
    undo: undo
  };
  window.Progress = progress;
  window.Sheets = sheets;

  Core.Shell.dress(manifest);
  hud.set({ sideLabel: manifest.sideLabel });
  Core.applyTheme(progress);
  loop.resize();
  alternateStart = false;
  resetRun();
  picker.select(difficulty);
  state = 'menu';
  loop.start();
}());
