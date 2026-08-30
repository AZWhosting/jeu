/* Neon Crates — pousse-caisses. Rien ne bouge tout seul : la boucle du socle
   ne sert qu'au rendu. L'annulation est ici une mécanique de jeu, pas un
   filet de sécurité. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.crates;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/crates/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Crates : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var LEVEL_POINTS = 100;
  var PAR_BONUS = 10;           // points par pas économisé sous le par
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

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var level, index, walls, targets, crates, player, moves, pushes, history, undos;
  var score, particles, solvedAt;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function pack() { return manifest.packs[conf().pack] || manifest.packs.easy; }
  function best() { return progress.bestFor(difficulty); }
  function key(x, y) { return x + ',' + y; }

  function loadLevel(n) {
    index = n;
    level = pack()[n];
    walls = {};
    targets = {};
    crates = {};
    moves = 0;
    pushes = 0;
    undos = 0;
    history = [];
    solvedAt = 0;

    level.rows.forEach(function (row, y) {
      row.split('').forEach(function (ch, x) {
        var k = key(x, y);
        if (ch === '#') { walls[k] = true; }
        if (ch === '.' || ch === '*' || ch === '+') { targets[k] = true; }
        if (ch === '$' || ch === '*') { crates[k] = true; }
        if (ch === '@' || ch === '+') { player = { x: x, y: y }; }
      });
    });
    if (run) { run.maxLevel = Math.max(run.maxLevel, n + 1); }
    renderHud();
  }

  function resetRun() {
    score = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.underPar = false;
    run.cleanLevel = false;
    runStartedAt = performance.now();
    runCommitted = false;
    loadLevel(0);
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function solved() {
    return Object.keys(targets).every(function (k) { return crates[k]; });
  }

  function snapshotState() {
    return { player: { x: player.x, y: player.y }, crates: Object.keys(crates), moves: moves, pushes: pushes };
  }

  function step(dx, dy) {
    if (state !== 'playing' || solvedAt) { return false; }
    var nx = player.x + dx, ny = player.y + dy;
    var target = key(nx, ny);
    if (walls[target]) { return false; }

    var pushed = false;
    if (crates[target]) {
      var bx = nx + dx, by = ny + dy;
      var behind = key(bx, by);
      if (walls[behind] || crates[behind]) { return false; }
      history.push(snapshotState());
      delete crates[target];
      crates[behind] = true;
      pushed = true;
      pushes++;
      run.pushes++;
      if (targets[behind]) { burst(bx, by, ramp().done, 10); audio.bonus(); }
      else { audio.pickup(); }
    } else {
      history.push(snapshotState());
    }

    player.x = nx;
    player.y = ny;
    moves++;
    run.moves++;
    if (!pushed) { audio.blip(200, 0.03, 'square', 0.03); }

    if (solved()) { completeLevel(); }
    renderHud();
    return true;
  }

  function undo() {
    if (state !== 'playing' || !history.length || solvedAt) { return; }
    var prev = history.pop();
    player = prev.player;
    crates = {};
    prev.crates.forEach(function (k) { crates[k] = true; });
    moves = prev.moves;
    pushes = prev.pushes;
    undos++;
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
  }

  function restartLevel() {
    if (state !== 'playing') { return; }
    loadLevel(index);
    audio.blip(140, 0.08, 'triangle', 0.04);
  }

  /* Mode libre : passer au tableau suivant sans l'avoir résolu. */
  function skipLevel() {
    if (state !== 'playing' || !conf().forgiving) { return; }
    if (index + 1 < pack().length) { loadLevel(index + 1); floatText('Tableau ' + (index + 1), '#8b9ac0'); }
  }

  function completeLevel() {
    solvedAt = performance.now();
    var saved = Math.max(0, level.par - moves);
    var gained = LEVEL_POINTS + saved * PAR_BONUS;
    score += gained;
    run.score = score;
    run.levels++;
    if (saved > 0) { run.underPar = true; }
    if (undos === 0) { run.cleanLevel = true; }

    Object.keys(targets).forEach(function (k) {
      var parts = k.split(',');
      burst(Number(parts[0]), Number(parts[1]), ramp().done, 12);
    });
    floatText('+' + gained + (saved ? ' (sous le par)' : ''), ramp().done);
    audio.unlocked();
    checkUnlocks();
    renderHud();

    // Un instant pour souffler avant le tableau suivant.
    setTimeout(function () {
      if (state !== 'playing') { return; }
      if (index + 1 < pack().length) { loadLevel(index + 1); solvedAt = 0; }
      else { finish(); }
    }, 900);
  }

  function finish() {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Série terminée !',
      subtitle: 'Les ' + pack().length + ' tableaux sont résolus.',
      cta: 'Recommencer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Poussées',
        extra: run.pushes,
        best: Math.max(best(), score)
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Succès et statistiques                                              */
  /* ------------------------------------------------------------------ */

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

  function burst(cx, cy, color, count) {
    if (!effectsOn()) { return; }
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.14;
      particles.push({
        x: g.x + (cx + 0.5) * g.cell, y: g.y + (cy + 0.5) * g.cell,
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

  function floatText(text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = '50%';
    el.style.top = '35%';
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

  function crateColor(k, x, y) {
    var skin = progress.currentSkin();
    if (targets[k]) { return skin.rainbow ? 'hsl(' + ((x * 40 + y * 25) % 360) + ', 80%, 60%)' : ramp().done; }
    if (skin.rainbow) { return 'hsl(' + ((x * 40 + y * 25 + 40) % 360) + ', 70%, 62%)'; }
    return ramp().crate;
  }

  /* Une caisse hors cible coincée entre deux murs d'angle ne bougera plus. */
  function stuck(x, y) {
    if (targets[key(x, y)]) { return false; }
    var up = walls[key(x, y - 1)], down = walls[key(x, y + 1)];
    var left = walls[key(x - 1, y)], right = walls[key(x + 1, y)];
    return (up || down) && (left || right);
  }

  function geometry() {
    var size = loop.size();
    var cols = Math.max.apply(null, level.rows.map(function (r) { return r.length; }));
    var rows = level.rows.length;
    var cell = Math.min(size * 0.9 / cols, size * 0.82 / rows);
    return { cell: cell, x: (size - cell * cols) / 2, y: (size - cell * rows) / 2, size: size,
             cols: cols, rows: rows };
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

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);

    // Sol, murs et cibles.
    for (var y = 0; y < g.rows; y++) {
      for (var x = 0; x < g.cols; x++) {
        var k = key(x, y);
        var px = g.x + x * g.cell, py = g.y + y * g.cell;
        if (walls[k]) {
          ctx.fillStyle = ramp().wall;
          roundRect(px + 1, py + 1, g.cell - 2, g.cell - 2, g.cell * 0.18);
          ctx.fill();
          continue;
        }
        var inside = (level.rows[y] || '')[x] !== undefined && (level.rows[y] || '')[x] !== ' ' || true;
        if (inside && progress.getSetting('grid')) {
          ctx.strokeStyle = progress.theme().grid;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, g.cell, g.cell);
        }
        if (targets[k]) {
          ctx.fillStyle = ramp().target;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.arc(px + g.cell / 2, py + g.cell / 2, g.cell * 0.16, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Caisses.
    Object.keys(crates).forEach(function (k) {
      var parts = k.split(',');
      var x = Number(parts[0]), y = Number(parts[1]);
      var px = g.x + x * g.cell, py = g.y + y * g.cell;
      var color = crateColor(k, x, y);
      var blocked = progress.getSetting('deadlock') && stuck(x, y);
      ctx.save();
      ctx.shadowColor = blocked ? '#ff5d8f' : color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = blocked ? '#ff5d8f' : color;
      roundRect(px + g.cell * 0.1, py + g.cell * 0.1, g.cell * 0.8, g.cell * 0.8, g.cell * 0.18);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(10, 16, 24, 0.5)';
      ctx.lineWidth = Math.max(1, g.cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(px + g.cell * 0.22, py + g.cell * 0.22);
      ctx.lineTo(px + g.cell * 0.78, py + g.cell * 0.78);
      ctx.moveTo(px + g.cell * 0.78, py + g.cell * 0.22);
      ctx.lineTo(px + g.cell * 0.22, py + g.cell * 0.78);
      ctx.stroke();
      ctx.restore();
    });

    // Le pousseur.
    var cx = g.x + (player.x + 0.5) * g.cell;
    var cy = g.y + (player.y + 0.5) * g.cell;
    ctx.save();
    ctx.shadowColor = ramp().player;
    ctx.shadowBlur = 18;
    ctx.fillStyle = ramp().player;
    ctx.beginPath();
    ctx.arc(cx, cy, g.cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06121a';
    ctx.beginPath();
    ctx.arc(cx - g.cell * 0.1, cy - g.cell * 0.05, Math.max(1.2, g.cell * 0.055), 0, Math.PI * 2);
    ctx.arc(cx + g.cell * 0.1, cy - g.cell * 0.05, Math.max(1.2, g.cell * 0.055), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    particles.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Bandeau : pas effectués et par conseillé.
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(g.size * 0.03) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(moves + ' pas', g.size * 0.03, g.size * 0.955);
    ctx.textAlign = 'right';
    ctx.fillText('par ' + level.par, g.size * 0.97, g.size * 0.955);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: (index + 1) + ' / ' + pack().length,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Poussées',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : pushes
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
    if (state === 'playing') { step(dx, dy); }
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { togglePause(); }
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
    running: function () { return false; },   // le tableau ne change qu'au coup joué
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
    onTap: function () { guardedStart(); },
    keys: { u: undo, r: restartLevel, n: skipLevel }
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

  window.__neonCrates = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        level: index + 1,
        levels: pack().length,
        par: level.par,
        moves: moves,
        pushes: pushes,
        undos: undos,
        score: score,
        solved: solved(),
        player: { x: player.x, y: player.y },
        crates: Object.keys(crates).sort(),
        targets: Object.keys(targets).sort(),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    packs: function () { return manifest.packs; },
    step: function (dx, dy) { return step(dx, dy); },
    undo: undo,
    restartLevel: restartLevel,
    skipLevel: skipLevel,
    goToLevel: function (n) { loadLevel(n); }
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
