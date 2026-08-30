/* Neon Mines — démineur. Aucun mouvement continu : le plateau ne change qu'au
   moment où l'on joue. La boucle du socle ne sert donc qu'au rendu et au
   chronomètre. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.mines;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/mines/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Mines : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var FOOTER = 0.07;             // bandeau du chronomètre, en fraction du côté
  var RESTART_GRACE = 700;
  var CELL_POINTS = 10;
  var WIN_BONUS = 500;
  var TIME_BONUS = 600;          // points, moins une par seconde écoulée

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';            // menu | playing | paused | over | won
  var difficulty = progress.difficulty();
  var N, mineCount, mines, revealed, flagged, defused, near;
  var placed, revealedCount, flagCount, cursor, boomAt, elapsedMs;
  var score, particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function idx(x, y) { return y * N + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  function seconds() { return Math.floor(elapsedMs / 1000); }
  function safeCells() { return N * N - mineCount; }

  function resetRun() {
    N = conf().size;
    mineCount = conf().mines;
    mines = new Array(N * N).fill(false);
    revealed = new Array(N * N).fill(false);
    flagged = new Array(N * N).fill(false);
    defused = new Array(N * N).fill(false);
    near = new Array(N * N).fill(0);
    placed = false;
    revealedCount = 0;
    flagCount = 0;
    boomAt = -1;
    elapsedMs = 0;
    score = 0;
    particles = [];
    cursor = { x: Math.floor(N / 2), y: Math.floor(N / 2) };
    run = progress.newRun(difficulty);
    run.winTime = 0;
    runStartedAt = performance.now();
    runCommitted = false;
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Plateau                                                             */
  /* ------------------------------------------------------------------ */

  function neighbours(x, y, visit) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) { continue; }
        var nx = x + dx, ny = y + dy;
        if (inside(nx, ny)) { visit(nx, ny, idx(nx, ny)); }
      }
    }
  }

  /* Les mines sont posées après le premier clic : la case jouée et ses
     voisines en sont exemptées, pour qu'aucune partie ne meure au coup un. */
  function placeMines(safeX, safeY) {
    var forbidden = {};
    if (progress.getSetting('firstSafe') && safeX !== undefined) {
      forbidden[idx(safeX, safeY)] = true;
      neighbours(safeX, safeY, function (nx, ny, i) { forbidden[i] = true; });
    }

    var pool = [];
    for (var i = 0; i < N * N; i++) { if (!forbidden[i]) { pool.push(i); } }
    for (var k = pool.length - 1; k > 0; k--) {           // mélange de Fisher-Yates
      var j = Math.floor(Math.random() * (k + 1));
      var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
    }
    pool.slice(0, Math.min(mineCount, pool.length)).forEach(function (i) { mines[i] = true; });

    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var count = 0;
        neighbours(x, y, function (nx, ny, i) { if (mines[i]) { count++; } });
        near[idx(x, y)] = count;
      }
    }
    placed = true;
  }

  /* Découverte en cascade : les cases sans mine voisine ouvrent leurs voisines. */
  function flood(x, y) {
    var stack = [[x, y]];
    while (stack.length) {
      var cell = stack.pop();
      var i = idx(cell[0], cell[1]);
      if (revealed[i] || flagged[i]) { continue; }
      revealed[i] = true;
      revealedCount++;
      run.cells++;
      score += CELL_POINTS;
      if (near[i] === 0) {
        neighbours(cell[0], cell[1], function (nx, ny, ni) {
          if (!revealed[ni] && !flagged[ni]) { stack.push([nx, ny]); }
        });
      }
    }
  }

  function reveal(x, y) {
    if (state !== 'playing' || !inside(x, y)) { return; }
    var i = idx(x, y);
    if (flagged[i]) { return; }

    if (!placed) { placeMines(x, y); }

    if (revealed[i]) { chord(x, y); return; }

    if (mines[i]) {
      if (forgiving()) {
        // En zen, la mine est désamorcée et comptée comme trouvée.
        defused[i] = true;
        flagged[i] = true;
        flagCount++;
        burst(x, y, '#38f9c3', 14);
        floatText(x, y, 'Désamorcée', '#38f9c3');
        audio.bonus();
        renderHud();
        return;
      }
      boom(x, y);
      return;
    }

    flood(x, y);
    run.maxCells = Math.max(run.maxCells, run.cells);
    run.score = score;
    audio.pickup();
    checkUnlocks();
    renderHud();
    if (revealedCount >= safeCells()) { win(); }
  }

  /* Clic sur un chiffre déjà découvert : si les drapeaux autour correspondent,
     on déblaie le reste. */
  function chord(x, y) {
    var i = idx(x, y);
    if (!near[i]) { return; }
    var flags = 0;
    neighbours(x, y, function (nx, ny, ni) { if (flagged[ni]) { flags++; } });
    if (flags !== near[i]) { return; }

    var boomed = false;
    var targets = [];
    neighbours(x, y, function (nx, ny, ni) {
      if (!revealed[ni] && !flagged[ni]) { targets.push([nx, ny, ni]); }
    });
    targets.forEach(function (t) {
      if (boomed) { return; }
      if (mines[t[2]]) { boomed = true; reveal(t[0], t[1]); }
      else { flood(t[0], t[1]); }
    });
    if (boomed) { return; }

    run.maxCells = Math.max(run.maxCells, run.cells);
    run.score = score;
    renderHud();
    if (revealedCount >= safeCells()) { win(); }
  }

  function toggleFlag(x, y) {
    if (state !== 'playing' || !inside(x, y)) { return; }
    var i = idx(x, y);
    if (revealed[i] || defused[i]) { return; }
    flagged[i] = !flagged[i];
    flagCount += flagged[i] ? 1 : -1;
    if (flagged[i]) { run.flags++; }
    audio.pickup();
    checkUnlocks();
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Issues                                                              */
  /* ------------------------------------------------------------------ */

  function boom(x, y) {
    boomAt = idx(x, y);
    revealed[boomAt] = true;
    state = 'over';
    overSince = performance.now();
    audio.fail();
    burst(x, y, '#ff5d8f', 26);
    if (effectsOn()) {
      boardWrap.classList.remove('shake');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('shake');
    }
    // Toutes les mines apparaissent : on voit ce qu'on a manqué.
    for (var i = 0; i < mines.length; i++) { if (mines[i]) { revealed[i] = true; } }

    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: 'Mine !',
      subtitle: beaten ? 'Record battu malgré tout.' : 'Une case de trop.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Cases révélées',
        extra: revealedCount,
        best: Math.max(best(), score)
      }
    });
  }

  function win() {
    state = 'won';
    overSince = performance.now();
    run.wins = 1;
    run.winTime = seconds();

    // Marquage automatique : les cases restantes sont forcément des mines.
    if (progress.getSetting('autoFlag')) {
      for (var i = 0; i < mines.length; i++) {
        if (!revealed[i] && !flagged[i]) { flagged[i] = true; flagCount++; }
      }
    }

    score += WIN_BONUS + Math.max(0, TIME_BONUS - seconds());
    run.score = score;
    audio.unlocked();
    floatText((N - 1) / 2, (N - 1) / 2, 'Terrain déminé', '#38f9c3');

    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Gagné !',
      subtitle: 'Grille déminée en ' + seconds() + ' s.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Temps',
        extra: seconds() + ' s',
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
    if (!run || runCommitted || (run.cells === 0 && run.flags === 0)) {
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

  function burst(cx, cy, color, count) {
    if (!effectsOn()) { return; }
    var c = cellSize();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.15;
      particles.push({
        x: (cx + 0.5) * c, y: (cy + 0.5) * c,
        vx: Math.cos(angle) * speed * c, vy: Math.sin(angle) * speed * c,
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

  function floatText(cx, cy, text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = (((cx + 0.5) * cellSize()) / loop.size() * 100) + '%';
    el.style.top = (((cy + 0.5) * cellSize()) / loop.size() * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function boardSize() { return loop.size() * (1 - FOOTER); }
  function cellSize() { return boardSize() / N; }

  function cellAt(pos) {
    var c = cellSize();
    var x = Math.floor(pos.x * loop.size() / c);
    var y = Math.floor(pos.y * loop.size() / c);
    return inside(x, y) ? { x: x, y: y } : null;
  }

  function numberColor(value) {
    if (progress.getSetting('numbers') === 'plain') { return '#e8eefc'; }
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((value - 1) * 44) + ', 82%, 65%)'; }
    var ramp = skin.ramp || manifest.ramps.neon;
    return ramp[clamp(value - 1, 0, ramp.length - 1)];
  }

  function coverColor() { return progress.currentSkin().cover || '#1b2740'; }

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

  function drawFlag(cx, cy, c) {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(cx - c * 0.10, cy - c * 0.22);
    ctx.lineTo(cx + c * 0.20, cy - c * 0.08);
    ctx.lineTo(cx - c * 0.10, cy + c * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 238, 252, 0.75)';
    ctx.lineWidth = Math.max(1, c * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - c * 0.10, cy - c * 0.24);
    ctx.lineTo(cx - c * 0.10, cy + c * 0.24);
    ctx.stroke();
  }

  function drawMine(cx, cy, c, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, c * 0.20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, c * 0.055);
    for (var a = 0; a < 4; a++) {
      var angle = a * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * c * 0.30, cy - Math.sin(angle) * c * 0.30);
      ctx.lineTo(cx + Math.cos(angle) * c * 0.30, cy + Math.sin(angle) * c * 0.30);
      ctx.stroke();
    }
  }

  function draw(now, alpha, dt) {
    var size = loop.size();
    var c = cellSize();
    if (state === 'playing' && placed) { elapsedMs += dt; }
    updateParticles(dt);
    ctx.clearRect(0, 0, size, size);

    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = idx(x, y);
        var px = x * c, py = y * c;
        var cx = px + c / 2, cy = py + c / 2;
        var pad = Math.max(1, c * 0.045);

        if (!revealed[i]) {
          ctx.fillStyle = coverColor();
          roundRect(px + pad, py + pad, c - pad * 2, c - pad * 2, c * 0.16);
          ctx.fill();
          // Un liseré clair en haut donne du relief à la case fermée.
          ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
          roundRect(px + pad, py + pad, c - pad * 2, (c - pad * 2) * 0.42, c * 0.16);
          ctx.fill();
          if (flagged[i]) {
            if (defused[i]) { drawMine(cx, cy, c, '#38f9c3'); }
            else { drawFlag(cx, cy, c); }
          }
        } else {
          ctx.fillStyle = i === boomAt ? 'rgba(255, 93, 143, 0.35)' : 'rgba(255, 255, 255, 0.035)';
          roundRect(px + pad, py + pad, c - pad * 2, c - pad * 2, c * 0.16);
          ctx.fill();

          if (mines[i]) {
            drawMine(cx, cy, c, i === boomAt ? '#ff5d8f' : '#8b9ac0');
          } else if (near[i] > 0) {
            ctx.fillStyle = numberColor(near[i]);
            ctx.font = '700 ' + Math.round(c * 0.52) + 'px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(near[i]), cx, cy + c * 0.03);
          }
        }
      }
    }

    // Curseur : repère au clavier, survol à la souris.
    if (state === 'playing' && cursor) {
      ctx.strokeStyle = 'rgba(232, 238, 252, 0.55)';
      ctx.lineWidth = Math.max(1.5, c * 0.05);
      roundRect(cursor.x * c + 2, cursor.y * c + 2, c - 4, c - 4, c * 0.16);
      ctx.stroke();
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

    // Bandeau : chronomètre à gauche, cases restantes à droite.
    var footerY = boardSize() + (size - boardSize()) / 2;
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(size * 0.032) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('⏱ ' + seconds() + ' s', size * 0.02, footerY);
    ctx.textAlign = 'right';
    ctx.fillText(revealedCount + ' / ' + safeCells() + ' cases', size * 0.98, footerY);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: Math.max(0, mineCount - flagCount),
      sideVisible: state !== 'menu',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Mines',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : mineCount
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
      panel.show({ title: 'Pause', subtitle: 'Le chronomètre est arrêté.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      loop.resetClock();
      panel.hide();
    }
  }

  function idle() { return state === 'menu' || state === 'over' || state === 'won'; }

  function guardedStart() {
    if ((state === 'over' || state === 'won') && performance.now() - overSince < RESTART_GRACE) { return true; }
    if (idle()) { startGame(); return true; }
    return false;
  }

  function moveCursor(dx, dy) {
    if (guardedStart()) { return; }
    if (state !== 'playing') { return; }
    cursor.x = clamp(cursor.x + dx, 0, N - 1);
    cursor.y = clamp(cursor.y + dy, 0, N - 1);
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { reveal(cursor.x, cursor.y); }
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
    running: function () { return false; },   // le plateau ne bouge qu'au coup joué
    render: draw
  });
  ctx = loop.ctx;

  Core.attachInput({
    canvas: canvas,
    dpad: $('dpad'),
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onDirection: moveCursor,
    onAction: action,
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    onPointer: function (pos) {
      var cell = cellAt(pos);
      if (cell) { cursor = cell; }
    },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var cell = cellAt(pos);
      if (cell) { cursor = cell; reveal(cell.x, cell.y); }
    },
    onSecondary: function (pos) {
      var cell = cellAt(pos);
      if (cell) { cursor = cell; toggleFlag(cell.x, cell.y); }
    },
    keys: { f: function () { toggleFlag(cursor.x, cursor.y); } }
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
    if (run && idle()) {
      resetRun();
      state = 'menu';
    }
    renderHud();
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  window.__neonMines = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        size: N,
        mines: mineCount,
        placed: placed,
        revealed: revealedCount,
        safe: safeCells(),
        flags: flagCount,
        score: score,
        seconds: seconds(),
        cursor: { x: cursor.x, y: cursor.y },
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : jouer sans dépendre du hasard.
    plant: function (list) {
      mines = new Array(N * N).fill(false);
      list.forEach(function (p) { mines[p[1] * N + p[0]] = true; });
      mineCount = list.length;
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var count = 0;
          neighbours(x, y, function (nx, ny, i) { if (mines[i]) { count++; } });
          near[y * N + x] = count;
        }
      }
      placed = true;
      renderHud();
    },
    reveal: function (x, y) { reveal(x, y); },
    flag: function (x, y) { toggleFlag(x, y); },
    mineAt: function (x, y) { return !!mines[y * N + x]; },
    revealedAt: function (x, y) { return !!revealed[y * N + x]; },
    flaggedAt: function (x, y) { return !!flagged[y * N + x]; },
    nearAt: function (x, y) { return near[y * N + x]; }
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
