/* Neon Gems — l'alignement en cascade.

   Trois pièces de logique, et c'est tout le jeu : trouver les alignements,
   faire tomber ce qui reste, recommencer tant que la chute réaligne quelque
   chose. La difficulté d'écriture n'est pas là où on l'attend — elle est dans
   les garanties : un plateau servi ne doit contenir aucun alignement tout fait,
   et doit toujours offrir au moins un échange possible, sans quoi le joueur se
   retrouve devant une grille morte. Les deux sont vérifiés à chaque
   distribution, et le plateau se remélange tant que ce n'est pas le cas. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.gems;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/gems/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Gems : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  /* ------------------------------------------------------------------ */
  /* Constantes                                                          */
  /* ------------------------------------------------------------------ */

  var N = 8, CELLS = 64;
  var GEM_POINTS = 10;
  var MAX_MULT = 5;
  var LEVEL_BONUS = 200;
  var SWAP_MS = 150;                    // glissement d'un échange
  var STEP_MS = 230;                    // temps d'un maillon de cascade
  var FLASH_MS = 260;
  var FALL_MS = 220;
  var IDLE_HINT_MS = 5000;
  var RESTART_GRACE = 700;
  var TAP_SLOP = 9;

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
  var grid, charged, fallFrom, fallAt, flash, rng, seed;
  var sel, cursor, held, swapping, busy, cascadeAt, chain, lastSwap;
  var level, need, levelScore, movesLeft, shuffles, idleSince;
  var score, moves, particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function colors() { return conf().colors || 6; }
  function quotaOf(n) { return conf().quota ? conf().quota + conf().pente * (n - 1) : 0; }
  function best() { return progress.bestFor(difficulty); }
  function ranked() { return progress.ranked(difficulty); }

  /* Générateur reproductible : une partie se rejoue à partir de son numéro. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pick() { return Math.floor(rng() * colors()); }

  /* ------------------------------------------------------------------ */
  /* Le plateau                                                          */
  /* ------------------------------------------------------------------ */

  function at(g, x, y) { return g[y * N + x]; }

  /* Les suites de trois gemmes identiques ou plus, en ligne et en colonne. */
  function findRuns(g) {
    var runs = [], x, y, start, i, run;
    for (y = 0; y < N; y++) {
      start = 0;
      for (x = 1; x <= N; x++) {
        if (x < N && at(g, x, y) === at(g, start, y) && at(g, x, y) >= 0) { continue; }
        if (x - start >= 3 && at(g, start, y) >= 0) {
          run = [];
          for (i = start; i < x; i++) { run.push(y * N + i); }
          runs.push(run);
        }
        start = x;
      }
    }
    for (x = 0; x < N; x++) {
      start = 0;
      for (y = 1; y <= N; y++) {
        if (y < N && at(g, x, y) === at(g, x, start) && at(g, x, y) >= 0) { continue; }
        if (y - start >= 3 && at(g, x, start) >= 0) {
          run = [];
          for (i = start; i < y; i++) { run.push(i * N + x); }
          runs.push(run);
        }
        start = y;
      }
    }
    return runs;
  }

  function hasRun(g) { return findRuns(g).length > 0; }

  function adjacent(a, b) {
    var ax = a % N, ay = Math.floor(a / N), bx = b % N, by = Math.floor(b / N);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  function swapCells(g, a, b) {
    var t = g[a]; g[a] = g[b]; g[b] = t;
    var c = charged[a]; charged[a] = charged[b]; charged[b] = c;
  }

  /* L'échange donnerait-il quelque chose ? On l'essaie, on regarde, on défait. */
  function swapWorks(a, b) {
    if (!adjacent(a, b)) { return false; }
    swapCells(grid, a, b);
    var ok = hasRun(grid);
    swapCells(grid, a, b);
    return ok;
  }

  /* Reste-t-il un seul échange possible ? Sinon le plateau est mort. */
  function anySwap(g) {
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = y * N + x;
        if (x < N - 1) {
          var r = i + 1;
          var t = g[i]; g[i] = g[r]; g[r] = t;
          var ok = hasRun(g);
          t = g[i]; g[i] = g[r]; g[r] = t;
          if (ok) { return [i, r]; }
        }
        if (y < N - 1) {
          var d = i + N;
          var t2 = g[i]; g[i] = g[d]; g[d] = t2;
          var ok2 = hasRun(g);
          t2 = g[i]; g[i] = g[d]; g[d] = t2;
          if (ok2) { return [i, d]; }
        }
      }
    }
    return null;
  }

  /* Un plateau neuf : aucune couleur ne complète un alignement en se posant,
     et on recommence tant qu'aucun échange n'est possible. */
  function fillBoard() {
    var essais = 0;
    do {
      for (var i = 0; i < CELLS; i++) {
        var x = i % N, y = Math.floor(i / N);
        var interdits = {};
        if (x >= 2 && grid[i - 1] === grid[i - 2]) { interdits[grid[i - 1]] = true; }
        if (y >= 2 && grid[i - N] === grid[i - 2 * N]) { interdits[grid[i - N]] = true; }
        var c;
        do { c = pick(); } while (interdits[c]);
        grid[i] = c;
        charged[i] = false;
      }
      essais++;
    } while (!anySwap(grid) && essais < 40);
  }

  /* Plus aucun échange : on remélange les mêmes gemmes, sans coûter un coup. */
  function reshuffle() {
    var sac = grid.slice();
    var essais = 0;
    do {
      for (var i = sac.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = sac[i]; sac[i] = sac[j]; sac[j] = t;
      }
      for (var k = 0; k < CELLS; k++) { grid[k] = sac[k]; charged[k] = false; }
      essais++;
    } while ((hasRun(grid) || !anySwap(grid)) && essais < 60);
    if (hasRun(grid) || !anySwap(grid)) { fillBoard(); }
    shuffles++;
    floatText('Plateau remélangé', '#8b9ac0');
    audio.blip(220, 0.10, 'triangle', 0.04);
  }

  /* ------------------------------------------------------------------ */
  /* La cascade                                                          */
  /* ------------------------------------------------------------------ */

  /* Un maillon : retirer les alignements, poser les gemmes chargées, faire
     tomber, remplir. Renvoie le nombre de gemmes retirées, ou 0 si rien. */
  function stepCascade() {
    var runs = findRuns(grid);
    if (!runs.length) { return 0; }

    chain++;
    var mask = new Array(CELLS).fill(false);
    var i, k;
    var plusLong = 0;

    // Les gemmes chargées à créer, avant toute explosion : un alignement de
    // quatre en laisse une, à l'endroit de l'échange s'il en fait partie.
    var garder = [];
    runs.forEach(function (r) {
      r.forEach(function (c) { mask[c] = true; });
      plusLong = Math.max(plusLong, r.length);
      if (r.length >= 4) {
        var choix = (lastSwap !== null && r.indexOf(lastSwap) >= 0)
          ? lastSwap : r[Math.floor(r.length / 2)];
        garder.push({ cell: choix, color: grid[choix] });
      }
    });

    // Une gemme chargée prise dans un alignement emporte sa ligne et sa
    // colonne — et ce qu'elle emporte peut être chargé à son tour.
    var blasts = 0;
    var encore = true;
    while (encore) {
      encore = false;
      for (i = 0; i < CELLS; i++) {
        if (!mask[i] || !charged[i]) { continue; }
        charged[i] = false;              // consommée : on ne la repropage pas
        blasts++;
        var x = i % N, y = Math.floor(i / N);
        for (k = 0; k < N; k++) {
          if (!mask[y * N + k]) { mask[y * N + k] = true; encore = true; }
          if (!mask[k * N + x]) { mask[k * N + x] = true; encore = true; }
        }
      }
    }

    // La gemme chargée qu'on vient de créer survit à son propre alignement.
    garder.forEach(function (g) { mask[g.cell] = false; });

    var retirees = 0;
    for (i = 0; i < CELLS; i++) { if (mask[i]) { retirees++; } }
    if (!retirees && !garder.length) { return 0; }

    var mult = Math.min(MAX_MULT, chain);
    var gagnes = retirees * GEM_POINTS * mult;
    score += gagnes;
    levelScore += gagnes;
    run.gems += retirees;
    run.chains++;
    run.bestChain = Math.max(run.bestChain, chain);
    run.bestRun = Math.max(run.bestRun, plusLong);
    run.blasts += blasts;
    run.charged += garder.length;

    // L'effet visuel : chaque gemme retirée laisse une trace.
    var maintenant = performance.now();
    for (i = 0; i < CELLS; i++) {
      if (!mask[i]) { continue; }
      flash.push({ i: i, color: grid[i], t0: maintenant });
      grid[i] = -1;
      charged[i] = false;
    }
    garder.forEach(function (g) { charged[g.cell] = true; });
    if (garder.length) { audio.bonus(); }
    if (blasts) { burst(garder.length ? 18 : 14); }

    // La chute, colonne par colonne.
    fallFrom = new Array(CELLS).fill(0);
    for (var x2 = 0; x2 < N; x2++) {
      var write = N - 1;
      for (var y2 = N - 1; y2 >= 0; y2--) {
        var from = y2 * N + x2;
        if (grid[from] < 0) { continue; }
        var to = write * N + x2;
        if (to !== from) {
          grid[to] = grid[from];
          charged[to] = charged[from];
          grid[from] = -1;
          charged[from] = false;
          fallFrom[to] = write - y2;
        }
        write--;
      }
      for (var y3 = write; y3 >= 0; y3--) {
        grid[y3 * N + x2] = pick();
        charged[y3 * N + x2] = false;
        fallFrom[y3 * N + x2] = write + 1;
      }
    }
    fallAt = maintenant;
    audio.blip(300 + chain * 60, 0.05, 'triangle', 0.04);
    if (chain >= 2) { floatText('Cascade ×' + mult + '  +' + gagnes, '#ffd166'); }
    return retirees;
  }

  /* Le coup est soldé : plateau remélangé s'il est mort, palier franchi si le
     quota est atteint, partie finie si les coups sont épuisés. Le rendu et les
     tests passent tous les deux par ici — c'est la même règle. */
  function settleMove() {
    if (!anySwap(grid)) { reshuffle(); }
    if (state !== 'playing') { return; }

    if (need > 0 && levelScore >= need) {
      var prime = Math.round(LEVEL_BONUS * level * (conf().bonus || 1));
      score += prime;
      run.levels++;
      level++;
      run.best = Math.max(run.best, level);
      need = quotaOf(level);
      levelScore = 0;
      movesLeft = conf().budget;
      floatText('Palier ' + level + ' ! +' + prime, '#38f9c3');
      burst(26);
      audio.unlocked();
      checkUnlocks();
    } else if (conf().budget > 0 && movesLeft <= 0) {
      finish();
      return;
    }
    checkUnlocks();
    renderHud();
  }

  function afterCascade() {
    busy = false;
    lastSwap = null;
    settleMove();
  }

  /* ------------------------------------------------------------------ */
  /* Coups                                                               */
  /* ------------------------------------------------------------------ */

  function trySwap(a, b) {
    if (state !== 'playing' || busy) { return false; }
    if (!adjacent(a, b)) { return false; }
    idleSince = performance.now();
    var ok = swapWorks(a, b);
    swapping = { a: a, b: b, t0: performance.now(), ok: ok };
    busy = true;
    sel = -1;
    if (!ok) { audio.blip(120, 0.07, 'square', 0.03); }
    return ok;
  }

  /* Appelée par le rendu quand le glissement est fini. */
  function landSwap() {
    var s = swapping;
    swapping = null;
    if (!s.ok) { busy = false; return; }
    swapCells(grid, s.a, s.b);
    lastSwap = s.b;
    moves++;
    run.moves++;
    if (conf().budget > 0) { movesLeft--; }
    chain = 0;
    audio.pickup();
    cascadeAt = 0;                       // le premier maillon part tout de suite
    renderHud();
  }

  /* Le clic : on choisit, puis on échange avec une voisine. */
  function tapCell(i) {
    if (state !== 'playing' || busy) { return false; }
    idleSince = performance.now();
    if (sel < 0) { sel = i; audio.blip(520, 0.04, 'triangle', 0.03); return false; }
    if (sel === i) { sel = -1; return false; }
    if (adjacent(sel, i)) { return trySwap(sel, i); }
    sel = i;
    audio.blip(520, 0.04, 'triangle', 0.03);
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Issue                                                               */
  /* ------------------------------------------------------------------ */

  function finish() {
    state = 'over';
    overSince = performance.now();
    busy = false;
    swapping = null;
    run.best = Math.max(run.best, level);
    run.score = score;
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
      title: beaten ? 'Nouveau record !' : 'Coups épuisés',
      subtitle: need > 0
        ? 'Palier ' + level + ' : ' + levelScore + ' points sur les ' + need + ' demandés.'
        : 'Soixante coups joués, ' + run.gems + ' gemmes retirées.',
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: need > 0 ? 'Palier atteint' : 'Gemmes retirées',
        extra: need > 0 ? level : run.gems,
        best: Math.max(best(), score)
      }
    });
  }

  function checkUnlocks() {
    run.durationMs = performance.now() - runStartedAt;
    run.score = score;
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

  function resetRun() {
    seed = Math.floor(Math.random() * 999999) + 1;
    rng = mulberry32(seed);
    grid = new Array(CELLS).fill(-1);
    charged = new Array(CELLS).fill(false);
    fallFrom = new Array(CELLS).fill(0);
    fallAt = 0;
    flash = [];
    particles = [];
    sel = -1;
    cursor = 27;
    held = null;
    swapping = null;
    busy = false;
    cascadeAt = -1;
    chain = 0;
    lastSwap = null;
    level = 1;
    need = quotaOf(1);
    levelScore = 0;
    movesLeft = conf().budget;
    shuffles = 0;
    idleSince = performance.now();
    score = 0;
    moves = 0;
    run = progress.newRun(difficulty);
    run.bestChain = 0;
    run.bestRun = 0;
    run.blasts = 0;
    runStartedAt = performance.now();
    runCommitted = false;
    fillBoard();
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burst(n) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    for (var i = 0; i < n; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.05 + Math.random() * 0.16;
      particles.push({
        x: g.x + g.cell * N / 2, y: g.y + g.cell * N / 2,
        vx: Math.cos(angle) * speed * g.cell, vy: Math.sin(angle) * speed * g.cell,
        life: 1, decay: 0.002 + Math.random() * 0.002,
        size: 1.5 + Math.random() * 2.5,
        color: palette()[Math.floor(Math.random() * colors())]
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
    el.style.top = '42%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function palette() {
    var skin = progress.currentSkin();
    if (skin.rainbow) {
      var out = [];
      for (var i = 0; i < 7; i++) { out.push('hsl(' + Math.round(i * 360 / 7) + ', 82%, 64%)'); }
      return out;
    }
    return skin.palette || manifest.palettes.neon;
  }

  function geometry() {
    var size = loop.size();
    var pad = size * 0.025;
    var bar = size * 0.085;
    var cell = Math.min((size - pad * 2) / N, (size - pad * 2 - bar) / N);
    return { size: size, pad: pad, bar: bar, cell: cell,
             x: (size - cell * N) / 2, y: pad + bar };
  }

  function cellAt(pos) {
    var g = geometry();
    var x = Math.floor((pos.x * g.size - g.x) / g.cell);
    var y = Math.floor((pos.y * g.size - g.y) / g.cell);
    if (x < 0 || y < 0 || x >= N || y >= N) { return null; }
    return y * N + x;
  }

  /* Une forme par couleur : le plateau reste lisible même quand deux teintes
     se ressemblent, ou qu'on les distingue mal. */
  function gemPath(cx, cy, r, shape) {
    var i, a;
    ctx.beginPath();
    if (shape === 0) {                          // rond
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (shape === 1) {                   // carré
      ctx.rect(cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72);
    } else if (shape === 2) {                   // losange
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
      ctx.closePath();
    } else if (shape === 3) {                   // triangle
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.92, cy + r * 0.72);
      ctx.lineTo(cx - r * 0.92, cy + r * 0.72);
      ctx.closePath();
    } else if (shape === 4) {                   // hexagone
      for (i = 0; i < 6; i++) {
        a = Math.PI / 6 + i * Math.PI / 3;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
    } else if (shape === 5) {                   // étoile
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5;
        var rr = i % 2 ? r * 0.46 : r;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {                                    // goutte
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r, cy - r * 0.1, cx, cy + r);
      ctx.quadraticCurveTo(cx - r, cy - r * 0.1, cx, cy - r);
      ctx.closePath();
    }
  }

  function drawGem(cx, cy, r, color, shape, glow, alpha) {
    if (!(r > 0.5)) { return; }          // un rayon nul ou négatif ne se dessine pas
    ctx.save();
    if (alpha !== undefined) { ctx.globalAlpha = alpha; }
    ctx.shadowColor = color;
    ctx.shadowBlur = glow || 10;
    ctx.fillStyle = color;
    gemPath(cx, cy, r, shape);
    ctx.fill();
    ctx.restore();
  }

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function draw(now, alpha, dt) {
    var g = geometry();
    var r = g.cell * 0.34;
    var pal = palette();
    var formes = progress.getSetting('shapes');
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!grid) { return; }

    // L'échange en cours, puis la cascade : les deux avancent au rendu.
    if (swapping && now - swapping.t0 >= SWAP_MS) { landSwap(); }
    if (busy && !swapping && cascadeAt >= 0 && now - cascadeAt >= (cascadeAt ? STEP_MS : 0)) {
      if (!stepCascade()) { cascadeAt = -1; afterCascade(); }
      else { cascadeAt = now; }
    }

    // Le bandeau : palier, quota, coups restants.
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(g.bar * 0.34) + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(need > 0 ? 'Palier ' + level : 'Détente', g.x, g.pad + g.bar * 0.3);
    ctx.textAlign = 'right';
    ctx.fillStyle = (conf().budget > 0 && movesLeft <= 3) ? '#ff5d8f' : 'rgba(139, 154, 192, 0.9)';
    ctx.fillText(conf().budget > 0 ? movesLeft + ' coups' : moves + ' coups',
                 g.x + g.cell * N, g.pad + g.bar * 0.3);

    var jaugeY = g.pad + g.bar * 0.58, jaugeH = g.bar * 0.22;
    ctx.fillStyle = 'rgba(120, 150, 200, 0.16)';
    ctx.fillRect(g.x, jaugeY, g.cell * N, jaugeH);
    if (need > 0) {
      ctx.fillStyle = '#38f9c3';
      ctx.fillRect(g.x, jaugeY, g.cell * N * clamp(levelScore / need, 0, 1), jaugeH);
      ctx.fillStyle = 'rgba(232, 238, 252, 0.85)';
      ctx.font = '600 ' + Math.round(g.bar * 0.28) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(levelScore + ' / ' + need, g.x + g.cell * N / 2, jaugeY + jaugeH * 2.1);
    }
    ctx.restore();

    // Le fond du plateau.
    ctx.fillStyle = 'rgba(120, 150, 200, 0.06)';
    ctx.fillRect(g.x, g.y, g.cell * N, g.cell * N);

    // Le coup soufflé, quand le joueur hésite.
    var souffle = null;
    if (progress.getSetting('guide') && state === 'playing' && !busy &&
        now - idleSince > IDLE_HINT_MS) {
      souffle = anySwap(grid);
    }

    // Les gemmes.
    var chuteT = fallAt ? clamp((now - fallAt) / FALL_MS, 0, 1) : 1;
    for (var i = 0; i < CELLS; i++) {
      var c = grid[i];
      if (c < 0) { continue; }
      var cx = g.x + (i % N + 0.5) * g.cell;
      var cy = g.y + (Math.floor(i / N) + 0.5) * g.cell;

      // Glissement de l'échange, aller — et retour s'il est refusé.
      if (swapping && (i === swapping.a || i === swapping.b)) {
        var p = clamp((now - swapping.t0) / SWAP_MS, 0, 1);
        var autre = i === swapping.a ? swapping.b : swapping.a;
        var part = swapping.ok ? p : Math.sin(p * Math.PI) * 0.45;
        cx += ((autre % N) - (i % N)) * g.cell * part;
        cy += (Math.floor(autre / N) - Math.floor(i / N)) * g.cell * part;
      } else if (chuteT < 1 && fallFrom[i]) {
        cy -= fallFrom[i] * g.cell * (1 - easeOut(chuteT));
      }

      var glow = 10;
      if (i === sel) { glow = 26; }
      else if (souffle && (i === souffle[0] || i === souffle[1])) { glow = 22; }
      drawGem(cx, cy, r, pal[c % pal.length], formes ? c % 7 : 0, glow);

      // Une gemme chargée porte un anneau.
      if (charged[i]) {
        ctx.save();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = Math.max(1.5, g.cell * 0.055);
        ctx.shadowColor = '#ffd166';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Les gemmes retirées : une trace qui s'ouvre et s'efface.
    for (var f = flash.length - 1; f >= 0; f--) {
      var fl = flash[f];
      /* `now` vient de requestAnimationFrame, `fl.t0` de performance.now() :
         après un long calcul bloquant, la première peut être en retard sur la
         seconde et donner un âge négatif. On borne. */
      var t = clamp((now - fl.t0) / FLASH_MS, 0, 1);
      if (now - fl.t0 >= FLASH_MS) { flash.splice(f, 1); continue; }
      drawGem(g.x + (fl.i % N + 0.5) * g.cell, g.y + (Math.floor(fl.i / N) + 0.5) * g.cell,
              r * (1 + t * 0.9), pal[fl.color % pal.length], formes ? fl.color % 7 : 0,
              18, 1 - t);
    }

    // La case visée.
    if (state === 'playing') {
      var vx = g.x + (cursor % N) * g.cell, vy = g.y + Math.floor(cursor / N) * g.cell;
      ctx.strokeStyle = sel === cursor ? '#ffd166' : 'rgba(232, 238, 252, 0.28)';
      ctx.lineWidth = Math.max(1.5, g.cell * 0.05);
      ctx.strokeRect(vx + 2, vy + 2, g.cell - 4, g.cell - 4);
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
  /* Saisie                                                              */
  /* ------------------------------------------------------------------ */

  function grab(pos) {
    if (state !== 'playing' || busy) { return false; }
    var i = cellAt(pos);
    if (i === null) { return false; }
    var g = geometry();
    held = { from: i, x: pos.x * g.size, y: pos.y * g.size,
             startX: pos.x * g.size, startY: pos.y * g.size, moved: false };
    audio.unlock();
    return true;
  }

  function dragTo(pos) {
    if (!held) { return; }
    var g = geometry();
    held.x = pos.x * g.size;
    held.y = pos.y * g.size;
    if (Math.abs(held.x - held.startX) > TAP_SLOP || Math.abs(held.y - held.startY) > TAP_SLOP) {
      held.moved = true;
    }
  }

  function drop() {
    if (!held) { return; }
    var current = held;
    held = null;
    if (!current.moved) { tapCell(current.from); return; }
    // Le geste désigne une voisine : celle du côté où le doigt est parti.
    var dx = current.x - current.startX, dy = current.y - current.startY;
    var x = current.from % N, y = Math.floor(current.from / N);
    if (Math.abs(dx) > Math.abs(dy)) { x += dx > 0 ? 1 : -1; }
    else { y += dy > 0 ? 1 : -1; }
    if (x < 0 || y < 0 || x >= N || y >= N) { sel = -1; return; }
    trySwap(current.from, y * N + x);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: need > 0 ? String(level) : '—',
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: ranked() ? 'Record' : 'Gemmes',
      best: ranked() ? Math.max(best(), score) : (run ? run.gems : 0)
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
      held = null;
      panel.show({ title: 'Pause', subtitle: 'Le plateau t\'attend.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      loop.resetClock();
      idleSince = performance.now();
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
    if (state !== 'playing' || busy) { return; }
    idleSince = performance.now();
    var x = clamp(cursor % N + dx, 0, N - 1);
    var y = clamp(Math.floor(cursor / N) + dy, 0, N - 1);
    var cible = y * N + x;
    // Une gemme choisie : la flèche l'échange avec la voisine visée.
    if (sel >= 0 && adjacent(sel, cible) && cible !== cursor) {
      cursor = cible;
      trySwap(sel, cible);
      return;
    }
    cursor = cible;
  }

  function action() {
    if (guardedStart()) { return; }
    if (state === 'paused') { togglePause(); return; }
    if (state === 'playing') { tapCell(cursor); }
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
    running: function () { return false; },  // rien n'avance seul : tout est animé au rendu
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
    onDragStart: grab,
    onDragMove: dragTo,
    onDragEnd: drop
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

  window.__neonGems = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        colors: colors(),
        seed: seed,
        grid: grid.slice(),
        charged: charged.slice(),
        sel: sel,
        cursor: cursor,
        busy: busy,
        chain: chain,
        level: level,
        need: need,
        levelScore: levelScore,
        movesLeft: movesLeft,
        shuffles: shuffles,
        score: score,
        moves: moves,
        gems: run ? run.gems : 0,
        bestChain: run ? run.bestChain : 0,
        bestRun: run ? run.bestRun : 0,
        blasts: run ? run.blasts : 0,
        chargedMade: run ? run.charged : 0,
        runs: findRuns(grid).map(function (r) { return r.slice(); }),
        move: anySwap(grid),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Points d'entrée des tests : poser un plateau, jouer sans attendre l'animation.
    setBoard: function (cells, marks) {
      grid = cells.slice();
      charged = marks ? marks.slice() : new Array(CELLS).fill(false);
      fallFrom = new Array(CELLS).fill(0);
      flash = [];
      sel = -1;
      swapping = null;
      busy = false;
      cascadeAt = -1;
      chain = 0;
      lastSwap = null;
      renderHud();
    },
    setLevel: function (n, quota, budget) {
      level = n;
      need = quota === undefined ? quotaOf(n) : quota;
      levelScore = 0;
      if (budget !== undefined) { movesLeft = budget; }
      renderHud();
    },
    findRuns: function () { return findRuns(grid).map(function (r) { return r.slice(); }); },
    anySwap: function () { return anySwap(grid); },
    swapWorks: function (a, b) { return swapWorks(a, b); },
    adjacent: adjacent,
    /* Échanger et dérouler toute la cascade d'un coup, sans animation : c'est
       ce qui permet aux tests de jouer des parties entières. */
    swapNow: function (a, b) {
      if (!adjacent(a, b) || !swapWorks(a, b)) { return 0; }
      swapCells(grid, a, b);
      lastSwap = b;
      moves++;
      run.moves++;
      if (conf().budget > 0) { movesLeft--; }
      chain = 0;
      var total = 0, tour = 0;
      while (stepCascade() && tour++ < 40) { total++; }
      busy = false;
      lastSwap = null;
      settleMove();
      return total;
    },
    stepCascade: function () { return stepCascade(); },
    reshuffle: function () { reshuffle(); },
    tap: function (i) { return tapCell(i); },
    trySwap: function (a, b) { return trySwap(a, b); },
    finish: function () { finish(); },
    geometry: geometry,
    cellRatio: function (i) {
      var g = geometry();
      return { x: (g.x + (i % N + 0.5) * g.cell) / g.size,
               y: (g.y + (Math.floor(i / N) + 0.5) * g.cell) / g.size };
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
