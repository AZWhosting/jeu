/* Neon Pixel — picross. Les chiffres en marge donnent la longueur des blocs
   pleins de chaque ligne et de chaque colonne. Rien n'est à deviner : chaque
   dessin servi se déduit entièrement, ligne après ligne — c'est vérifié par
   les tests, pas seulement espéré.

   Le remplissage se fait au glissé : on choisit un mode (remplir ou barrer),
   et la première case touchée décide si l'on pose ou si l'on retire. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.pixel;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/pixel/manifest.js': manifest,
    'src/games/pixel/pictures.js': window.PixelPictures
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Pixel : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var CELL_POINTS = 8;          // par case juste remplie
  var PICTURE_BONUS = 150;
  var SPEED_MAX = 240;          // bonus de rapidité, un point par seconde gagnée
  var ERROR_COST = 20;
  var RESTART_GRACE = 700;
  var NEXT_DELAY = 1700;        // temps d'arrêt sur le dessin achevé

  var EMPTY = 0, FILLED = 1, CROSSED = 2;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* Indices                                                             */
  /* ------------------------------------------------------------------ */

  /* Les longueurs des blocs pleins successifs. Une ligne vide donne [0] :
     c'est l'usage, et c'est une information comme une autre. */
  function runsOf(cells) {
    var out = [], run = 0;
    cells.forEach(function (c) {
      if (c) { run++; } else if (run) { out.push(run); run = 0; }
    });
    if (run) { out.push(run); }
    return out.length ? out : [0];
  }

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var picture, index, n, cells, target, rowClues, colClues;
  var lives, errors, slips, filled, needed, startedAt, solvedAt;
  var mode = FILLED;            // remplir ou barrer
  var paint = null;             // glissé en cours
  var badCell, badUntil, particles, history;
  var score, run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function side() { return conf().grid || 10; }
  function pack() { return window.PixelPictures[side()] || []; }
  function best() { return progress.bestFor(difficulty); }
  function at(x, y) { return cells[y * n + x]; }
  function setAt(x, y, v) { cells[y * n + x] = v; }
  function want(x, y) { return target[y * n + x]; }

  function loadPicture(i) {
    index = i;
    picture = pack()[i];
    n = side();
    cells = new Array(n * n).fill(EMPTY);
    target = new Array(n * n).fill(0);
    needed = 0;
    picture.rows.forEach(function (row, y) {
      row.split('').forEach(function (ch, x) {
        var on = ch === '#' ? 1 : 0;
        target[y * n + x] = on;
        if (on) { needed++; }
      });
    });

    rowClues = [];
    colClues = [];
    var x, y, line;
    for (y = 0; y < n; y++) {
      line = [];
      for (x = 0; x < n; x++) { line.push(want(x, y)); }
      rowClues.push(runsOf(line));
    }
    for (x = 0; x < n; x++) {
      line = [];
      for (y = 0; y < n; y++) { line.push(want(x, y)); }
      colClues.push(runsOf(line));
    }

    filled = 0;
    // `errors` compte les fautes de toute la partie ; `slips` celles de ce
    // dessin-ci — c'est lui qui décide si l'image a été sortie sans faute.
    slips = 0;
    history = [];
    badCell = -1;
    badUntil = 0;
    solvedAt = 0;
    startedAt = performance.now();
    if (run) { run.maxPicture = Math.max(run.maxPicture, i + 1); }
    renderHud();
  }

  function resetRun() {
    score = 0;
    errors = 0;
    lives = conf().lives || 0;
    particles = [];
    mode = FILLED;
    paint = null;
    run = progress.newRun(difficulty);
    run.cleanPicture = false;
    run.quickPicture = false;
    runStartedAt = performance.now();
    runCommitted = false;
    loadPicture(0);
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  /* Remplir une case vide est la seule faute possible : barrer ne coûte rien,
     puisque c'est une note du joueur et non une affirmation du jeu. */
  function apply(x, y, value) {
    if (state !== 'playing' || solvedAt) { return false; }
    if (x < 0 || y < 0 || x >= n || y >= n) { return false; }
    var was = at(x, y);
    if (was === value) { return false; }

    if (value === FILLED && !want(x, y)) {
      mistake(x, y);
      return false;
    }

    history.push({ x: x, y: y, was: was });
    setAt(x, y, value);
    if (value === FILLED) {
      filled++;
      score += CELL_POINTS;
      run.cells++;
      audio.blip(300 + Math.min(400, filled * 6), 0.035, 'square', 0.03);
      if (progress.getSetting('autocross')) { autoCross(x, y); }
      if (filled >= needed) { complete(); }
    } else if (was === FILLED) {
      filled--;
      score = Math.max(0, score - CELL_POINTS);
      audio.blip(200, 0.04, 'triangle', 0.03);
    } else {
      audio.blip(240, 0.03, 'triangle', 0.025);
    }
    renderHud();
    return true;
  }

  function mistake(x, y) {
    errors++;
    slips++;
    run.errors++;
    score = Math.max(0, score - ERROR_COST);
    badCell = y * n + x;
    badUntil = performance.now() + 700;
    audio.fail();
    shake();
    renderHud();
    if (conf().forgiving) { return; }
    lives--;
    if (lives <= 0) { finish(false); }
  }

  /* Une ligne dont tous les blocs sont posés n'a plus que du vide : on barre
     le reste, ce que le joueur ferait à la main de toute façon. */
  function autoCross(x, y) {
    var i;
    var lineDone = true;
    for (i = 0; i < n; i++) { if (want(i, y) && at(i, y) !== FILLED) { lineDone = false; break; } }
    if (lineDone) {
      for (i = 0; i < n; i++) { if (!want(i, y) && at(i, y) === EMPTY) { setAt(i, y, CROSSED); } }
    }
    var colDone = true;
    for (i = 0; i < n; i++) { if (want(x, i) && at(x, i) !== FILLED) { colDone = false; break; } }
    if (colDone) {
      for (i = 0; i < n; i++) { if (!want(x, i) && at(x, i) === EMPTY) { setAt(x, i, CROSSED); } }
    }
  }

  function undo() {
    if (state !== 'playing' || !history.length || solvedAt) { return false; }
    var last = history.pop();
    var now = at(last.x, last.y);
    if (now === FILLED) { filled--; score = Math.max(0, score - CELL_POINTS); }
    setAt(last.x, last.y, last.was);
    if (last.was === FILLED) { filled++; score += CELL_POINTS; }
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
    return true;
  }

  /* Un indice déjà honoré peut s'effacer : c'est du bruit en moins. */
  function clueDone(clues, k, line) {
    var runs = runsOf(line.map(function (v) { return v === FILLED ? 1 : 0; }));
    if (runs.length !== clues.length) { return false; }
    for (var i = 0; i < runs.length; i++) { if (runs[i] !== clues[i]) { return false; } }
    return true;
  }

  function rowCells(y) {
    var out = [];
    for (var x = 0; x < n; x++) { out.push(at(x, y)); }
    return out;
  }
  function colCells(x) {
    var out = [];
    for (var y = 0; y < n; y++) { out.push(at(x, y)); }
    return out;
  }

  function complete() {
    solvedAt = performance.now();
    var seconds = (solvedAt - startedAt) / 1000;
    var speed = Math.max(0, Math.round(SPEED_MAX - seconds));
    var gained = Math.round((PICTURE_BONUS + speed) * (conf().bonus || 1));
    score += gained;
    run.score = score;
    run.pictures++;
    if (slips === 0) { run.cleanPicture = true; }
    if (seconds < 120) { run.quickPicture = true; }

    burst(ramp().done, 26);
    floatText(picture.name + ' ! +' + gained, ramp().done);
    audio.unlocked();
    checkUnlocks();
    renderHud();

    setTimeout(function () {
      if (state !== 'playing') { return; }
      if (index + 1 < pack().length) { loadPicture(index + 1); }
      else { finish(true); }
    }, NEXT_DELAY);
  }

  function finish(won) {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : (won ? 'Galerie complète !' : 'Trop d\'erreurs'),
      subtitle: won ? 'Les ' + pack().length + ' dessins sont sortis.'
                    : 'Le dessin était « ' + picture.name +' ».',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Dessins achevés',
        extra: run.pictures,
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
    if (!run || runCommitted || run.cells === 0) {
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

  function shake() {
    if (!effectsOn()) { return; }
    var wrap = document.querySelector('.board-wrap');
    if (!wrap) { return; }
    wrap.classList.remove('shake');
    void wrap.offsetWidth;
    wrap.classList.add('shake');
  }

  function burst(color, count) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.8 + Math.random() * 2.2;
      particles.push({
        x: g.x0 + g.board / 2, y: g.y0 + g.board / 2,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.0022 + Math.random() * 0.002,
        size: 1.5 + Math.random() * 2.5, color: color
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

  function floatText(text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = '50%';
    el.style.top = '50%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 1100);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  /* La marge des indices est taillée sur le dessin en cours : elle vaut
     autant de cases que le plus long paquet d'indices. */
  function geometry() {
    var s = loop.size();
    var pad = s * 0.012;
    var barH = s * 0.062;                    // bandeau des modes, en bas
    var deepest = 2;
    (rowClues || []).forEach(function (c) { deepest = Math.max(deepest, c.length); });
    (colClues || []).forEach(function (c) { deepest = Math.max(deepest, c.length); });
    var units = n + deepest;
    // La grille et ses marges forment un carré : on le centre dans la place
    // qui reste une fois le bandeau retiré, plutôt que de le coller en haut
    // à gauche et de laisser un vide à droite.
    var avail = Math.min(s - pad * 2, s - pad * 2 - barH - s * 0.02);
    var cell = avail / units;
    var gutter = cell * deepest;
    var board = cell * n;
    var whole = gutter + board;
    return { size: s, pad: pad, cell: cell, gutter: gutter, board: board, deepest: deepest,
             x0: (s - whole) / 2 + gutter,
             y0: (s - pad - barH - s * 0.02 - whole) / 2 + gutter,
             barY: s - pad - barH, barH: barH };
  }

  function modeBoxes(g) {
    var w = Math.min(g.size * 0.26, 130);
    var gap = g.size * 0.014;
    return [
      { id: FILLED,  label: '◼ Remplir', x: g.size / 2 - w - gap / 2, y: g.barY, w: w, h: g.barH },
      { id: CROSSED, label: '✕ Barrer',  x: g.size / 2 + gap / 2,     y: g.barY, w: w, h: g.barH }
    ];
  }

  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;
    if (py >= g.barY) {
      var boxes = modeBoxes(g);
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        if (px >= box.x && px <= box.x + box.w) { return { t: 'mode', id: box.id }; }
      }
      return null;
    }
    var x = Math.floor((px - g.x0) / g.cell);
    var y = Math.floor((py - g.y0) / g.cell);
    if (x < 0 || y < 0 || x >= n || y >= n) { return null; }
    return { t: 'cell', x: x, y: y };
  }

  /* ------------------------------------------------------------------ */
  /* Saisie                                                              */
  /* ------------------------------------------------------------------ */

  /* La première case touchée décide : si elle est déjà dans le mode courant,
     le glissé retire ; sinon il pose. Tout le trait suit cette décision. */
  function grab(pos) {
    if (state !== 'playing' || solvedAt) { return false; }
    var spot = locate(pos);
    if (!spot) { return false; }
    if (spot.t === 'mode') {
      mode = spot.id;
      audio.blip(360, 0.04, 'square', 0.03);
      return false;
    }
    var current = at(spot.x, spot.y);
    paint = { value: current === mode ? EMPTY : mode, seen: {} };
    stroke(spot.x, spot.y);
    audio.unlock();
    return true;
  }

  function stroke(x, y) {
    if (!paint) { return; }
    var key = x + ',' + y;
    if (paint.seen[key]) { return; }
    paint.seen[key] = true;
    apply(x, y, paint.value);
  }

  function dragTo(pos) {
    if (!paint) { return; }
    var spot = locate(pos);
    if (spot && spot.t === 'cell') { stroke(spot.x, spot.y); }
  }

  function drop() { paint = null; }

  function secondary(pos) {
    if (state !== 'playing' || solvedAt) { return; }
    var spot = locate(pos);
    if (!spot || spot.t !== 'cell') { return; }
    var current = at(spot.x, spot.y);
    apply(spot.x, spot.y, current === CROSSED ? EMPTY : CROSSED);
  }

  function toggleMode() {
    mode = (mode === FILLED) ? CROSSED : FILLED;
    audio.blip(360, 0.04, 'square', 0.03);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function fillColor(x, y) {
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((x * 23 + y * 37) % 360) + ', 75%, 60%)'; }
    return ramp().fill;
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
    if (badCell >= 0 && now > badUntil) { badCell = -1; }
    ctx.clearRect(0, 0, g.size, g.size);
    if (!cells) { return; }

    var grey = progress.getSetting('numbers');
    var i, x, y;

    // Indices des lignes, à gauche.
    ctx.save();
    ctx.font = '600 ' + Math.round(g.cell * 0.52) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (y = 0; y < n; y++) {
      var rc = rowClues[y];
      var satisfied = grey && clueDone(rc, y, rowCells(y));
      ctx.fillStyle = satisfied ? 'rgba(139, 154, 192, 0.35)' : ramp().clue;
      for (i = 0; i < rc.length; i++) {
        var cx = g.x0 - (rc.length - i) * g.cell + g.cell / 2;
        ctx.fillText(String(rc[i]), cx, g.y0 + y * g.cell + g.cell / 2);
      }
    }
    // Indices des colonnes, en haut.
    for (x = 0; x < n; x++) {
      var cc = colClues[x];
      var okCol = grey && clueDone(cc, x, colCells(x));
      ctx.fillStyle = okCol ? 'rgba(139, 154, 192, 0.35)' : ramp().clue;
      for (i = 0; i < cc.length; i++) {
        var cy = g.y0 - (cc.length - i) * g.cell + g.cell / 2;
        ctx.fillText(String(cc[i]), g.x0 + x * g.cell + g.cell / 2, cy);
      }
    }
    ctx.restore();

    // La grille.
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        var px = g.x0 + x * g.cell, py = g.y0 + y * g.cell;
        var v = at(x, y);
        var bad = badCell === y * n + x;

        ctx.save();
        if (v === FILLED || bad) {
          ctx.fillStyle = bad ? ramp().bad : fillColor(x, y);
          if (solvedAt) { ctx.shadowColor = fillColor(x, y); ctx.shadowBlur = 8; }
          roundRect(px + 1, py + 1, g.cell - 2, g.cell - 2, g.cell * 0.16);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(120, 150, 200, 0.06)';
          roundRect(px + 1, py + 1, g.cell - 2, g.cell - 2, g.cell * 0.16);
          ctx.fill();
          if (v === CROSSED) {
            ctx.strokeStyle = ramp().cross;
            ctx.lineWidth = Math.max(1, g.cell * 0.07);
            ctx.beginPath();
            ctx.moveTo(px + g.cell * 0.30, py + g.cell * 0.30);
            ctx.lineTo(px + g.cell * 0.70, py + g.cell * 0.70);
            ctx.moveTo(px + g.cell * 0.70, py + g.cell * 0.30);
            ctx.lineTo(px + g.cell * 0.30, py + g.cell * 0.70);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Traits de repère tous les cinq, pour compter d'un coup d'œil.
    ctx.save();
    ctx.strokeStyle = ramp().grid;
    ctx.lineWidth = 1.5;
    for (i = 0; i <= n; i += 5) {
      ctx.beginPath();
      ctx.moveTo(Math.round(g.x0 + i * g.cell) + 0.5, g.y0 - g.gutter);
      ctx.lineTo(Math.round(g.x0 + i * g.cell) + 0.5, g.y0 + g.board);
      ctx.moveTo(g.x0 - g.gutter, Math.round(g.y0 + i * g.cell) + 0.5);
      ctx.lineTo(g.x0 + g.board, Math.round(g.y0 + i * g.cell) + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Bandeau : le mode actif, le dessin en cours, les vies restantes.
    ctx.save();
    modeBoxes(g).forEach(function (box) {
      var on = box.id === mode;
      ctx.fillStyle = on ? ramp().fill : 'rgba(120, 150, 200, 0.14)';
      roundRect(box.x, box.y, box.w, box.h, box.h * 0.30);
      ctx.fill();
      if (!on) {
        ctx.strokeStyle = ramp().grid;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = on ? '#06121a' : '#e8eefc';
      ctx.font = '600 ' + Math.max(11, Math.round(box.h * 0.38)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(box.label, box.x + box.w / 2, box.y + box.h * 0.54);
    });
    ctx.font = '600 ' + Math.max(10, Math.round(g.barH * 0.34)) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText((index + 1) + ' / ' + pack().length, g.pad, g.barY + g.barH / 2);
    if (!conf().forgiving) {
      ctx.textAlign = 'right';
      ctx.fillStyle = lives <= 1 ? ramp().bad : 'rgba(139, 154, 192, 0.9)';
      ctx.fillText('♥ '.repeat(Math.max(0, lives)).trim() || '—',
                   g.size - g.pad, g.barY + g.barH / 2);
    }
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
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: (index + 1) + ' / ' + pack().length,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Cases',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : filled
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
      paint = null;
      panel.show({ title: 'Pause', subtitle: 'Le dessin t\'attend.', cta: 'Reprendre',
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

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  hud = Core.createHud(progress);
  panel = Core.createPanel(function () {
    if (state === 'paused') { togglePause(); } else { startGame(); }
  }, function () { quitToHub(); });

  sheets = Core.createSheets(progress, {
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* la palette est relue à chaque image */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // rien ne bouge sans le joueur
    render: draw
  });
  ctx = loop.ctx;

  Core.attachInput({
    canvas: canvas,
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onDragStart: grab,
    onDragMove: dragTo,
    onDragEnd: drop,
    onSecondary: secondary,
    onAction: function () { if (!guardedStart()) { togglePause(); } },
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    keys: { x: toggleMode, z: undo }
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
  /* Sonde de test et démarrage                                          */
  /* ------------------------------------------------------------------ */

  window.__neonPixel = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        n: n,
        picture: picture.name,
        index: index,
        pictures: pack().length,
        cells: cells.slice(),
        target: target.slice(),
        rowClues: rowClues.map(function (c) { return c.slice(); }),
        colClues: colClues.map(function (c) { return c.slice(); }),
        filled: filled,
        needed: needed,
        lives: lives,
        errors: errors,
        slips: slips,
        mode: mode,
        solved: !!solvedAt,
        score: score,
        done: run ? run.pictures : 0,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    packs: function () { return window.PixelPictures; },
    goTo: function (i) { loadPicture(i); },
    setMode: function (m) { mode = m; },
    fill: function (x, y) { return apply(x, y, FILLED); },
    cross: function (x, y) { return apply(x, y, CROSSED); },
    clear: function (x, y) { return apply(x, y, EMPTY); },
    undo: undo,
    // Remplit toutes les cases du dessin : de quoi éprouver la fin de tableau.
    solve: function () {
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          if (want(x, y) && at(x, y) !== FILLED) { apply(x, y, FILLED); }
        }
      }
      return filled >= needed;
    },
    geometry: geometry,
    locate: function (x, y) { return locate({ x: x, y: y }); }
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
