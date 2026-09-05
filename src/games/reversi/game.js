/* Neon Reversi — l'othello contre une IA.

   Le plateau ne bouge qu'entre deux coups : la boucle du socle ne sert qu'à
   l'animation des pions qui se retournent.

   L'adversaire n'a pas le confort du puissance 4, où un alignement tranche : à
   l'othello, rien ne se gagne avant la dernière case, et une position se juge.
   Il l'évalue sur trois choses — la valeur des cases tenues, les coins qui ne
   se retournent jamais, et la mobilité, c'est-à-dire le nombre de coups qui
   restent à chacun. Quand il ne reste plus que quelques cases vides, il cesse
   d'estimer et calcule la fin réelle. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.reversi;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/reversi/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Reversi : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  /* ------------------------------------------------------------------ */
  /* Constantes                                                          */
  /* ------------------------------------------------------------------ */

  var N = 8, CELLS = 64;
  var YOU = 1, AI = 2;
  var DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];
  var FLIP_MS = 300;                    // durée du retournement
  var THINK_MS = 260;                   // temps de réflexion affiché
  var MOVE_POINTS = 8, FLIP_POINTS = 2;
  var RESTART_GRACE = 700;
  var WIN_SCORE = 1000000;
  var CORNERS = [0, 7, 56, 63];

  /* La valeur des cases. Les coins ne se retournent jamais et valent cher ;
     leurs voisines les offrent et valent négatif. */
  var BASE = [
    120, -20,  20,   5,   5,  20, -20, 120,
    -20, -40,  -5,  -5,  -5,  -5, -40, -20,
     20,  -5,  15,   3,   3,  15,  -5,  20,
      5,  -5,   3,   3,   3,   3,  -5,   5,
      5,  -5,   3,   3,   3,   3,  -5,   5,
     20,  -5,  15,   3,   3,  15,  -5,  20,
    -20, -40,  -5,  -5,  -5,  -5, -40, -20,
    120, -20,  20,   5,   5,  20, -20, 120
  ];
  /* Une case voisine d'un coin n'est empoisonnée que tant que ce coin est
     libre : une fois le coin pris, elle redevient une case ordinaire. */
  var NEAR = {
    1: 0, 8: 0, 9: 0,
    6: 7, 15: 7, 14: 7,
    48: 56, 57: 56, 49: 56,
    55: 63, 62: 63, 54: 63
  };
  /* Ordre d'exploration : les coins d'abord, l'élagage y gagne beaucoup. */
  var ORDER = (function () {
    var list = [];
    for (var i = 0; i < CELLS; i++) { list.push(i); }
    return list.sort(function (a, b) { return BASE[b] - BASE[a]; });
  }());

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
  var board, turn, cursor, busy, flip, lastMove, history, particles, passed;
  var score, moves, alternateStart;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function other(disc) { return disc === YOU ? AI : YOU; }

  function firstPlayer() {
    var setting = progress.getSetting('first');
    if (setting === 'ai') { return AI; }
    if (setting === 'alternate') { return alternateStart ? AI : YOU; }
    return YOU;
  }

  function opening() {
    var b = new Array(CELLS).fill(0);
    b[27] = YOU; b[36] = YOU;           // d4 et e5
    b[28] = AI;  b[35] = AI;            // e4 et d5
    return b;
  }

  function resetRun() {
    board = opening();
    cursor = 26;
    busy = false;
    flip = null;
    lastMove = -1;
    passed = null;
    history = [];
    particles = [];
    score = 0;
    moves = 0;
    run = progress.newRun(difficulty);
    run.bestFlip = 0;
    run.wasLow = false;
    runStartedAt = performance.now();
    runCommitted = false;
    turn = firstPlayer();
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  /* Les pions qu'un coup retournerait — vide si le coup est illégal. Le pas
     d'une direction ne doit pas sauter d'un bord à l'autre : on compare aussi
     les colonnes. */
  function flipsFor(b, idx, disc) {
    if (b[idx] !== 0) { return []; }
    var foe = other(disc);
    var out = [];
    for (var d = 0; d < DIRS.length; d++) {
      var step = DIRS[d];
      var line = [];
      var at = idx, col = idx % N;
      for (;;) {
        var next = at + step;
        var ncol = next % N;
        if (next < 0 || next >= CELLS) { break; }
        // Un pas horizontal ou diagonal ne change la colonne que d'une case.
        if (step !== -8 && step !== 8 && Math.abs(ncol - col) !== 1) { break; }
        if (b[next] === foe) { line.push(next); at = next; col = ncol; continue; }
        if (b[next] === disc && line.length) { out = out.concat(line); }
        break;
      }
    }
    return out;
  }

  /* Le coup est-il légal ? Le même parcours que `flipsFor`, mais sans rien
     construire : l'évaluation le demande des dizaines de milliers de fois par
     coup, et une liste allouée à chaque case coûtait plus cher que la recherche
     elle-même. */
  function canPlay(b, idx, disc) {
    if (b[idx] !== 0) { return false; }
    var foe = other(disc);
    for (var d = 0; d < DIRS.length; d++) {
      var step = DIRS[d];
      var at = idx, col = idx % N, vus = 0;
      for (;;) {
        var next = at + step;
        if (next < 0 || next >= CELLS) { break; }
        var ncol = next % N;
        if (step !== -8 && step !== 8 && Math.abs(ncol - col) !== 1) { break; }
        if (b[next] === foe) { vus++; at = next; col = ncol; continue; }
        if (b[next] === disc && vus) { return true; }
        break;
      }
    }
    return false;
  }

  function legalMoves(b, disc) {
    var out = [];
    for (var k = 0; k < CELLS; k++) {
      var i = ORDER[k];
      if (canPlay(b, i, disc)) { out.push(i); }
    }
    return out;
  }

  function hasMove(b, disc) {
    for (var i = 0; i < CELLS; i++) {
      if (canPlay(b, i, disc)) { return true; }
    }
    return false;
  }

  function mobility(b, disc) {
    var n = 0;
    for (var i = 0; i < CELLS; i++) { if (canPlay(b, i, disc)) { n++; } }
    return n;
  }

  function count(b, disc) {
    var n = 0;
    for (var i = 0; i < CELLS; i++) { if (b[i] === disc) { n++; } }
    return n;
  }

  function empties(b) { return count(b, 0); }

  /* ------------------------------------------------------------------ */
  /* L'adversaire                                                        */
  /* ------------------------------------------------------------------ */

  function weight(b, i) {
    var w = BASE[i];
    if (w < 0 && NEAR[i] !== undefined && b[NEAR[i]] !== 0) { return 3; }
    return w;
  }

  /* Trois termes : la valeur des cases tenues, l'écart de mobilité, et — quand
     la fin approche — le compte des pions, qui est alors le seul enjeu. Un seul
     parcours du plateau les alimente tous. */
  function evaluate(b, disc) {
    var foe = other(disc);
    var mine = 0, theirs = 0, libres = 0, pos = 0;
    for (var i = 0; i < CELLS; i++) {
      var v = b[i];
      if (v === 0) { libres++; }
      else if (v === disc) { mine++; pos += weight(b, i); }
      else { theirs++; pos -= weight(b, i); }
    }
    if (libres <= 8) { return 120 * (mine - theirs); }
    var m = mobility(b, disc), t = mobility(b, foe);
    var mobilite = (m + t) ? 90 * (m - t) / (m + t) : 0;
    return pos + Math.round(mobilite);
  }

  function applyMove(b, idx, disc, flips) {
    b[idx] = disc;
    for (var i = 0; i < flips.length; i++) { b[flips[i]] = disc; }
  }

  function undoMove(b, idx, disc, flips) {
    b[idx] = 0;
    var foe = other(disc);
    for (var i = 0; i < flips.length; i++) { b[flips[i]] = foe; }
  }

  function negamax(b, depth, alpha, beta, disc, skipped) {
    var options = legalMoves(b, disc);
    if (!options.length) {
      // Deux passes de suite : la partie est finie, on compte.
      if (skipped) {
        var ecart = count(b, disc) - count(b, other(disc));
        return ecart > 0 ? WIN_SCORE + ecart : (ecart < 0 ? -WIN_SCORE + ecart : 0);
      }
      return -negamax(b, depth, -beta, -alpha, other(disc), true);
    }
    if (depth === 0) { return evaluate(b, disc); }

    var bestValue = -Infinity;
    for (var i = 0; i < options.length; i++) {
      var idx = options[i];
      var flips = flipsFor(b, idx, disc);
      applyMove(b, idx, disc, flips);
      var value = -negamax(b, depth - 1, -beta, -alpha, other(disc), false);
      undoMove(b, idx, disc, flips);
      if (value > bestValue) { bestValue = value; }
      if (bestValue > alpha) { alpha = bestValue; }
      if (alpha >= beta) { break; }
    }
    return bestValue;
  }

  function chooseMove() {
    var options = legalMoves(board, AI);
    if (!options.length) { return -1; }
    var c = conf();

    if (c.depth <= 0 || Math.random() < (c.blunder || 0)) {
      /* Même maladroit, il ne laisse pas passer un coin : c'est la seule case
         qu'aucun coup ne pourra jamais lui reprendre. Le mode zen, lui, joue
         vraiment au hasard. */
      if (c.depth > 0) {
        var coins = options.filter(function (i) { return CORNERS.indexOf(i) >= 0; });
        if (coins.length) { return coins[0]; }
      }
      return options[Math.floor(Math.random() * options.length)];
    }

    // Assez peu de cases vides : on ne devine plus, on calcule la fin.
    var libres = empties(board);
    var depth = libres <= (c.exact || 0) ? libres : c.depth;

    var bestValue = -Infinity;
    var bestIdx = options[0];
    var copy = board.slice();
    for (var k = 0; k < options.length; k++) {
      var idx = options[k];
      var flips = flipsFor(copy, idx, AI);
      applyMove(copy, idx, AI, flips);
      var value = -negamax(copy, depth - 1, -Infinity, Infinity, YOU, false);
      undoMove(copy, idx, AI, flips);
      if (value > bestValue) { bestValue = value; bestIdx = idx; }
    }
    return bestIdx;
  }

  function scheduleAi() {
    if (state !== 'playing') { return; }
    busy = true;
    renderHud();
    setTimeout(function () {
      if (state !== 'playing') { busy = false; return; }
      var idx = chooseMove();
      // Ne devrait pas arriver — `advance` ne lui rend la main que s'il peut
      // poser — mais s'il n'a rien, il passe plutôt que de bloquer la partie.
      if (idx < 0) { busy = false; advance(); return; }
      place(idx, AI);
    }, THINK_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Coups                                                               */
  /* ------------------------------------------------------------------ */

  function place(idx, disc) {
    var flips = flipsFor(board, idx, disc);
    if (!flips.length) { return false; }
    history.push({ board: board.slice(), turn: turn, moves: moves, score: score });
    applyMove(board, idx, disc, flips);
    flip = { cells: flips.slice(), disc: disc, at: idx, start: performance.now() };
    lastMove = idx;
    busy = true;
    passed = null;

    moves++;
    run.moves++;
    run.flips += flips.length;
    if (disc === YOU) {
      score += MOVE_POINTS + flips.length * FLIP_POINTS;
      run.score = score;
      run.bestFlip = Math.max(run.bestFlip, flips.length);
      if (CORNERS.indexOf(idx) >= 0) {
        run.corners++;
        floatText(idx, 'Un coin !', palette().hint);
      }
      if (count(board, YOU) <= 5) { run.wasLow = true; }
    }
    audio.pickup();
    renderHud();
    return true;
  }

  function play(idx) {
    if (state !== 'playing' || busy || turn !== YOU) { return false; }
    if (!place(idx, YOU)) {
      audio.blip(120, 0.07, 'square', 0.03);
      return false;
    }
    return true;
  }

  /* Après le retournement : au suivant, sauf s'il ne peut pas poser. */
  function advance() {
    busy = false;
    var next = other(turn);
    if (hasMove(board, next)) {
      turn = next;
    } else if (hasMove(board, turn)) {
      passed = next;
      floatText(lastMove >= 0 ? lastMove : 27,
                (next === AI ? 'L\'adversaire passe' : 'Tu passes'), '#8b9ac0');
      audio.blip(180, 0.09, 'triangle', 0.04);
    } else {
      finish();
      return;
    }
    checkUnlocks();
    renderHud();
    if (turn === AI) { scheduleAi(); }
  }

  /* Zen : revenir sur son coup, et sur la réponse de l'adversaire. */
  function undo() {
    if (!forgiving() || state !== 'playing' || busy || !history.length) { return false; }
    var snap = history.pop();
    // Remonter jusqu'à une position où c'est de nouveau à toi de jouer.
    while (snap.turn !== YOU && history.length) { snap = history.pop(); }
    board = snap.board.slice();
    turn = YOU;
    moves = snap.moves;
    score = snap.score;
    run.moves = moves;
    run.score = score;
    flip = null;
    lastMove = -1;
    passed = null;
    floatText(27, 'Coup annulé', '#8b9ac0');
    audio.bonus();
    renderHud();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Issue                                                               */
  /* ------------------------------------------------------------------ */

  function finish() {
    state = 'over';
    overSince = performance.now();
    busy = false;
    flip = null;

    var mine = count(board, YOU), theirs = count(board, AI);
    var c = conf();
    run.best = Math.max(run.best, mine);

    var outcome = mine > theirs ? 'win' : (mine < theirs ? 'loss' : 'draw');
    if (outcome === 'win') {
      run.wins = 1;
      score += c.base + (mine - theirs) * 6;
      burst(palette().you, 30);
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

    if (progress.getSetting('first') === 'alternate') { alternateStart = !alternateStart; }

    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();

    panel.show({
      title: outcome === 'win' ? (beaten ? 'Nouveau record !' : 'Gagné !')
           : outcome === 'draw' ? 'Match nul' : 'Perdu',
      subtitle: mine + ' pions contre ' + theirs + '.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Tes pions',
        extra: mine,
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

  function burst(color, n) {
    if (!effectsOn()) { return; }
    var g = geometry();
    for (var i = 0; i < n; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.16;
      particles.push({
        x: g.x + g.cell * N / 2, y: g.y + g.cell * N / 2,
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

  function floatText(idx, text, color) {
    if (!effectsOn()) { return; }
    var g = geometry();
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = ((g.x + (idx % N + 0.5) * g.cell) / g.size * 100) + '%';
    el.style.top = ((g.y + (Math.floor(idx / N) + 0.5) * g.cell) / g.size * 100) + '%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function palette() {
    var skin = progress.currentSkin();
    return skin.palette || manifest.palettes.neon;
  }

  function discColor(disc, idx) {
    var skin = progress.currentSkin();
    if (skin.rainbow) {
      var teinte = (idx % N * 26 + Math.floor(idx / N) * 12) % 360;
      return disc === YOU ? 'hsl(' + teinte + ', 85%, 62%)'
                          : 'hsl(' + ((teinte + 180) % 360) + ', 85%, 66%)';
    }
    return disc === YOU ? palette().you : palette().ai;
  }

  function geometry() {
    var size = loop.size();
    var cell = Math.min(size * 0.94, size * 0.94) / N;
    return { cell: cell, x: (size - cell * N) / 2, y: (size - cell * N) / 2, size: size };
  }

  function cellAt(pos) {
    var g = geometry();
    var x = Math.floor((pos.x * g.size - g.x) / g.cell);
    var y = Math.floor((pos.y * g.size - g.y) / g.cell);
    if (x < 0 || y < 0 || x >= N || y >= N) { return null; }
    return y * N + x;
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

  /* Un pion. `squash` écrase le disque horizontalement : c'est ce qui donne le
     retournement, le pion changeant de couleur au passage à plat. */
  function drawDisc(cx, cy, r, color, squash, glow) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.04, squash === undefined ? 1 : squash), 1);
    ctx.shadowColor = color;
    ctx.shadowBlur = glow || 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    var r = g.cell * 0.38;
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!board) { return; }

    // Le retournement en cours, et la suite de la partie une fois fini.
    var flipping = {};
    if (flip) {
      var p = clamp((now - flip.start) / FLIP_MS, 0, 1);
      if (now - flip.start >= FLIP_MS) {
        flip = null;
        // La partie a pu s'arrêter pendant l'animation : on ne relance rien.
        if (state === 'playing') { advance(); }
      } else {
        for (var f = 0; f < flip.cells.length; f++) { flipping[flip.cells[f]] = p; }
      }
    }

    // Le tapis.
    ctx.fillStyle = palette().board;
    roundRect(g.x, g.y, g.cell * N, g.cell * N, g.cell * 0.12);
    ctx.fill();

    ctx.strokeStyle = palette().line;
    ctx.lineWidth = 1;
    for (var k = 1; k < N; k++) {
      ctx.beginPath();
      ctx.moveTo(g.x + k * g.cell, g.y);
      ctx.lineTo(g.x + k * g.cell, g.y + g.cell * N);
      ctx.moveTo(g.x, g.y + k * g.cell);
      ctx.lineTo(g.x + g.cell * N, g.y + k * g.cell);
      ctx.stroke();
    }
    ctx.strokeStyle = palette().line;
    ctx.lineWidth = 1.5;
    roundRect(g.x, g.y, g.cell * N, g.cell * N, g.cell * 0.12);
    ctx.stroke();

    // Les coups possibles, et le compte des retournements sur la case visée.
    var jouables = [];
    if (state === 'playing' && turn === YOU && !busy) { jouables = legalMoves(board, YOU); }
    if (progress.getSetting('guide')) {
      ctx.fillStyle = palette().hint;
      jouables.forEach(function (i) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(g.x + (i % N + 0.5) * g.cell, g.y + (Math.floor(i / N) + 0.5) * g.cell,
                r * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // Les pions.
    for (var i = 0; i < CELLS; i++) {
      var disc = board[i];
      if (!disc) { continue; }
      var cx = g.x + (i % N + 0.5) * g.cell;
      var cy = g.y + (Math.floor(i / N) + 0.5) * g.cell;
      var t = flipping[i];
      if (t === undefined) {
        drawDisc(cx, cy, r, discColor(disc, i), 1, i === lastMove ? 20 : 12);
      } else {
        // À mi-course le pion est à plat : c'est là qu'il change de camp.
        var couleur = t < 0.5 ? discColor(other(disc), i) : discColor(disc, i);
        drawDisc(cx, cy, r, couleur, Math.abs(Math.cos(t * Math.PI)), 14);
      }
    }

    // La case visée.
    if (state === 'playing') {
      var vx = g.x + (cursor % N) * g.cell, vy = g.y + Math.floor(cursor / N) * g.cell;
      ctx.strokeStyle = jouables.indexOf(cursor) >= 0 ? palette().hint : 'rgba(232, 238, 252, 0.30)';
      ctx.lineWidth = Math.max(1.5, g.cell * 0.055);
      roundRect(vx + 2, vy + 2, g.cell - 4, g.cell - 4, g.cell * 0.16);
      ctx.stroke();

      if (progress.getSetting('count') && turn === YOU && !busy) {
        var gains = flipsFor(board, cursor, YOU).length;
        if (gains) {
          ctx.save();
          ctx.fillStyle = palette().hint;
          ctx.font = '700 ' + Math.round(g.cell * 0.42) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+' + gains, vx + g.cell / 2, vy + g.cell / 2);
          ctx.restore();
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
    var mine = board ? count(board, YOU) : 2;
    var theirs = board ? count(board, AI) : 2;
    hud.set({
      score: score,
      side: mine + ' – ' + theirs,
      sideVisible: state === 'playing' || state === 'paused' || state === 'over',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Pions posés',
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
      panel.show({ title: 'Pause', subtitle: 'Le plateau t\'attend.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      loop.resetClock();
      panel.hide();
      if (turn === AI && !flip) { scheduleAi(); }
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
    var x = clamp(cursor % N + dx, 0, N - 1);
    var y = clamp(Math.floor(cursor / N) + dy, 0, N - 1);
    cursor = y * N + x;
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
    running: function () { return false; },  // rien n'avance seul : le retournement est animé au rendu
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
      var i = cellAt(pos);
      if (i !== null) { cursor = i; }
    },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var i = cellAt(pos);
      if (i !== null) { cursor = i; play(i); }
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
  /* Sonde de test et démarrage                                          */
  /* ------------------------------------------------------------------ */

  window.__neonReversi = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        turn: turn === YOU ? 'you' : 'ai',
        busy: busy,
        flipping: !!flip,
        cursor: cursor,
        lastMove: lastMove,
        passed: passed === AI ? 'ai' : (passed === YOU ? 'you' : null),
        board: board.slice(),
        you: count(board, YOU),
        ai: count(board, AI),
        empties: empties(board),
        legal: legalMoves(board, turn),
        moves: moves,
        score: score,
        corners: run ? run.corners : 0,
        flips: run ? run.flips : 0,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : poser une position, faire jouer un camp.
    setBoard: function (values, who) {
      board = values.slice();
      flip = null;
      lastMove = -1;
      passed = null;
      busy = false;
      history = [];
      if (who) { turn = who === 'ai' ? AI : YOU; }
      renderHud();
    },
    flipsFor: function (idx, who) {
      return flipsFor(board, idx, who === 'ai' ? AI : YOU);
    },
    legalFor: function (who) { return legalMoves(board, who === 'ai' ? AI : YOU); },
    hasMove: function (who) { return hasMove(board, who === 'ai' ? AI : YOU); },
    play: function (idx) { return play(idx); },
    // Poser un coup sans animation ni tour suivant : pour construire une position.
    force: function (idx, who) {
      var disc = who === 'ai' ? AI : YOU;
      var flips = flipsFor(board, idx, disc);
      if (!flips.length) { return false; }
      applyMove(board, idx, disc, flips);
      renderHud();
      return true;
    },
    aiMove: function () { return chooseMove(); },
    evaluate: function (who) { return evaluate(board, who === 'ai' ? AI : YOU); },
    setTurn: function (who) {
      turn = who === 'ai' ? AI : YOU;
      busy = false;
      renderHud();
      if (turn === AI && state === 'playing') { scheduleAi(); }
    },
    advance: function () { advance(); },
    finish: function () { finish(); },
    undo: undo,
    geometry: geometry,
    cellRatio: function (idx) {
      var g = geometry();
      return { x: (g.x + (idx % N + 0.5) * g.cell) / g.size,
               y: (g.y + (Math.floor(idx / N) + 0.5) * g.cell) / g.size };
    }
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
