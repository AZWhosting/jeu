/* Neon Snake — jeu d'arcade en canvas, sans dépendance.
   Boucle à pas fixe (logique) + rendu interpolé (60 fps).
   Les réglages, succès, skins et statistiques vivent dans progress.js. */
(function () {
  'use strict';

  var P = window.Progress;
  var Sheets = window.Sheets;

  /* ------------------------------------------------------------------ */
  /* Configuration                                                       */
  /* ------------------------------------------------------------------ */

  // Dimensions de la grille : relues dans les réglages à chaque partie.
  var COLS = P.gridSize();
  var ROWS = COLS;

  var DIFFICULTIES = {
    easy:   { label: 'Facile',    baseTick: 150, minTick: 90, wrap: true,  obstacles: 0,
              hint: 'Les murs se traversent, vitesse douce.' },
    normal: { label: 'Normal',    baseTick: 125, minTick: 68, wrap: false, obstacles: 0,
              hint: 'Murs mortels, vitesse progressive.' },
    hard:   { label: 'Difficile', baseTick: 100, minTick: 52, wrap: false, obstacles: 7,
              hint: 'Murs mortels, obstacles et rythme soutenu.' },
    zen:    { label: 'Zen',       baseTick: 165, minTick: 135, wrap: true, obstacles: 0,
              immortal: true,
              hint: 'Aucune mort possible : on traverse tout, on se détend.' }
  };

  var ITEMS = {
    apple: { points: 10, growth: 1, color: '#ff5d8f', life: 0,     label: '+10' },
    gold:  { points: 50, growth: 2, color: '#ffd166', life: 9000,  label: '+50' },
    slow:  { points: 15, growth: 1, color: '#55b6ff', life: 10000, label: 'Ralenti' },
    ghost: { points: 15, growth: 1, color: '#a78bfa', life: 10000, label: 'Fantôme' }
  };

  var POWERUP_EVERY = 3;      // une bonne surprise toutes les N pommes
  var COMBO_WINDOW = 2600;    // ms pour enchaîner et monter le multiplicateur
  var COMBO_MAX = 5;
  var SLOW_DURATION = 7000;   // ms
  var GHOST_DURATION = 6000;  // ms
  var RESTART_GRACE = 700;    // ms avant qu'une touche puisse relancer une partie

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var key = function (x, y) { return x + ',' + y; };
  var effectsOn = function () { return !!P.getSetting('effects'); };

  /* ------------------------------------------------------------------ */
  /* Sons (WebAudio, aucun fichier)                                      */
  /* ------------------------------------------------------------------ */

  var audio = {
    ctx: null,

    get enabled() { return !!P.getSetting('sound'); },

    unlock: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') { this.ctx.resume(); } return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) { this.ctx = new Ctx(); }
    },

    blip: function (freq, duration, type, gain) {
      if (!this.enabled || !this.ctx) { return; }
      var t = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var vol = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      vol.gain.setValueAtTime(gain || 0.06, t);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(vol).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
    },

    eat:    function () { this.blip(520, 0.09, 'square'); },
    combo:  function (n) { this.blip(520 + n * 110, 0.1, 'triangle', 0.07); },
    power:  function () { this.blip(320, 0.07, 'sawtooth', 0.05); this.blip(660, 0.18, 'triangle', 0.05); },
    die:    function () { this.blip(180, 0.35, 'sawtooth', 0.08); this.blip(90, 0.5, 'square', 0.06); },
    unlockJingle: function () {
      this.blip(660, 0.12, 'triangle', 0.06);
      var self = this;
      setTimeout(function () { self.blip(880, 0.18, 'triangle', 0.06); }, 120);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Éléments du DOM                                                     */
  /* ------------------------------------------------------------------ */

  var canvas = $('board');
  var ctx = canvas.getContext('2d');
  var boardWrap = document.querySelector('.board-wrap');
  var effects = $('effects');
  var overlay = $('overlay');
  var ui = {
    score: $('score'), best: $('best'), bestLabel: $('bestLabel'),
    combo: $('combo'), comboBox: $('comboBox'),
    subtitle: $('subtitle'), diffHint: $('diffHint'), difficultyField: $('difficultyField'),
    scoreboard: $('scoreboard'), finalScore: $('finalScore'), finalLength: $('finalLength'),
    finalBest: $('finalBest'), playBtn: $('playBtn'), hint: $('hint'),
    pauseBtn: $('pauseBtn'), soundBtn: $('soundBtn'), restartBtn: $('restartBtn'), statsBtn: $('statsBtn')
  };

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';                       // menu | playing | paused | over
  var difficulty = P.read('difficulty', 'normal');
  if (!DIFFICULTIES[difficulty]) { difficulty = 'normal'; }

  var snake, prevSnake, dir, queue, obstacles, food, powerup;
  var score, applesEaten, combo, lastEatAt, growth;
  var slowUntil, ghostUntil;
  var accumulator, lastFrame, particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function isZen() { return !!DIFFICULTIES[difficulty].immortal; }
  function best() { return P.bestFor(difficulty); }

  function resetRun() {
    COLS = P.gridSize();
    ROWS = COLS;
    var midY = Math.floor(ROWS / 2);
    snake = [{ x: 5, y: midY }, { x: 4, y: midY }, { x: 3, y: midY }];
    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });
    dir = { x: 1, y: 0 };
    queue = [];
    growth = 0;
    score = 0;
    applesEaten = 0;
    combo = 1;
    lastEatAt = -Infinity;
    slowUntil = 0;
    ghostUntil = 0;
    powerup = null;
    food = null;
    particles = [];
    accumulator = 0;
    obstacles = makeObstacles();
    food = { type: 'apple', cell: freeCell(), bornAt: performance.now() };
    run = P.newRun(difficulty);
    runStartedAt = performance.now();
    runCommitted = false;
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Grille : obstacles et cases libres                                  */
  /* ------------------------------------------------------------------ */

  function makeObstacles() {
    var set = {};
    // Le nombre d'obstacles suit la taille de la grille.
    var count = Math.round(DIFFICULTIES[difficulty].obstacles * (COLS / 21));
    var midY = Math.floor(ROWS / 2);
    var tries = 0;

    while (Object.keys(set).length < count && tries < 400) {
      tries++;
      var horizontal = Math.random() < 0.5;
      var len = 2 + Math.floor(Math.random() * 3);
      var x = 2 + Math.floor(Math.random() * (COLS - 4));
      var y = 2 + Math.floor(Math.random() * (ROWS - 4));
      var cells = [];
      var ok = true;

      for (var i = 0; i < len; i++) {
        var cx = horizontal ? x + i : x;
        var cy = horizontal ? y : y + i;
        // On épargne la ligne de départ du serpent et les bords immédiats.
        if (cx >= COLS - 1 || cy >= ROWS - 1 || (cy === midY && cx < 10)) { ok = false; break; }
        cells.push(key(cx, cy));
      }
      if (!ok) { continue; }
      cells.forEach(function (k) { set[k] = true; });
    }
    return set;
  }

  function occupied(x, y) {
    if (obstacles[key(x, y)]) { return true; }
    for (var i = 0; i < snake.length; i++) {
      if (snake[i].x === x && snake[i].y === y) { return true; }
    }
    if (food && food.cell.x === x && food.cell.y === y) { return true; }
    if (powerup && powerup.cell.x === x && powerup.cell.y === y) { return true; }
    return false;
  }

  function freeCell() {
    var options = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!occupied(x, y)) { options.push({ x: x, y: y }); }
      }
    }
    if (!options.length) { return { x: 0, y: 0 }; }
    return options[Math.floor(Math.random() * options.length)];
  }

  /* ------------------------------------------------------------------ */
  /* Boucle de jeu                                                       */
  /* ------------------------------------------------------------------ */

  function tickDuration(now) {
    var conf = DIFFICULTIES[difficulty];
    var ms = conf.baseTick;
    if (P.getSetting('speed') !== 'constant') {
      ms -= Math.min(conf.baseTick - conf.minTick, (snake.length - 3) * 2.2);
    }
    if (now < slowUntil) { ms *= 1.65; }
    return ms;
  }

  function nextDirection() {
    while (queue.length) {
      var candidate = queue.shift();
      // Demi-tour interdit : il tuerait le serpent instantanément.
      if (candidate.x === -dir.x && candidate.y === -dir.y) { continue; }
      if (candidate.x === dir.x && candidate.y === dir.y) { continue; }
      return candidate;
    }
    return dir;
  }

  function step(now) {
    dir = nextDirection();
    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });

    var head = snake[0];
    var nx = head.x + dir.x;
    var ny = head.y + dir.y;
    // En zen comme sous l'effet fantôme, plus rien ne tue.
    var immune = now < ghostUntil || isZen();
    var wrap = DIFFICULTIES[difficulty].wrap || immune;

    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      if (!wrap) { return gameOver(now); }
      nx = (nx + COLS) % COLS;
      ny = (ny + ROWS) % ROWS;
    }

    if (obstacles[key(nx, ny)] && !immune) { return gameOver(now); }

    // La queue libère sa case au même tick, sauf si le serpent grandit.
    var ignoreTail = growth === 0 ? 1 : 0;
    for (var i = 0; i < snake.length - ignoreTail; i++) {
      if (snake[i].x === nx && snake[i].y === ny && !immune) { return gameOver(now); }
    }

    snake.unshift({ x: nx, y: ny });
    if (growth > 0) { growth--; } else { snake.pop(); }

    if (snake.length > run.maxLength) {
      run.maxLength = snake.length;
      checkUnlocks();
      if (isZen()) { renderHud(); }
    }

    if (food && food.cell.x === nx && food.cell.y === ny) { consume(food, now); }
    else if (powerup && powerup.cell.x === nx && powerup.cell.y === ny) { consume(powerup, now); }

    if (powerup && now - powerup.bornAt > ITEMS[powerup.type].life) { powerup = null; }
  }

  function consume(item, now) {
    var def = ITEMS[item.type];

    combo = (now - lastEatAt < COMBO_WINDOW) ? Math.min(COMBO_MAX, combo + 1) : 1;
    lastEatAt = now;

    score += def.points * combo;
    growth += def.growth;
    run.score = score;
    run.maxCombo = Math.max(run.maxCombo, combo);

    burst(item.cell, def.color, item.type === 'apple' ? 12 : 22);
    floatText(item.cell, def.label + (combo > 1 ? ' ×' + combo : ''), def.color);

    if (item.type === 'slow') { slowUntil = now + SLOW_DURATION; }
    if (item.type === 'ghost') { ghostUntil = now + GHOST_DURATION; }

    if (item === food) {
      applesEaten++;
      run.apples++;
      food = { type: 'apple', cell: freeCell(), bornAt: now };
      if (applesEaten % POWERUP_EVERY === 0 && !powerup) { spawnPowerup(now); }
      if (combo > 1) { audio.combo(combo); } else { audio.eat(); }
    } else {
      run.powerups++;
      if (item.type === 'ghost') { run.ghosts++; }
      powerup = null;
      audio.power();
    }

    checkUnlocks();
    renderHud();
  }

  function spawnPowerup(now) {
    var pool = ['gold', 'gold', 'slow', 'ghost'];
    var type = pool[Math.floor(Math.random() * pool.length)];
    powerup = { type: type, cell: freeCell(), bornAt: now };
  }

  /* ------------------------------------------------------------------ */
  /* Fin de partie, succès                                               */
  /* ------------------------------------------------------------------ */

  function checkUnlocks() {
    run.durationMs = performance.now() - runStartedAt;
    var fresh = P.evaluate(run);
    if (!fresh.length) { return; }
    fresh.forEach(function (item) { Sheets.toast(item); });
    audio.unlockJingle();
  }

  /* Enregistre la partie en cours dans les statistiques. Idempotent. */
  function commitRun() {
    if (!run || runCommitted || run.apples === 0 && run.score === 0 && run.maxLength <= 3) {
      runCommitted = true;
      return null;
    }
    runCommitted = true;
    run.durationMs = performance.now() - runStartedAt;
    run.score = score;
    var result = P.finishRun(run);
    result.unlocked.forEach(function (item) { Sheets.toast(item); });
    if (result.unlocked.length) { audio.unlockJingle(); }
    return result;
  }

  function gameOver(now) {
    state = 'over';
    overSince = now;
    audio.die();
    burst(snake[0], '#ff5d8f', 34);
    if (effectsOn()) {
      boardWrap.classList.remove('shake');
      void boardWrap.offsetWidth;                  // relance l'animation
      boardWrap.classList.add('shake');
    }

    var result = commitRun();
    var beaten = !!(result && result.record);
    var record = Math.max(best(), score);

    ui.finalScore.textContent = score;
    ui.finalLength.textContent = snake.length;
    ui.finalBest.textContent = record;
    renderHud();

    showPanel({
      title: beaten ? 'Nouveau record !' : 'Perdu',
      subtitle: beaten ? 'Tu viens de battre ton meilleur score.' : 'Encore un essai ?',
      cta: 'Rejouer',
      scoreboard: true
    });
  }

  function frame(now) {
    var dt = Math.min(64, now - lastFrame);
    lastFrame = now;

    if (state === 'playing') {
      accumulator += dt;
      var duration = tickDuration(now);
      var guard = 0;
      while (accumulator >= duration && state === 'playing' && guard++ < 4) {
        accumulator -= duration;
        step(now);
        duration = tickDuration(now);
      }
    }

    updateParticles(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Particules et textes flottants                                      */
  /* ------------------------------------------------------------------ */

  function burst(cell, color, count) {
    if (!effectsOn()) { return; }
    var c = cellSize();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.04 + Math.random() * 0.16;
      particles.push({
        x: (cell.x + 0.5) * c,
        y: (cell.y + 0.5) * c,
        vx: Math.cos(angle) * speed * c,
        vy: Math.sin(angle) * speed * c,
        life: 1,
        decay: 0.0016 + Math.random() * 0.0022,
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
      p.vx *= 0.96;
      p.vy *= 0.96;
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
    el.style.left = ((cell.x + 0.5) / COLS * 100) + '%';
    el.style.top = ((cell.y + 0.5) / ROWS * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  var pixelSize = 640;
  function cellSize() { return pixelSize / COLS; }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var side = Math.max(1, Math.round(rect.width));
    pixelSize = side;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  function drawGrid(c) {
    if (!P.getSetting('gridLines')) { return; }
    ctx.strokeStyle = P.theme().grid;
    ctx.lineWidth = 1;
    for (var i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.round(i * c) + 0.5, 0);
      ctx.lineTo(Math.round(i * c) + 0.5, pixelSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, Math.round(i * c) + 0.5);
      ctx.lineTo(pixelSize, Math.round(i * c) + 0.5);
      ctx.stroke();
    }
  }

  function drawObstacles(c) {
    ctx.fillStyle = 'rgba(120, 150, 200, 0.18)';
    ctx.strokeStyle = 'rgba(150, 180, 230, 0.35)';
    ctx.lineWidth = 1;
    Object.keys(obstacles).forEach(function (k) {
      var parts = k.split(',');
      // Peu de marge : les cases voisines se lisent comme un seul bloc.
      roundRect(parts[0] * c + 1, parts[1] * c + 1, c - 2, c - 2, 3);
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawItem(item, c, now) {
    if (!item) { return; }
    var def = ITEMS[item.type];
    var age = now - item.bornAt;

    // Clignotement quand le bonus est sur le point de disparaître.
    if (def.life && def.life - age < 2200 && Math.floor(age / 160) % 2 === 0) { return; }

    var pulse = 1 + Math.sin(now / 180) * 0.08;
    var cx = (item.cell.x + 0.5) * c;
    var cy = (item.cell.y + 0.5) * c;
    var r = c * 0.3 * pulse;

    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (item.type !== 'apple') {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
      ctx.font = 'bold ' + Math.round(c * 0.34) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.type === 'gold' ? '★' : item.type === 'slow' ? '❄' : '◇', cx, cy + 1);
    }
    ctx.restore();
  }

  function lerpSegment(i, alpha) {
    var cur = snake[i];
    var prev = prevSnake[i] || cur;
    var dx = cur.x - prev.x;
    var dy = cur.y - prev.y;
    // Un saut de plus d'une case = passage par un bord : pas d'interpolation.
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { return { x: cur.x, y: cur.y }; }
    return { x: prev.x + dx * alpha, y: prev.y + dy * alpha };
  }

  // Le corps est tracé comme une polyligne épaisse : jointures rondes, pas de perles.
  function snakePath(alpha, c) {
    var paths = [];
    var current = [];
    for (var i = 0; i < snake.length; i++) {
      var p = lerpSegment(i, alpha);
      if (current.length) {
        var last = current[current.length - 1];
        // Un écart de plus d'une case = traversée d'un bord : on coupe le tracé.
        if (Math.abs(p.x - last.x) > 1.5 || Math.abs(p.y - last.y) > 1.5) {
          paths.push(current);
          current = [];
        }
      }
      current.push(p);
    }
    if (current.length) { paths.push(current); }

    return paths.map(function (path) {
      return path.map(function (p) {
        return { x: (p.x + 0.5) * c, y: (p.y + 0.5) * c };
      });
    });
  }

  function strokePath(path, width, style, blur) {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = style;
    ctx.shadowColor = style;
    ctx.shadowBlur = blur || 0;
    ctx.beginPath();
    if (path.length === 1) {
      // Un point isolé : un trait de longueur nulle dessine tout de même le cap rond.
      ctx.moveTo(path[0].x, path[0].y);
      ctx.lineTo(path[0].x + 0.01, path[0].y);
    } else {
      ctx.moveTo(path[0].x, path[0].y);
      for (var i = 1; i < path.length; i++) { ctx.lineTo(path[i].x, path[i].y); }
    }
    ctx.stroke();
  }

  function drawSnake(c, now) {
    var alpha = state === 'playing' ? clamp(accumulator / tickDuration(now), 0, 1) : 1;
    var ghost = now < ghostUntil;
    var skin = P.currentSkin();
    var body = ghost ? '#8b7cf0' : skin.body;
    var head = ghost ? '#c4b5fd' : skin.head;
    var paths = snakePath(alpha, c);

    ctx.save();
    if (ghost) { ctx.globalAlpha = 0.75; }

    if (skin.rainbow && !ghost) {
      // Chaque tronçon prend sa propre teinte, qui défile lentement.
      paths.forEach(function (path) {
        if (path.length === 1) { strokePath(path, c * 0.82, 'hsl(' + (now / 12 % 360) + ', 90%, 62%)', 14); }
        for (var i = 1; i < path.length; i++) {
          var hue = (now / 12 + i * 28) % 360;
          strokePath([path[i - 1], path[i]], c * 0.82, 'hsl(' + hue + ', 90%, 62%)', 12);
        }
      });
      head = 'hsl(' + (now / 12 % 360) + ', 95%, 80%)';
    } else {
      paths.forEach(function (path) { strokePath(path, c * 0.82, body, 18); });
      paths.forEach(function (path) { strokePath(path, c * 0.34, 'rgba(240, 255, 250, 0.20)', 0); });
    }

    // Tête : disque plus clair, légèrement plus large que le corps.
    var h = paths[0][0];
    ctx.shadowColor = head;
    ctx.shadowBlur = 22;
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(h.x, h.y, c * 0.45, 0, Math.PI * 2);
    ctx.fill();

    // Yeux orientés dans le sens du déplacement.
    var off = c * 0.17;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06121a';
    [-1, 1].forEach(function (side) {
      var ex = h.x + dir.x * off + (dir.x ? 0 : side * off);
      var ey = h.y + dir.y * off + (dir.y ? 0 : side * off);
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(1.5, c * 0.085), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawParticles() {
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

  function drawTimers(c, now) {
    var bars = [];
    if (now < slowUntil) { bars.push({ color: '#55b6ff', ratio: (slowUntil - now) / SLOW_DURATION }); }
    if (now < ghostUntil) { bars.push({ color: '#a78bfa', ratio: (ghostUntil - now) / GHOST_DURATION }); }

    bars.forEach(function (bar, i) {
      var h = 4;
      var y = pixelSize - (i + 1) * (h + 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(0, y, pixelSize, h);
      ctx.fillStyle = bar.color;
      ctx.fillRect(0, y, pixelSize * clamp(bar.ratio, 0, 1), h);
    });
  }

  function draw(now) {
    var c = cellSize();
    ctx.clearRect(0, 0, pixelSize, pixelSize);
    drawGrid(c);
    drawObstacles(c);
    drawItem(food, c, now);
    drawItem(powerup, c, now);
    drawSnake(c, now);
    drawParticles();
    drawTimers(c, now);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function bump(el) {
    if (!effectsOn()) { return; }
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function renderHud() {
    if (ui.score.textContent !== String(score)) { bump(ui.score); }
    ui.score.textContent = score;
    // En zen il n'y a pas de record à battre : on affiche la longueur atteinte.
    ui.bestLabel.textContent = isZen() ? 'Longueur' : 'Record';
    ui.best.textContent = isZen() ? snake.length : Math.max(best(), score);
    ui.combo.textContent = '×' + combo;
    ui.comboBox.hidden = combo < 2 || state !== 'playing';
  }

  function showPanel(opts) {
    overlay.hidden = false;
    document.querySelector('.title').textContent = opts.title;
    ui.subtitle.textContent = opts.subtitle;
    ui.playBtn.textContent = opts.cta;
    ui.scoreboard.hidden = !opts.scoreboard;
    ui.difficultyField.hidden = !!opts.hideDifficulty;
  }

  function hidePanel() { overlay.hidden = true; }

  function startGame() {
    audio.unlock();
    commitRun();                 // une partie abandonnée compte quand même
    resetRun();
    state = 'playing';
    lastFrame = performance.now();
    hidePanel();
    renderHud();
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      showPanel({ title: 'Pause', subtitle: 'Reprends quand tu veux.', cta: 'Reprendre', hideDifficulty: true });
    } else if (state === 'paused') {
      state = 'playing';
      lastFrame = performance.now();
      hidePanel();
    }
  }

  /* `persist` n'est vrai que sur un choix explicite du joueur : au chargement,
     rien ne doit être réécrit, sinon une réinitialisation laisse des traces. */
  function selectDifficulty(value, persist) {
    if (!DIFFICULTIES[value]) { return; }
    difficulty = value;
    if (persist) { P.write('difficulty', value); }
    Array.prototype.forEach.call(document.querySelectorAll('#difficulty .choice'), function (btn) {
      var active = btn.dataset.diff === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    ui.diffHint.textContent = DIFFICULTIES[value].hint;
    if (state === 'menu' || state === 'over') { run.difficulty = value; }
    renderHud();
  }

  function push(dx, dy) {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
    if (state === 'menu' || state === 'over') { startGame(); }
    if (state !== 'playing') { return; }
    if (queue.length < 2) { queue.push({ x: dx, y: dy }); }
  }

  var KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    z: [0, -1], q: [-1, 0]
  };

  document.addEventListener('keydown', function (e) {
    if (Sheets.isOpen()) { return; }          // les panneaux ont la main
    var move = KEYS[e.key] || KEYS[String(e.key).toLowerCase()];
    if (move) {
      e.preventDefault();
      audio.unlock();
      push(move[0], move[1]);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return; }
      if (state === 'menu' || state === 'over') { startGame(); }
      else { togglePause(); }
    }
    if (e.key === 'Escape' && state === 'playing') { togglePause(); }
  });

  // Balayage tactile.
  var touchStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY };
    audio.unlock();
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!touchStart) { return; }
    var dx = e.clientX - touchStart.x;
    var dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) { return; }
    if (Math.abs(dx) > Math.abs(dy)) { push(dx > 0 ? 1 : -1, 0); }
    else { push(0, dy > 0 ? 1 : -1); }
  });

  var DIR_BY_NAME = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  $('dpad').addEventListener('click', function (e) {
    var btn = e.target.closest('.pad');
    if (!btn) { return; }
    audio.unlock();
    var move = DIR_BY_NAME[btn.dataset.dir];
    push(move[0], move[1]);
  });

  $('difficulty').addEventListener('click', function (e) {
    var btn = e.target.closest('.choice');
    if (btn) { selectDifficulty(btn.dataset.diff, true); }
  });

  document.querySelector('.menu-links').addEventListener('click', function (e) {
    var btn = e.target.closest('.link');
    if (btn) { Sheets.open(btn.dataset.sheet); }
  });

  ui.playBtn.addEventListener('click', function () {
    if (state === 'paused') { togglePause(); } else { startGame(); }
  });

  ui.pauseBtn.addEventListener('click', function () {
    if (state === 'playing' || state === 'paused') { togglePause(); }
  });

  ui.restartBtn.addEventListener('click', startGame);
  ui.statsBtn.addEventListener('click', function () { Sheets.open('stats'); });

  ui.soundBtn.addEventListener('click', function () {
    var value = !P.getSetting('sound');
    P.setSetting('sound', value);
    syncSoundButton();
    if (value) { audio.unlock(); audio.eat(); }
  });

  function syncSoundButton() {
    ui.soundBtn.setAttribute('aria-pressed', String(!!P.getSetting('sound')));
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') { togglePause(); }
  });

  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------------ */
  /* Réglages appliqués en direct                                        */
  /* ------------------------------------------------------------------ */

  function applyTheme() {
    document.documentElement.dataset.theme = P.getSetting('theme');
  }

  Sheets.init({
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* le rendu suivant lit déjà le nouveau skin */ },
    onSettingChange: function (name) {
      if (name === 'theme') { applyTheme(); }
      if (name === 'sound') { syncSoundButton(); }
      // La grille ne peut pas changer sous les pieds du serpent : hors partie,
      // on rejoue la mise en place tout de suite pour que le menu la montre.
      if (name === 'grid' && (state === 'menu' || state === 'over')) {
        resetRun();
        state = 'menu';
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  // Sonde en lecture seule, utilisée par les tests de bout en bout.
  window.__neonSnake = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        cols: COLS,
        skin: P.currentSkin().id,
        score: score,
        combo: combo,
        length: snake.length,
        head: { x: snake[0].x, y: snake[0].y },
        cells: snake.map(function (c) { return c.x + ',' + c.y; }),
        food: food ? { x: food.cell.x, y: food.cell.y } : null,
        powerup: powerup ? { type: powerup.type, x: powerup.cell.x, y: powerup.cell.y } : null,
        obstacles: Object.keys(obstacles),
        totals: P.totals(),
        unlocked: Object.keys(P.unlocked())
      };
    }
  };

  applyTheme();
  resize();
  resetRun();
  selectDifficulty(difficulty);
  syncSoundButton();
  state = 'menu';
  lastFrame = performance.now();
  requestAnimationFrame(frame);
})();
