/* Neon Bricks — casse-briques. Tout se joue dans un espace unitaire (0 à 1 sur
   les deux axes) converti en pixels au rendu : la physique ne dépend donc pas
   de la taille de l'écran. La boucle du socle avance à 120 pas par seconde. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.bricks;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/bricks/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Bricks : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker, input;

  /* ------------------------------------------------------------------ */
  /* Constantes, en unités de plateau                                    */
  /* ------------------------------------------------------------------ */

  var TICK_MS = 1000 / 120;      // pas de simulation : assez fin pour les rebonds
  var DT = TICK_MS / 1000;
  var MARGIN = 0.045;
  var COLS = 8;
  var BRICK_H = 0.042;
  var BRICK_GAP = 0.008;
  var BRICK_TOP = 0.10;
  var PADDLE_H = 0.024;
  var PADDLE_Y = 0.925;
  var PADDLE_SPEED = 1.7;        // unités par seconde au clavier
  var BALL_R = 0.0155;
  var MAX_BOUNCE = 1.05;         // radians : angle maximal de renvoi (60°)
  var DROP_SPEED = 0.38;
  var DROP_CHANCE = 0.13;
  var WIDE_MS = 10000;
  var SLOW_MS = 6000;
  var RESTART_GRACE = 700;

  var SPEED_FACTORS = { soft: 0.78, normal: 1, lively: 1.22 };
  var DROPS = {
    wide: { color: '#7ee787', label: 'L' },
    slow: { color: '#55b6ff', label: 'S' },
    life: { color: '#ff5d8f', label: '♥' }
  };

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';               // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var bricks, ball, prevBall, paddle, drops, particles;
  var score, lives, level, docked, lostThisLevel;
  var wideUntil, slowUntil, elapsed;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function baseSpeed() {
    return conf().speed * (SPEED_FACTORS[progress.getSetting('ballSpeed')] || 1);
  }

  function paddleWidth() {
    return conf().paddle * (elapsed < wideUntil ? 1.5 : 1);
  }

  function buildBricks(rows) {
    var list = [];
    var width = (1 - MARGIN * 2 - BRICK_GAP * (COLS - 1)) / COLS;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < COLS; c++) {
        list.push({
          x: MARGIN + c * (width + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          w: width,
          h: BRICK_H,
          row: r,
          // En difficile, la rangée du haut demande deux coups.
          hits: (conf().tough && r === 0) ? 2 : 1
        });
      }
    }
    return list;
  }

  function dockBall() {
    docked = true;
    ball = { x: paddle.x, y: PADDLE_Y - PADDLE_H / 2 - BALL_R - 0.002, vx: 0, vy: 0 };
    prevBall = { x: ball.x, y: ball.y };
  }

  function launchBall() {
    if (!docked) { return; }
    docked = false;
    var speed = baseSpeed() * (1 + (level - 1) * 0.06);
    var angle = (Math.random() * 0.5 - 0.25) - Math.PI / 2;   // vers le haut, légèrement de biais
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    audio.pickup();
  }

  function startLevel(n) {
    level = n;
    lostThisLevel = false;
    bricks = buildBricks(Math.min(8, conf().rows + (n - 1)));
    drops = [];
    wideUntil = 0;
    slowUntil = 0;
    paddle = { x: 0.5 };
    dockBall();
    if (run) { run.maxLevel = Math.max(run.maxLevel, n); }
    floatText(0.5, 0.45, 'Niveau ' + n, '#e8eefc');
  }

  function resetRun() {
    score = 0;
    lives = conf().lives;
    elapsed = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.perfectLevel = false;
    runStartedAt = performance.now();
    runCommitted = false;
    startLevel(1);
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Simulation                                                          */
  /* ------------------------------------------------------------------ */

  function movePaddle() {
    var half = paddleWidth() / 2;
    var axis = input.axis();
    if (axis.x) { paddle.x += axis.x * PADDLE_SPEED * DT; }
    paddle.x = clamp(paddle.x, half, 1 - half);
  }

  function bounceOffPaddle() {
    var half = paddleWidth() / 2;
    var top = PADDLE_Y - PADDLE_H / 2;
    if (ball.vy <= 0 || ball.y + BALL_R < top || ball.y - BALL_R > PADDLE_Y + PADDLE_H / 2) { return false; }
    if (ball.x < paddle.x - half - BALL_R || ball.x > paddle.x + half + BALL_R) { return false; }

    // L'angle de renvoi dépend du point d'impact : au centre, tout droit ;
    // sur le bord, très incliné.
    var offset = clamp((ball.x - paddle.x) / half, -1, 1);
    var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) * 1.012;
    var angle = offset * MAX_BOUNCE;
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
    ball.y = top - BALL_R;
    audio.pickup();
    return true;
  }

  function hitBrick() {
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (ball.x + BALL_R < b.x || ball.x - BALL_R > b.x + b.w ||
          ball.y + BALL_R < b.y || ball.y - BALL_R > b.y + b.h) { continue; }

      // On rebondit sur l'axe où le chevauchement est le plus faible.
      var overlapX = Math.min(ball.x + BALL_R - b.x, b.x + b.w - (ball.x - BALL_R));
      var overlapY = Math.min(ball.y + BALL_R - b.y, b.y + b.h - (ball.y - BALL_R));
      if (overlapX < overlapY) { ball.vx = -ball.vx; ball.x += ball.x < b.x + b.w / 2 ? -overlapX : overlapX; }
      else { ball.vy = -ball.vy; ball.y += ball.y < b.y + b.h / 2 ? -overlapY : overlapY; }

      b.hits--;
      if (b.hits > 0) {
        score += 5;
        audio.pickup();
      } else {
        bricks.splice(i, 1);
        score += 10;
        run.bricks++;
        burst(b.x + b.w / 2, b.y + b.h / 2, brickColor(b.row), 10);
        audio.chain(Math.min(5, 1 + Math.floor(run.bricks / 20)));
        if (progress.getSetting('bonuses') && Math.random() < DROP_CHANCE) {
          var types = Object.keys(DROPS);
          drops.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, type: types[Math.floor(Math.random() * types.length)] });
        }
      }
      run.score = score;
      return true;
    }
    return false;
  }

  function moveDrops() {
    var half = paddleWidth() / 2;
    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.y += DROP_SPEED * DT;
      var caught = d.y > PADDLE_Y - PADDLE_H && d.y < PADDLE_Y + PADDLE_H &&
                   d.x > paddle.x - half && d.x < paddle.x + half;
      if (caught) {
        drops.splice(i, 1);
        score += 20;
        run.score = score;
        run.bonuses++;
        if (d.type === 'wide') { wideUntil = elapsed + WIDE_MS; }
        if (d.type === 'slow') { slowUntil = elapsed + SLOW_MS; }
        if (d.type === 'life') { lives++; }
        floatText(d.x, d.y, d.type === 'life' ? '+1 vie' : d.type === 'wide' ? 'Large' : 'Lente',
                  DROPS[d.type].color);
        burst(d.x, d.y, DROPS[d.type].color, 12);
        audio.bonus();
        renderHud();
      } else if (d.y > 1.05) {
        drops.splice(i, 1);
      }
    }
  }

  function loseBall() {
    lostThisLevel = true;
    lives--;
    burst(ball.x, 1, '#ff5d8f', 20);
    audio.fail();
    if (effectsOn()) {
      boardWrap.classList.remove('shake');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('shake');
    }
    renderHud();
    if (lives <= 0) { gameOver(performance.now()); return; }
    dockBall();
  }

  function step() {
    elapsed += TICK_MS;
    movePaddle();
    // Évalué avant toute sortie anticipée : balle au repos, un succès obtenu
    // au coup précédent doit quand même se débloquer tout de suite.
    checkUnlocks();

    if (docked) {
      ball.x = paddle.x;
      prevBall = { x: ball.x, y: ball.y };
      return;
    }

    prevBall = { x: ball.x, y: ball.y };
    var factor = elapsed < slowUntil ? 0.72 : 1;
    ball.x += ball.vx * DT * factor;
    ball.y += ball.vy * DT * factor;

    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.x > 1 - BALL_R) { ball.x = 1 - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }

    bounceOffPaddle();
    hitBrick();
    moveDrops();

    if (ball.y > 1 - BALL_R) {
      // En zen, le bas du plateau est un mur comme les autres.
      if (forgiving()) { ball.y = 1 - BALL_R; ball.vy = -Math.abs(ball.vy); }
      else if (ball.y > 1 + BALL_R * 2) { loseBall(); return; }
    }

    if (!bricks.length) {
      score += 100;
      run.score = score;
      run.levels++;
      if (!lostThisLevel) { run.perfectLevel = true; }
      audio.unlocked();
      startLevel(level + 1);
      renderHud();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Fin de partie, succès                                               */
  /* ------------------------------------------------------------------ */

  var lastCheck = 0;
  function checkUnlocks() {
    // Inutile d'évaluer les succès 120 fois par seconde.
    if (elapsed - lastCheck < 250) { return; }
    lastCheck = elapsed;
    run.durationMs = performance.now() - runStartedAt;
    var fresh = progress.evaluate(run);
    if (!fresh.length) { return; }
    fresh.forEach(function (item) { sheets.toast(item); });
    audio.unlocked();
  }

  function commitRun() {
    if (!run || runCommitted || (run.bricks === 0 && run.score === 0)) {
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
    audio.fail();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();

    panel.show({
      title: beaten ? 'Nouveau record !' : 'Plus de balle',
      subtitle: beaten ? 'Tu viens de battre ton meilleur score.' : 'La dernière balle est passée.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Niveau atteint',
        extra: level,
        best: Math.max(best(), score)
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burst(ux, uy, color, count) {
    if (!effectsOn()) { return; }
    var size = loop.size();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = (0.05 + Math.random() * 0.15) * size * 0.05;
      particles.push({
        x: ux * size, y: uy * size,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
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

  function floatText(ux, uy, text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = (ux * 100) + '%';
    el.style.top = (uy * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function skin() { return progress.currentSkin(); }

  function brickColor(row) {
    var s = skin();
    if (s.rainbow) { return 'hsl(' + ((row * 42 + elapsed / 40) % 360) + ', 82%, 62%)'; }
    var ramp = s.ramp || manifest.ramps.neon;
    return ramp[row % ramp.length];
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
    var size = loop.size();
    var u = function (v) { return v * size; };
    updateParticles(dt);
    ctx.clearRect(0, 0, size, size);

    // Briques
    bricks.forEach(function (b) {
      var color = brickColor(b.row);
      ctx.save();
      ctx.globalAlpha = b.hits > 1 ? 1 : 0.92;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      roundRect(u(b.x), u(b.y), u(b.w), u(b.h), u(0.008));
      ctx.fill();
      if (b.hits > 1) {
        // Une brique à deux coups porte une seconde couche visible.
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#0a1018';
        roundRect(u(b.x) + u(0.006), u(b.y) + u(0.006), u(b.w) - u(0.012), u(b.h) - u(0.012), u(0.005));
        ctx.fill();
      }
      ctx.restore();
    });

    // Bonus qui tombent
    drops.forEach(function (d) {
      var def = DROPS[d.type];
      ctx.save();
      ctx.shadowColor = def.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = def.color;
      roundRect(u(d.x) - u(0.022), u(d.y) - u(0.017), u(0.044), u(0.034), u(0.01));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a1018';
      ctx.font = '700 ' + Math.round(u(0.026)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, u(d.x), u(d.y) + 1);
      ctx.restore();
    });

    // Raquette
    var half = paddleWidth() / 2;
    var paddleColor = skin().rainbow ? 'hsl(' + (elapsed / 12 % 360) + ', 90%, 68%)' : skin().paddle;
    ctx.save();
    ctx.shadowColor = paddleColor;
    ctx.shadowBlur = 18;
    ctx.fillStyle = paddleColor;
    roundRect(u(paddle.x - half), u(PADDLE_Y - PADDLE_H / 2), u(half * 2), u(PADDLE_H), u(PADDLE_H / 2));
    ctx.fill();
    ctx.restore();

    // Balle, interpolée entre deux pas de simulation
    var bx = prevBall.x + (ball.x - prevBall.x) * alpha;
    var by = prevBall.y + (ball.y - prevBall.y) * alpha;
    ctx.save();
    ctx.shadowColor = skin().ball;
    ctx.shadowBlur = 20;
    ctx.fillStyle = skin().ball;
    ctx.beginPath();
    ctx.arc(u(bx), u(by), u(BALL_R), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Particules
    ctx.save();
    particles.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Jauges des bonus en cours
    var bars = [];
    if (elapsed < wideUntil) { bars.push({ color: DROPS.wide.color, ratio: (wideUntil - elapsed) / WIDE_MS }); }
    if (elapsed < slowUntil) { bars.push({ color: DROPS.slow.color, ratio: (slowUntil - elapsed) / SLOW_MS }); }
    bars.forEach(function (bar, i) {
      var h = 4;
      var y = i * (h + 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(0, y, size, h);
      ctx.fillStyle = bar.color;
      ctx.fillRect(0, y, size * clamp(bar.ratio, 0, 1), h);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: forgiving() ? '∞' : (lives > 5 ? '× ' + lives : new Array(Math.max(0, lives) + 1).join('♥')),
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Niveau',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : level
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

  function action() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
    if (state === 'menu' || state === 'over') { startGame(); return; }
    if (state === 'playing' && docked) { launchBall(); return; }
    togglePause();
  }

  function onDirection(dx, dy) {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
    if (state === 'menu' || state === 'over') { startGame(); return; }
    // Une direction sert aussi de service : pratique au clavier comme au pavé.
    if (state === 'playing' && docked && dy <= 0) { launchBall(); }
  }

  function onPointer(pos, pressed) {
    if (state !== 'playing' || !progress.getSetting('pointer')) { return; }
    var half = paddleWidth() / 2;
    paddle.x = clamp(pos.x, half, 1 - half);
    if (pressed && docked) { launchBall(); }
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
    duration: function () { return TICK_MS; },
    tick: step,
    render: draw
  });
  ctx = loop.ctx;

  input = Core.attachInput({
    canvas: canvas,
    dpad: $('dpad'),
    swipe: false,                    // la raquette se pilote au maintien, pas au geste
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onDirection: onDirection,
    onPointer: onPointer,
    onAction: action,
    onEscape: function () { if (state === 'playing') { togglePause(); } }
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

  window.__neonBricks = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        score: score,
        lives: lives,
        level: level,
        docked: docked,
        bricks: bricks.length,
        drops: drops.map(function (d) { return d.type; }),
        ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
        paddle: { x: paddle.x, w: paddleWidth() },
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée pour les tests : placer la balle, vider le niveau, etc.
    setBall: function (b) { ball.x = b.x; ball.y = b.y; ball.vx = b.vx; ball.vy = b.vy;
                            prevBall = { x: b.x, y: b.y }; docked = false; },
    setPaddle: function (x) { paddle.x = x; },
    clearBricks: function (keep) { bricks = bricks.slice(0, keep || 0); },
    dropAt: function (type, x, y) { drops.push({ x: x, y: y, type: type }); }
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
