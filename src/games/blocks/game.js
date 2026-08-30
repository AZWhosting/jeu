/* Neon Blocks — pièces qui tombent. La gravité utilise la boucle à pas fixe du
   socle, dont la durée d'un tick est la vitesse de descente du moment. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.blocks;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/blocks/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Blocks : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  /* ------------------------------------------------------------------ */
  /* Constantes                                                          */
  /* ------------------------------------------------------------------ */

  var COLS = 10, ROWS = 20;
  var LOCK_MS = 420;            // répit avant qu'une pièce posée ne se fige
  var CLEAR_MS = 180;           // éclair sur les lignes complétées
  var SOFT_POINTS = 1, HARD_POINTS = 2;
  var LINE_POINTS = [0, 100, 300, 500, 800];
  var KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
  var RESTART_GRACE = 700;

  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var board, piece, bag, queue, hold, holdUsed;
  var score, lines, level, lockTimer, clearing, particles, elapsed;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function cellOf(x, y) { return board[y * COLS + x]; }

  function refillBag() {
    // Sac de sept : chaque pièce revient une fois par tour, sans série cruelle.
    var pool = TYPES.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    bag = bag.concat(pool);
  }

  function nextType() {
    if (bag.length < 8) { refillBag(); }
    return bag.shift();
  }

  function spawn(type) {
    var shape = SHAPES[type].map(function (row) { return row.slice(); });
    var p = {
      type: type,
      shape: shape,
      color: TYPES.indexOf(type),
      x: Math.floor((COLS - shape.length) / 2),
      y: type === 'I' ? -1 : 0
    };
    return p;
  }

  function resetRun() {
    board = new Array(COLS * ROWS).fill(0);
    bag = [];
    queue = [];
    refillBag();
    for (var i = 0; i < 3; i++) { queue.push(nextType()); }
    hold = null;
    holdUsed = false;
    score = 0;
    lines = 0;
    level = conf().start;
    lockTimer = 0;
    clearing = null;
    particles = [];
    elapsed = 0;
    run = progress.newRun(difficulty);
    run.maxLevel = level;
    runStartedAt = performance.now();
    runCommitted = false;
    piece = spawn(queue.shift());
    queue.push(nextType());
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function collides(shape, px, py) {
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) { continue; }
        var x = px + c, y = py + r;
        if (x < 0 || x >= COLS || y >= ROWS) { return true; }
        if (y >= 0 && cellOf(x, y)) { return true; }
      }
    }
    return false;
  }

  function move(dx, dy) {
    if (!piece || collides(piece.shape, piece.x + dx, piece.y + dy)) { return false; }
    piece.x += dx;
    piece.y += dy;
    if (dx) { lockTimer = 0; }          // glisser au sol relance le répit
    return true;
  }

  function rotated(shape) {
    return shape[0].map(function (_, i) {
      return shape.map(function (row) { return row[i]; }).reverse();
    });
  }

  /* Rotation avec rattrapage : si la pièce ne tient pas, on l'essaie décalée. */
  function rotate() {
    if (!piece || piece.type === 'O') { return false; }
    var shape = rotated(piece.shape);
    for (var i = 0; i < KICKS.length; i++) {
      var kx = KICKS[i][0], ky = KICKS[i][1];
      if (!collides(shape, piece.x + kx, piece.y + ky)) {
        piece.shape = shape;
        piece.x += kx;
        piece.y += ky;
        lockTimer = 0;
        audio.pickup();
        return true;
      }
    }
    return false;
  }

  function ghostY() {
    var y = piece.y;
    while (!collides(piece.shape, piece.x, y + 1)) { y++; }
    return y;
  }

  function hardDrop() {
    if (!piece || clearing) { return; }
    var target = ghostY();
    score += (target - piece.y) * HARD_POINTS;
    piece.y = target;
    lockPiece();
  }

  function softDrop() {
    if (!piece || clearing) { return; }
    if (move(0, 1)) { score += SOFT_POINTS; run.score = score; renderHud(); }
    else { lockPiece(); }
  }

  function swapHold() {
    if (!piece || holdUsed || clearing || state !== 'playing') { return; }
    var current = piece.type;
    if (hold) {
      piece = spawn(hold);
    } else {
      piece = spawn(queue.shift());
      queue.push(nextType());
    }
    hold = current;
    holdUsed = true;
    lockTimer = 0;
    audio.pickup();
  }

  function fullRows() {
    var full = [];
    for (var y = 0; y < ROWS; y++) {
      var complete = true;
      for (var x = 0; x < COLS; x++) { if (!cellOf(x, y)) { complete = false; break; } }
      if (complete) { full.push(y); }
    }
    return full;
  }

  function lockPiece() {
    for (var r = 0; r < piece.shape.length; r++) {
      for (var c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) { continue; }
        var y = piece.y + r;
        if (y < 0) { continue; }                    // débordement par le haut
        board[y * COLS + (piece.x + c)] = piece.color + 1;
      }
    }
    run.pieces++;
    audio.pickup();

    var full = fullRows();
    if (full.length) {
      clearing = { rows: full, until: performance.now() + CLEAR_MS };
      full.forEach(function (y) { burstRow(y); });
      if (full.length === 4) { run.quads++; audio.unlocked(); } else { audio.chain(full.length); }
      return;
    }
    nextPiece();
  }

  function applyClear() {
    var rows = clearing.rows;
    clearing = null;

    // On retire les lignes complètes et on fait retomber le reste.
    var kept = [];
    for (var y = 0; y < ROWS; y++) {
      if (rows.indexOf(y) === -1) { kept.push(board.slice(y * COLS, y * COLS + COLS)); }
    }
    while (kept.length < ROWS) { kept.unshift(new Array(COLS).fill(0)); }
    board = [].concat.apply([], kept);

    lines += rows.length;
    run.lines = lines;
    score += LINE_POINTS[rows.length] * level;
    run.score = score;

    var newLevel = conf().start + Math.floor(lines / 10);
    if (newLevel > level) {
      level = newLevel;
      run.maxLevel = Math.max(run.maxLevel, level);
      floatText('Niveau ' + level, '#ffd166');
      audio.unlocked();
    }
    checkUnlocks();
    renderHud();
    nextPiece();
  }

  function nextPiece() {
    holdUsed = false;
    lockTimer = 0;
    piece = spawn(queue.shift());
    queue.push(nextType());

    if (collides(piece.shape, piece.x, piece.y)) {
      if (forgiving()) { evaporate(); return; }
      gameOver(performance.now());
    }
  }

  /* Mode zen : plutôt que de perdre, le haut de la pile s'évapore. */
  function evaporate() {
    var top = ROWS;
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) { if (cellOf(x, y)) { top = Math.min(top, y); break; } }
      if (top < ROWS) { break; }
    }
    for (var r = top; r < Math.min(ROWS, top + 4); r++) {
      burstRow(r);
      for (var c = 0; c < COLS; c++) { board[r * COLS + c] = 0; }
    }
    floatText('Évaporation', '#8b9ac0');
    audio.bonus();
    piece = spawn(queue.shift());
    queue.push(nextType());
  }

  /* ------------------------------------------------------------------ */
  /* Boucle                                                              */
  /* ------------------------------------------------------------------ */

  function tickDuration() {
    var c = conf();
    return Math.max(c.min, c.base - (level - 1) * c.step);
  }

  function step(now) {
    elapsed += tickDuration();

    if (clearing || !piece) { return; }

    if (!collides(piece.shape, piece.x, piece.y + 1)) {
      piece.y++;
      lockTimer = 0;
      return;
    }
    // La pièce touche : elle dispose d'un court répit pour glisser encore.
    lockTimer += tickDuration();
    if (lockTimer >= LOCK_MS) { lockPiece(); }
  }

  /* ------------------------------------------------------------------ */
  /* Fin de partie, succès                                               */
  /* ------------------------------------------------------------------ */

  function checkUnlocks() {
    run.durationMs = performance.now() - runStartedAt;
    var fresh = progress.evaluate(run);
    if (!fresh.length) { return; }
    fresh.forEach(function (item) { sheets.toast(item); });
    audio.unlocked();
  }

  function commitRun() {
    if (!run || runCommitted || run.pieces === 0) {
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

  function gameOver(now) {
    state = 'over';
    overSince = now;
    piece = null;
    audio.fail();
    if (effectsOn()) {
      boardWrap.classList.remove('shake');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('shake');
    }
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'La pile a débordé',
      subtitle: beaten ? 'Tu viens de battre ton meilleur score.'
        : 'Plus de place pour la pièce suivante.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Lignes',
        extra: lines,
        best: Math.max(best(), score)
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burstRow(y) {
    if (!effectsOn()) { return; }
    var g = geometry();
    for (var x = 0; x < COLS; x++) {
      for (var i = 0; i < 2; i++) {
        var angle = Math.random() * Math.PI * 2;
        particles.push({
          x: g.x + (x + 0.5) * g.cell, y: g.y + (y + 0.5) * g.cell,
          vx: Math.cos(angle) * g.cell * 0.12, vy: Math.sin(angle) * g.cell * 0.12,
          life: 1, decay: 0.0025 + Math.random() * 0.002,
          size: 1.5 + Math.random() * 2, color: '#e8eefc'
        });
      }
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

  function floatText(text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = '50%';
    el.style.top = '40%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function colorOf(index, y) {
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((index * 51 + (y || 0) * 9 + elapsed / 60) % 360) + ', 82%, 62%)'; }
    return ramp()[index % ramp().length];
  }

  /* Le puits fait dix cases sur vingt : on le centre, les réserves de part
     et d'autre. */
  function geometry() {
    var size = loop.size();
    var cell = Math.min(size * 0.46 / COLS, size * 0.95 / ROWS);
    return {
      cell: cell,
      x: (size - cell * COLS) / 2,
      y: (size - cell * ROWS) / 2,
      size: size
    };
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

  function drawBlock(px, py, cell, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    roundRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.22);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    roundRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.34, cell * 0.2);
    ctx.fill();
    ctx.restore();
  }

  function drawMini(type, cx, cy, cell) {
    var shape = SHAPES[type];
    var color = colorOf(TYPES.indexOf(type));
    var w = shape[0].length, hgt = shape.length;
    for (var r = 0; r < hgt; r++) {
      for (var c = 0; c < w; c++) {
        if (!shape[r][c]) { continue; }
        drawBlock(cx + (c - w / 2) * cell, cy + (r - hgt / 2) * cell, cell, color);
      }
    }
  }

  function label(text, x, y, size) {
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(size) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    var size = g.size;
    // L'éclair sur les lignes complètes s'éteint à l'heure dite, quel que soit
    // le rythme de la descente.
    if (clearing && now >= clearing.until) { applyClear(); }
    updateParticles(dt);
    ctx.clearRect(0, 0, size, size);

    // Le puits.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    roundRect(g.x - g.cell * 0.15, g.y - g.cell * 0.15,
              g.cell * COLS + g.cell * 0.3, g.cell * ROWS + g.cell * 0.3, g.cell * 0.2);
    ctx.fill();

    ctx.strokeStyle = progress.theme().grid;
    ctx.lineWidth = 1;
    for (var i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.round(g.x + i * g.cell) + 0.5, g.y);
      ctx.lineTo(Math.round(g.x + i * g.cell) + 0.5, g.y + g.cell * ROWS);
      ctx.stroke();
    }

    // La pile.
    for (var y = 0; y < ROWS; y++) {
      var flashing = clearing && clearing.rows.indexOf(y) !== -1;
      for (var x = 0; x < COLS; x++) {
        var v = cellOf(x, y);
        if (!v) { continue; }
        if (flashing) {
          drawBlock(g.x + x * g.cell, g.y + y * g.cell, g.cell, '#ffffff', 0.9);
        } else {
          drawBlock(g.x + x * g.cell, g.y + y * g.cell, g.cell, colorOf(v - 1, y));
        }
      }
    }

    if (piece && !clearing) {
      // Projection au sol.
      if (progress.getSetting('ghost')) {
        var gy = ghostY();
        for (var r2 = 0; r2 < piece.shape.length; r2++) {
          for (var c2 = 0; c2 < piece.shape[r2].length; c2++) {
            if (!piece.shape[r2][c2] || gy + r2 < 0) { continue; }
            ctx.strokeStyle = 'rgba(232, 238, 252, 0.28)';
            ctx.lineWidth = Math.max(1, g.cell * 0.06);
            roundRect(g.x + (piece.x + c2) * g.cell + g.cell * 0.1,
                      g.y + (gy + r2) * g.cell + g.cell * 0.1,
                      g.cell * 0.8, g.cell * 0.8, g.cell * 0.2);
            ctx.stroke();
          }
        }
      }
      for (var r3 = 0; r3 < piece.shape.length; r3++) {
        for (var c3 = 0; c3 < piece.shape[r3].length; c3++) {
          if (!piece.shape[r3][c3] || piece.y + r3 < 0) { continue; }
          drawBlock(g.x + (piece.x + c3) * g.cell, g.y + (piece.y + r3) * g.cell,
                    g.cell, colorOf(piece.color, piece.y + r3));
        }
      }
    }

    // Réserve à gauche, file d'attente à droite.
    var mini = g.cell * 0.55;
    var leftX = g.x / 2;
    label('Réserve', leftX, g.y + g.cell * 0.6, size * 0.026);
    if (hold) { drawMini(hold, leftX, g.y + g.cell * 2.2, mini); }

    var rightX = g.x + g.cell * COLS + (size - (g.x + g.cell * COLS)) / 2;
    label('Suivant', rightX, g.y + g.cell * 0.6, size * 0.026);
    var count = progress.getSetting('preview') === '1' ? 1 : 3;
    for (var q = 0; q < count && q < queue.length; q++) {
      drawMini(queue[q], rightX, g.y + g.cell * (2.2 + q * 2.6), mini);
    }
    label(lines + ' lignes', rightX, g.y + g.cell * ROWS - g.cell * 0.6, size * 0.026);

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
      side: level,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Lignes',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : lines
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
    }
  }

  function guardedStart() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return true; }
    if (state === 'menu' || state === 'over') { startGame(); return true; }
    return false;
  }

  function onDirection(dx, dy) {
    if (guardedStart()) { return; }
    if (state !== 'playing' || clearing) { return; }
    if (dx) { if (move(dx, 0)) { audio.blip(220, 0.03, 'square', 0.03); } return; }
    if (dy > 0) { softDrop(); }
    else { rotate(); }
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { hardDrop(); }
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
    running: function () { return state === 'playing'; },
    duration: tickDuration,
    tick: step,
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
    onTap: function () { if (!guardedStart() && state === 'playing') { hardDrop(); } },
    keys: { c: swapHold }
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

  window.__neonBlocks = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        score: score,
        lines: lines,
        level: level,
        board: board.slice(),
        piece: piece ? { type: piece.type, x: piece.x, y: piece.y, shape: piece.shape } : null,
        ghost: piece ? ghostY() : null,
        queue: queue.slice(),
        hold: hold,
        clearing: !!clearing,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : poser une pile et une pièce précises.
    setBoard: function (rows) {
      board = new Array(COLS * ROWS).fill(0);
      rows.forEach(function (row, y) {
        row.split('').forEach(function (ch, x) { board[y * COLS + x] = ch === '.' ? 0 : 1; });
      });
    },
    setPiece: function (type, x, y) {
      piece = spawn(type);
      piece.x = x;
      if (y !== undefined) { piece.y = y; }
    },
    move: function (dx, dy) { return move(dx, dy); },
    rotate: rotate,
    drop: hardDrop,
    hold: swapHold,
    tick: function () { step(performance.now()); }
  };
  window.Progress = progress;
  window.Sheets = sheets;

  Core.Shell.dress(manifest);
  hud.set({ sideLabel: manifest.sideLabel });
  Core.applyTheme(progress);
  loop.resize();
  resetRun();
  picker.select(difficulty);
  state = 'menu';
  loop.start();
}());
