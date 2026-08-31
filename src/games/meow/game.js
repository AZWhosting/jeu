/* Neon Meow — casse-tête de déduction. Chaque grille est tirée au sort puis
   vérifiée : si elle admet plus d'une solution, elle est jetée et retirée.
   Aucune partie ne demande donc de deviner. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.meow;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/meow/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Meow : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var EMPTY = 0, CAT = 1, CROSS = 2;
  var HINT_COST = 50;
  var TIME_BONUS = 300;         // points, moins un par seconde
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
  var N, regions, solution, cells, cursor, hintsUsed, gridStartedAt, elapsedMs;
  var score, grids, particles, solvedAt;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function forgiving() { return !!conf().forgiving; }
  function best() { return progress.bestFor(difficulty); }
  function idx(x, y) { return y * N + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  function seconds() { return Math.floor(elapsedMs / 1000); }

  /* ------------------------------------------------------------------ */
  /* Génération : une solution, des territoires, puis une vérification    */
  /* ------------------------------------------------------------------ */

  function shuffled(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  /* Une colonne par ligne, toutes distinctes, et jamais deux chats côte à
     côte en diagonale : d'une ligne à l'autre, deux colonnes d'écart. */
  function randomSolution(n) {
    var cols = [];
    function place(row) {
      if (row === n) { return true; }
      var options = shuffled(Array.apply(null, { length: n }).map(function (_, i) { return i; }));
      for (var k = 0; k < options.length; k++) {
        var c = options[k];
        if (cols.indexOf(c) !== -1) { continue; }
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) { continue; }
        cols.push(c);
        if (place(row + 1)) { return true; }
        cols.pop();
      }
      return false;
    }
    return place(0) ? cols : null;
  }

  /* Territoires : on part des cases des chats et on fait grandir chaque
     région au hasard, ce qui les garde connexes. */
  function growRegions(n, cats) {
    var region = new Array(n * n).fill(-1);
    var frontier = cats.map(function (cell, i) { region[cell] = i; return [cell]; });
    var remaining = n * n - n;
    var guard = 0;

    while (remaining > 0 && guard++ < n * n * 40) {
      var live = [];
      for (var i = 0; i < frontier.length; i++) { if (frontier[i].length) { live.push(i); } }
      if (!live.length) { break; }
      var r = live[Math.floor(Math.random() * live.length)];
      var pick = Math.floor(Math.random() * frontier[r].length);
      var cell = frontier[r][pick];
      var cx = cell % n, cy = Math.floor(cell / n);
      var neighbours = shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      var grew = false;

      for (var d = 0; d < neighbours.length; d++) {
        var nx = cx + neighbours[d][0], ny = cy + neighbours[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) { continue; }
        var ni = ny * n + nx;
        if (region[ni] !== -1) { continue; }
        region[ni] = r;
        frontier[r].push(ni);
        remaining--;
        grew = true;
        break;
      }
      if (!grew) { frontier[r].splice(pick, 1); }
    }
    return remaining === 0 ? region : null;
  }

  /* Énumère les solutions, en s'arrêtant dès qu'on en a trouvé `limit`. */
  function findSolutions(n, region, limit) {
    var out = [];
    var cols = [];
    var usedCol = {}, usedRegion = {};

    function rec(row) {
      if (out.length >= limit) { return; }
      if (row === n) {
        out.push(cols.map(function (c, r) { return r * n + c; }));
        return;
      }
      for (var c = 0; c < n; c++) {
        if (usedCol[c]) { continue; }
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) { continue; }
        var r = region[row * n + c];
        if (usedRegion[r]) { continue; }
        cols.push(c);
        usedCol[c] = true;
        usedRegion[r] = true;
        rec(row + 1);
        cols.pop();
        delete usedCol[c];
        delete usedRegion[r];
        if (out.length >= limit) { return; }
      }
    }
    rec(0);
    return out;
  }

  function countSolutions(n, region, limit) {
    return findSolutions(n, region, limit || 2).length;
  }

  function regionConnected(region, n, id) {
    var cells = [];
    for (var i = 0; i < region.length; i++) { if (region[i] === id) { cells.push(i); } }
    if (!cells.length) { return false; }
    var seen = {};
    var stack = [cells[0]];
    seen[cells[0]] = true;
    var count = 0;
    while (stack.length) {
      var cell = stack.pop();
      count++;
      var x = cell % n, y = Math.floor(cell / n);
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var nx = x + dirs[d][0], ny = y + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) { continue; }
        var ni = ny * n + nx;
        if (region[ni] !== id || seen[ni]) { continue; }
        seen[ni] = true;
        stack.push(ni);
      }
    }
    return count === cells.length;
  }

  /* Tant qu'une autre solution existe, on la casse : une de ses cases — jamais
     une case de la vraie solution — change de territoire. Le territoire qui la
     reçoit se retrouve alors avec deux chats dans cette solution parasite, qui
     devient invalide, tandis que la vraie solution reste intacte. */
  function repair(n, region, solution) {
    var isSolution = {};
    solution.forEach(function (c) { isSolution[c] = true; });

    for (var iter = 0; iter < 400; iter++) {
      var sols = findSolutions(n, region, 2);
      if (sols.length === 1) { return true; }
      if (!sols.length) { return false; }

      var alt = sols[0].join(',') === solution.join(',') ? sols[1] : sols[0];
      if (!alt) { return false; }
      var candidates = shuffled(alt.filter(function (c) { return !isSolution[c]; }));
      var moved = false;

      for (var k = 0; k < candidates.length && !moved; k++) {
        var cell = candidates[k];
        var from = region[cell];
        var x = cell % n, y = Math.floor(cell / n);
        var options = [];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) { return; }
          var r = region[ny * n + nx];
          if (r !== from && options.indexOf(r) === -1) { options.push(r); }
        });

        var choices = shuffled(options);
        for (var o = 0; o < choices.length; o++) {
          region[cell] = choices[o];
          // Le territoire d'origine doit rester d'un seul tenant.
          if (regionConnected(region, n, from)) { moved = true; break; }
          region[cell] = from;
        }
      }
      if (!moved) { return false; }
    }
    return false;
  }

  /* Tire une grille jusqu'à en obtenir une dont la solution est unique. */
  function generate(n) {
    for (var attempt = 0; attempt < 40; attempt++) {
      var cols = randomSolution(n);
      if (!cols) { continue; }
      var cats = cols.map(function (c, row) { return row * n + c; });
      var region = growRegions(n, cats);
      if (!region) { continue; }
      if (countSolutions(n, region, 2) === 1 || repair(n, region, cats)) {
        return { regions: region, solution: cats, attempts: attempt + 1 };
      }
    }
    return null;
  }

  function newGrid() {
    N = conf().size;
    var grid = generate(N);
    if (!grid) {                       // filet de sécurité : ne devrait pas servir
      N = 5;
      grid = generate(5);
    }
    regions = grid.regions;
    solution = grid.solution;
    cells = new Array(N * N).fill(EMPTY);
    cursor = { x: 0, y: 0 };
    hintsUsed = 0;
    gridStartedAt = performance.now();
    solvedAt = 0;
    if (run) { run.maxSize = Math.max(run.maxSize, N); }
    renderHud();
  }

  function resetRun() {
    score = 0;
    grids = 0;
    elapsedMs = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.cleanGrid = false;
    run.fastest = 0;
    runStartedAt = performance.now();
    runCommitted = false;
    newGrid();
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function catCells() {
    var list = [];
    for (var i = 0; i < cells.length; i++) { if (cells[i] === CAT) { list.push(i); } }
    return list;
  }

  /* Deux chats se disputent s'ils partagent une ligne, une colonne, un
     territoire, ou s'ils se touchent — diagonales comprises. */
  function clashes() {
    var list = catCells();
    var bad = {};
    for (var a = 0; a < list.length; a++) {
      for (var b = a + 1; b < list.length; b++) {
        var ax = list[a] % N, ay = Math.floor(list[a] / N);
        var bx = list[b] % N, by = Math.floor(list[b] / N);
        if (ax === bx || ay === by || regions[list[a]] === regions[list[b]] ||
            (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1)) {
          bad[list[a]] = true;
          bad[list[b]] = true;
        }
      }
    }
    return bad;
  }

  function forbidden(x, y) {
    // Cases qu'un chat déjà posé interdit : sa ligne, sa colonne, son
    // territoire et son voisinage immédiat.
    var list = catCells();
    for (var i = 0; i < list.length; i++) {
      var cx = list[i] % N, cy = Math.floor(list[i] / N);
      if (cx === x && cy === y) { return false; }
      if (cx === x || cy === y) { return true; }
      if (regions[list[i]] === regions[idx(x, y)]) { return true; }
      if (Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1) { return true; }
    }
    return false;
  }

  function autoCross() {
    if (!progress.getSetting('autocross')) { return; }
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = idx(x, y);
        if (cells[i] === EMPTY && forbidden(x, y)) { cells[i] = CROSS; }
      }
    }
  }

  function checkSolved() {
    var list = catCells();
    if (list.length !== N) { return false; }
    return Object.keys(clashes()).length === 0;
  }

  function place(x, y, value) {
    if (state !== 'playing' || solvedAt || !inside(x, y)) { return; }
    var i = idx(x, y);
    if (cells[i] === value) { cells[i] = EMPTY; }
    else { cells[i] = value; }

    if (cells[i] === CAT) {
      run.cats++;
      audio.pickup();
      autoCross();
    } else {
      audio.blip(200, 0.03, 'square', 0.03);
    }
    if (checkSolved()) { solveGrid(); }
    renderHud();
  }

  function cycle(x, y) {
    if (state !== 'playing' || solvedAt || !inside(x, y)) { return; }
    var i = idx(x, y);
    place(x, y, cells[i] === EMPTY ? CAT : (cells[i] === CAT ? CROSS : EMPTY));
  }

  /* Un coup de patte pose un chat juste, au prix de quelques points. */
  function hint() {
    if (state !== 'playing' || solvedAt) { return; }
    for (var k = 0; k < solution.length; k++) {
      if (cells[solution[k]] !== CAT) {
        cells[solution[k]] = CAT;
        hintsUsed++;
        run.hints++;
        run.cats++;
        if (!forgiving()) { score = Math.max(0, score - HINT_COST); }
        var x = solution[k] % N, y = Math.floor(solution[k] / N);
        burst(x, y, catSkin().fur, 12);
        floatText('Coup de patte', catSkin().cross);
        audio.bonus();
        autoCross();
        if (checkSolved()) { solveGrid(); }
        renderHud();
        return;
      }
    }
  }

  function solveGrid() {
    solvedAt = performance.now();
    var took = Math.round((solvedAt - gridStartedAt) / 1000);
    var gained = conf().base + Math.max(0, TIME_BONUS - took);
    score += gained;
    grids++;
    run.grids++;
    run.score = score;
    if (hintsUsed === 0) { run.cleanGrid = true; }
    if (!run.fastest || took < run.fastest) { run.fastest = took; }

    solution.forEach(function (cell) { burst(cell % N, Math.floor(cell / N), catSkin().fur, 14); });
    floatText('+' + gained + ' — ronron', catSkin().fur);
    audio.unlocked();
    checkUnlocks();
    renderHud();

    setTimeout(function () {
      if (state !== 'playing') { return; }
      newGrid();
    }, 1100);
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
    if (!run || runCommitted || (run.cats === 0 && run.grids === 0)) {
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

  function skin() { return progress.currentSkin(); }
  function catSkin() { return skin().cat || manifest.cats.neon; }

  function regionColor(r) {
    if (skin().rainbow) { return 'hsl(' + ((r * 47) % 360) + ', 45%, 26%)'; }
    var palette = skin().regions || manifest.regions.neon;
    return palette[r % palette.length];
  }

  function geometry() {
    var size = loop.size();
    var cell = Math.min(size * 0.88 / N, size * 0.82 / N);
    return { cell: cell, x: (size - cell * N) / 2, y: (size - cell * N) / 2 - size * 0.02, size: size };
  }

  function cellAt(pos) {
    var g = geometry();
    var x = Math.floor((pos.x * g.size - g.x) / g.cell);
    var y = Math.floor((pos.y * g.size - g.y) / g.cell);
    return inside(x, y) ? { x: x, y: y } : null;
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

  /* Un chat : deux oreilles, deux yeux, des moustaches. */
  function drawCat(cx, cy, size, fur, ink) {
    ctx.save();
    ctx.shadowColor = fur;
    ctx.shadowBlur = 14;
    ctx.fillStyle = fur;

    ctx.beginPath();
    ctx.moveTo(cx - size * 0.34, cy - size * 0.18);
    ctx.lineTo(cx - size * 0.30, cy - size * 0.52);
    ctx.lineTo(cx - size * 0.02, cy - size * 0.30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + size * 0.34, cy - size * 0.18);
    ctx.lineTo(cx + size * 0.30, cy - size * 0.52);
    ctx.lineTo(cx + size * 0.02, cy - size * 0.30);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.13, cy - size * 0.03, size * 0.045, size * 0.075, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + size * 0.13, cy - size * 0.03, size * 0.045, size * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.08);
    ctx.lineTo(cx - size * 0.05, cy + size * 0.14);
    ctx.lineTo(cx + size * 0.05, cy + size * 0.14);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, size * 0.022);
    [-1, 1].forEach(function (side) {
      [-0.05, 0.05].forEach(function (dy) {
        ctx.beginPath();
        ctx.moveTo(cx + side * size * 0.16, cy + size * 0.12 + size * dy);
        ctx.lineTo(cx + side * size * 0.42, cy + size * 0.08 + size * dy * 2);
        ctx.stroke();
      });
    });
    ctx.restore();
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    if (state === 'playing' && !solvedAt && !forgiving()) { elapsedMs += dt; }
    else if (state === 'playing' && forgiving()) { elapsedMs += dt; }
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);

    var bad = progress.getSetting('clash') ? clashes() : {};

    // Territoires.
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = idx(x, y);
        ctx.fillStyle = regionColor(regions[i]);
        ctx.fillRect(g.x + x * g.cell, g.y + y * g.cell, g.cell, g.cell);
      }
    }

    // Frontières : trait fin entre cases, trait épais entre territoires.
    ctx.strokeStyle = 'rgba(10, 16, 24, 0.35)';
    ctx.lineWidth = 1;
    for (var k = 1; k < N; k++) {
      ctx.beginPath();
      ctx.moveTo(g.x + k * g.cell, g.y);
      ctx.lineTo(g.x + k * g.cell, g.y + g.cell * N);
      ctx.moveTo(g.x, g.y + k * g.cell);
      ctx.lineTo(g.x + g.cell * N, g.y + k * g.cell);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(232, 238, 252, 0.75)';
    ctx.lineWidth = Math.max(2, g.cell * 0.06);
    for (var yy = 0; yy < N; yy++) {
      for (var xx = 0; xx < N; xx++) {
        var here = regions[idx(xx, yy)];
        if (xx + 1 < N && regions[idx(xx + 1, yy)] !== here) {
          ctx.beginPath();
          ctx.moveTo(g.x + (xx + 1) * g.cell, g.y + yy * g.cell);
          ctx.lineTo(g.x + (xx + 1) * g.cell, g.y + (yy + 1) * g.cell);
          ctx.stroke();
        }
        if (yy + 1 < N && regions[idx(xx, yy + 1)] !== here) {
          ctx.beginPath();
          ctx.moveTo(g.x + xx * g.cell, g.y + (yy + 1) * g.cell);
          ctx.lineTo(g.x + (xx + 1) * g.cell, g.y + (yy + 1) * g.cell);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = 'rgba(232, 238, 252, 0.75)';
    ctx.lineWidth = Math.max(2, g.cell * 0.06);
    ctx.strokeRect(g.x, g.y, g.cell * N, g.cell * N);

    // Chats et croix.
    for (var y2 = 0; y2 < N; y2++) {
      for (var x2 = 0; x2 < N; x2++) {
        var i2 = idx(x2, y2);
        var cx = g.x + (x2 + 0.5) * g.cell;
        var cy = g.y + (y2 + 0.5) * g.cell;
        if (cells[i2] === CAT) {
          drawCat(cx, cy, g.cell, bad[i2] ? catSkin().clash : catSkin().fur, catSkin().ink);
        } else if (cells[i2] === CROSS) {
          ctx.strokeStyle = catSkin().cross;
          ctx.lineWidth = Math.max(1.5, g.cell * 0.06);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - g.cell * 0.16, cy - g.cell * 0.16);
          ctx.lineTo(cx + g.cell * 0.16, cy + g.cell * 0.16);
          ctx.moveTo(cx + g.cell * 0.16, cy - g.cell * 0.16);
          ctx.lineTo(cx - g.cell * 0.16, cy + g.cell * 0.16);
          ctx.stroke();
        }
      }
    }

    // Curseur.
    if (state === 'playing') {
      ctx.strokeStyle = 'rgba(232, 238, 252, 0.6)';
      ctx.lineWidth = Math.max(1.5, g.cell * 0.05);
      roundRect(g.x + cursor.x * g.cell + 2, g.y + cursor.y * g.cell + 2,
                g.cell - 4, g.cell - 4, g.cell * 0.14);
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

    // Bandeau.
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(g.size * 0.03) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(forgiving() ? 'grille ' + (grids + 1) : '⏱ ' + Math.round((performance.now() - gridStartedAt) / 1000) + ' s',
                 g.size * 0.03, g.size * 0.955);
    ctx.textAlign = 'right';
    ctx.fillText(N + ' × ' + N + ' — ' + catCells().length + ' / ' + N + ' chats',
                 g.size * 0.97, g.size * 0.955);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: catCells().length + ' / ' + N,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Grilles',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : grids
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
      panel.show({ title: 'Pause', subtitle: 'Les chats attendent.', cta: 'Reprendre',
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
    if (state !== 'playing') { return; }
    cursor.x = clamp(cursor.x + dx, 0, N - 1);
    cursor.y = clamp(cursor.y + dy, 0, N - 1);
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { cycle(cursor.x, cursor.y); }
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
    onSkinChange: function () { /* le rendu suivant lit déjà la nouvelle robe */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
      if (name === 'autocross') { autoCross(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // la grille ne change qu'au clic
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
      var cell = cellAt(pos);
      if (cell) { cursor = cell; }
    },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var cell = cellAt(pos);
      if (cell) { cursor = cell; place(cell.x, cell.y, CAT); }
    },
    onSecondary: function (pos) {
      var cell = cellAt(pos);
      if (cell) { cursor = cell; place(cell.x, cell.y, CROSS); }
    },
    keys: { h: hint }
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

  window.__neonMeow = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        size: N,
        regions: regions.slice(),
        cells: cells.slice(),
        solution: solution.slice(),
        cats: catCells().length,
        clashes: Object.keys(clashes()).length,
        solved: checkSolved(),
        score: score,
        grids: grids,
        hints: hintsUsed,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : générer et vérifier sans passer par l'écran.
    generate: function (n) { return generate(n); },
    countSolutions: function (n, region, limit) { return countSolutions(n, region, limit || 2); },
    place: function (x, y, value) { place(x, y, value === undefined ? CAT : value); },
    cycle: function (x, y) { cycle(x, y); },
    hint: hint,
    solveNow: function () {
      cells = new Array(N * N).fill(EMPTY);
      solution.forEach(function (cell) { cells[cell] = CAT; });
      if (checkSolved()) { solveGrid(); }
      renderHud();
    }
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
