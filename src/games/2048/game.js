/* Neon 2048 — glisser, fusionner. Contrairement au Snake, ce jeu n'a pas de
   simulation continue : rien n'avance tout seul, tout se joue au coup par coup.
   Le socle s'en accommode : la boucle ne sert ici qu'aux animations. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games['2048'];
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/2048/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon 2048 : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var MOVE_MS = 110;          // glissement des tuiles
  var POP_MS = 130;           // apparition et fusion
  var RESTART_GRACE = 700;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';                 // menu | playing | paused | won | over
  var difficulty = progress.difficulty();
  var N, grid, score, maxTile, won, anim, particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function target() { return parseInt(progress.getSetting('target'), 10) || 2048; }
  function best() { return progress.bestFor(difficulty); }

  function at(x, y) { return grid[y * N + x]; }
  function put(x, y, value) { grid[y * N + x] = value; }

  function resetRun() {
    N = conf().size;
    grid = new Array(N * N).fill(0);
    score = 0;
    maxTile = 0;
    won = false;
    anim = null;
    particles = [];
    spawnTile();
    spawnTile();
    run = progress.newRun(difficulty);
    runStartedAt = performance.now();
    runCommitted = false;
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function emptyCells() {
    var out = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) { if (!at(x, y)) { out.push({ x: x, y: y }); } }
    }
    return out;
  }

  function spawnTile() {
    var free = emptyCells();
    if (!free.length) { return null; }
    var cell = free[Math.floor(Math.random() * free.length)];
    var four = progress.getSetting('spawn') === 'classic' && Math.random() < 0.1;
    cell.value = four ? 4 : 2;
    put(cell.x, cell.y, cell.value);
    if (cell.value > maxTile) { maxTile = cell.value; }
    return cell;
  }

  /* Position de la case d'indice `i` sur la ligne `line`, dans le sens du coup :
     l'indice 0 est toujours la case la plus proche du bord visé. */
  function cellOf(dir, line, i) {
    if (dir.x === -1) { return { x: i, y: line }; }
    if (dir.x === 1)  { return { x: N - 1 - i, y: line }; }
    if (dir.y === -1) { return { x: line, y: i }; }
    return { x: line, y: N - 1 - i };
  }

  /* Applique un coup et renvoie de quoi l'animer, ou null si rien ne bouge. */
  function slide(dir) {
    var moves = [];
    var merged = [];
    var gained = 0;
    var mergeCount = 0;
    var next = new Array(N * N).fill(0);
    var moved = false;

    for (var line = 0; line < N; line++) {
      var filled = [];
      for (var i = 0; i < N; i++) {
        var cell = cellOf(dir, line, i);
        var value = at(cell.x, cell.y);
        if (value) { filled.push({ i: i, cell: cell, value: value }); }
      }

      var out = 0;
      for (var k = 0; k < filled.length; k++) {
        var here = filled[k];
        var pair = filled[k + 1];
        var to = cellOf(dir, line, out);
        if (pair && pair.value === here.value) {
          var value2 = here.value * 2;
          next[to.y * N + to.x] = value2;
          moves.push({ from: here.cell, to: to, value: here.value });
          moves.push({ from: pair.cell, to: to, value: pair.value });
          merged.push({ cell: to, value: value2 });
          gained += value2;
          mergeCount++;
          if (value2 > maxTile) { maxTile = value2; }
          k++;
          moved = true;
        } else {
          next[to.y * N + to.x] = here.value;
          moves.push({ from: here.cell, to: to, value: here.value });
          if (here.i !== out) { moved = true; }
        }
        out++;
      }
    }

    if (!moved) { return null; }
    grid = next;
    return { moves: moves, merged: merged, gained: gained, mergeCount: mergeCount };
  }

  function canMove() {
    if (emptyCells().length) { return true; }
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = at(x, y);
        if ((x + 1 < N && at(x + 1, y) === v) || (y + 1 < N && at(x, y + 1) === v)) { return true; }
      }
    }
    return false;
  }

  /* Mode zen : plutôt que de perdre, les plus petites tuiles s'évaporent. */
  function evaporate() {
    var min = Infinity;
    grid.forEach(function (v) { if (v && v < min) { min = v; } });
    if (min === Infinity) { return; }
    var gone = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        if (at(x, y) === min) { put(x, y, 0); gone.push({ x: x, y: y }); }
      }
    }
    gone.forEach(function (cell) { burst(cell, '#8b9ac0', 10); });
    floatText({ x: (N - 1) / 2, y: (N - 1) / 2 }, 'Évaporation', '#8b9ac0');
    audio.bonus();
  }

  /* Plus aucun coup possible : soit la partie s'arrête, soit — en zen — le
     plateau respire. */
  function settleDeadEnd() {
    if (conf().forgiving) { evaporate(); } else { gameOver(performance.now()); }
  }

  function move(dx, dy) {
    if (state !== 'playing') { return; }
    var result = slide({ x: dx, y: dy });
    if (!result) {
      // Un coup sans effet ne fait rien avancer, mais il peut révéler que le
      // plateau est bloqué : on le vérifie ici aussi, et pas seulement après
      // un coup réussi.
      if (!canMove()) { settleDeadEnd(); }
      return;
    }

    score += result.gained;
    run.score = score;
    run.moves++;
    run.merges += result.mergeCount;
    run.maxTile = maxTile;

    var spawned = spawnTile();
    anim = { startedAt: performance.now(), moves: result.moves, merged: result.merged, spawn: spawned };

    result.merged.forEach(function (m) { burst(m.cell, tileColor(m.value), 8); });
    if (result.gained) {
      floatText(result.merged[result.merged.length - 1].cell, '+' + result.gained, '#ffd166');
      if (result.mergeCount > 1) { audio.chain(result.mergeCount); } else { audio.pickup(); }
    }

    checkUnlocks();
    renderHud();

    if (!won && maxTile >= target()) {
      won = true;
      state = 'won';
      audio.unlocked();
      panel.show({
        title: 'Gagné !',
        subtitle: 'Tuile ' + target() + ' atteinte. Tu peux continuer pour aller plus haut.',
        cta: 'Continuer',
        hideDifficulty: true
      });
      return;
    }

    if (!canMove()) { settleDeadEnd(); }
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
    if (!run || runCommitted || (run.moves === 0 && run.score === 0)) {
      runCommitted = true;
      return null;
    }
    runCommitted = true;
    run.durationMs = performance.now() - runStartedAt;
    run.score = score;
    run.maxTile = maxTile;
    var result = progress.finishRun(run);
    result.unlocked.forEach(function (item) { sheets.toast(item); });
    if (result.unlocked.length) { audio.unlocked(); }
    return result;
  }

  function gameOver(now) {
    state = 'over';
    overSince = now;
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
      title: beaten ? 'Nouveau record !' : 'Plus de coup possible',
      subtitle: beaten ? 'Tu viens de battre ton meilleur score.' : 'La grille est bloquée.',
      cta: 'Rejouer',
      scoreboard: {
        score: score,
        extraLabel: 'Meilleure tuile',
        extra: maxTile,
        best: Math.max(best(), score)
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burst(cell, color, count) {
    if (!effectsOn()) { return; }
    var c = cellSize();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.14;
      particles.push({
        x: origin() + (cell.x + 0.5) * c,
        y: origin() + (cell.y + 0.5) * c,
        vx: Math.cos(angle) * speed * c,
        vy: Math.sin(angle) * speed * c,
        life: 1,
        decay: 0.002 + Math.random() * 0.002,
        size: 1.5 + Math.random() * 2.5,
        color: color
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

  function floatText(cell, text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = ((origin() + (cell.x + 0.5) * cellSize()) / loop.size() * 100) + '%';
    el.style.top = ((origin() + (cell.y + 0.5) * cellSize()) / loop.size() * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  var PAD_RATIO = 0.035;      // marge du plateau, en fraction du côté

  function padding() { return loop.size() * PAD_RATIO; }
  function origin() { return padding(); }
  function cellSize() { return (loop.size() - padding() * 2) / N; }

  function tileColor(value) {
    var skin = progress.currentSkin();
    var step = Math.round(Math.log(value) / Math.LN2) - 1;   // 2 → 0, 4 → 1, …
    if (skin.rainbow) { return 'hsl(' + ((step * 32) % 360) + ', 78%, 58%)'; }
    var ramp = skin.ramp || manifest.ramps.neon;
    return ramp[Math.min(ramp.length - 1, Math.max(0, step))];
  }

  /* Encre sombre sur tuile claire, claire sur tuile sombre. */
  function inkFor(color) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    var r, g, b;
    if (m) {
      var n = parseInt(m[1], 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
      return '#0a1018';                                     // teintes hsl : toujours claires
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0a1018' : '#f4f8ff';
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

  function drawTile(cx, cy, value, scale) {
    var c = cellSize();
    var size = (c - c * 0.09) * (scale || 1);
    var color = tileColor(value);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = value >= 128 ? 18 : 8;
    ctx.fillStyle = color;
    roundRect(cx - size / 2, cy - size / 2, size, size, c * 0.16);
    ctx.fill();
    ctx.shadowBlur = 0;

    var digits = String(value).length;
    var ratio = digits <= 2 ? 0.42 : digits === 3 ? 0.34 : digits === 4 ? 0.27 : 0.22;
    ctx.fillStyle = inkFor(color);
    ctx.font = '700 ' + Math.round(c * ratio * (scale || 1)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), cx, cy + c * 0.02);
    ctx.restore();
  }

  function centerOf(x, y) {
    var c = cellSize();
    return { x: origin() + (x + 0.5) * c, y: origin() + (y + 0.5) * c };
  }

  function drawBoard() {
    var c = cellSize();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        roundRect(origin() + x * c + c * 0.045, origin() + y * c + c * 0.045,
                  c - c * 0.09, c - c * 0.09, c * 0.16);
        ctx.fill();
      }
    }
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function draw(now, alpha, dt) {
    var size = loop.size();
    updateParticles(dt);
    ctx.clearRect(0, 0, size, size);
    drawBoard();

    var phase = 0;                       // 0 : au repos, 1 : glissement, 2 : apparition
    var t = 0;
    if (anim) {
      t = now - anim.startedAt;
      if (t < MOVE_MS) { phase = 1; }
      else if (t < MOVE_MS + POP_MS) { phase = 2; }
      else { anim = null; }
    }

    if (phase === 1) {
      // Les tuiles glissent depuis leur ancienne case ; la valeur fusionnée
      // n'apparaît qu'une fois le déplacement terminé.
      var k = easeOut(t / MOVE_MS);
      anim.moves.forEach(function (m) {
        var from = centerOf(m.from.x, m.from.y);
        var to = centerOf(m.to.x, m.to.y);
        drawTile(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, m.value, 1);
      });
    } else {
      var popped = {};
      if (phase === 2) {
        var p = (t - MOVE_MS) / POP_MS;
        anim.merged.forEach(function (m) { popped[m.cell.x + ',' + m.cell.y] = 1 + 0.18 * Math.sin(p * Math.PI); });
        if (anim.spawn) { popped[anim.spawn.x + ',' + anim.spawn.y] = easeOut(p); }
      }
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var value = at(x, y);
          if (!value) { continue; }
          var center = centerOf(x, y);
          var scale = popped[x + ',' + y];
          drawTile(center.x, center.y, value, scale === undefined ? 1 : scale);
        }
      }
    }

    ctx.save();
    particles.forEach(function (p2) {
      ctx.globalAlpha = clamp(p2.life, 0, 1);
      ctx.fillStyle = p2.color;
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, p2.size, 0, Math.PI * 2);
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
      side: maxTile || '—',
      sideVisible: state === 'playing' || state === 'won',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Objectif',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : target()
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
      panel.show({ title: 'Pause', subtitle: 'Reprends quand tu veux.',
                   cta: 'Reprendre', hideDifficulty: true });
    } else if (state === 'paused') {
      state = 'playing';
      panel.hide();
    }
  }

  function onPlay() {
    if (state === 'paused') { togglePause(); return; }
    if (state === 'won') { state = 'playing'; panel.hide(); renderHud(); return; }
    startGame();
  }

  function onDirection(dx, dy) {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
    if (state === 'menu' || state === 'over') { startGame(); return; }
    if (state === 'playing') { move(dx, dy); }
  }

  function action() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
    if (state === 'menu' || state === 'over') { startGame(); }
    else if (state === 'won') { onPlay(); }
    else { togglePause(); }
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  hud = Core.createHud(progress);
  panel = Core.createPanel(onPlay);

  sheets = Core.createSheets(progress, {
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* le rendu suivant lit déjà la nouvelle palette */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
      if (name === 'target') { renderHud(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // rien n'avance seul : pas de tick
    render: draw
  });
  ctx = loop.ctx;

  Core.attachInput({
    canvas: canvas,
    dpad: $('dpad'),
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onDirection: onDirection,
    onAction: action,
    onEscape: function () { if (state === 'playing') { togglePause(); } }
  });

  toolbar = Core.wireToolbar({
    progress: progress,
    sheets: sheets,
    onPause: function () { if (state === 'playing' || state === 'paused') { togglePause(); } },
    onRestart: startGame,
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

  window.__neon2048 = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        size: N,
        skin: progress.currentSkin().id,
        score: score,
        maxTile: maxTile,
        grid: grid.slice(),
        tiles: grid.filter(function (v) { return v > 0; }).length,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Permet aux tests de placer une grille précise sans jouer cent coups.
    setGrid: function (values) { grid = values.slice(); maxTile = Math.max.apply(null, values); renderHud(); },
    move: function (dx, dy) { move(dx, dy); }
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
