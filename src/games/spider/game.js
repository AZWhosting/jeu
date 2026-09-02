/* Neon Spider — l'araignée. Deux paquets, dix colonnes, huit suites à tisser.

   Sa singularité tient en une phrase : on empile en descendant sans se soucier
   de l'enseigne, mais on ne déplace d'un bloc qu'une suite d'une seule
   enseigne. Tout l'écart entre le mode facile et le mode difficile est là. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.spider;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/cards.js': window.Core && Core.Cards,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/spider/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Spider : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var Cards = Core.Cards;
  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var SUITE_POINTS = 150;
  var FLIP_POINTS = 3;
  var WIN_BONUS = 400;
  var SPEED_MAX = 300;
  var RESTART_GRACE = 700;
  var TAP_SLOP = 9;
  var COLS = 10;
  var SUITES = 8;               // huit suites complètes dans deux paquets

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var cols, stock, done, seed, history;
  var score, moves, undos, deals, startedAt, wonAt;
  var particles, held;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function suitCount() { return conf().suits || 1; }
  function best() { return progress.bestFor(difficulty); }

  function dealFrom(n) {
    var rnd = Cards.mulberry32(n);
    var deck = Cards.shuffle(Cards.deck(2, suitCount()), rnd);
    cols = [];
    for (var i = 0; i < COLS; i++) {
      // Les quatre premières colonnes reçoivent six cartes, les six autres cinq.
      var count = i < 4 ? 6 : 5;
      var col = [];
      for (var k = 0; k < count; k++) { col.push({ c: deck.pop(), up: k === count - 1 }); }
      cols.push(col);
    }
    stock = deck;               // les cinquante restantes : cinq distributions
    done = [];
  }

  function setDeal(n) {
    seed = n >>> 0;
    dealFrom(seed);
    history = [];
    held = null;
    wonAt = 0;
    startedAt = performance.now();
    renderHud();
  }

  function resetRun() {
    score = 0;
    moves = 0;
    undos = 0;
    deals = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.cleanSuite = false;
    run.earlySuite = false;
    run.emptied = false;
    runStartedAt = performance.now();
    runCommitted = false;
    setDeal(Math.floor(Math.random() * 999999) + 1);
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  /* La suite retournée qui commence à cette position — et rien de plus. */
  function runAt(col, from) {
    var out = [];
    for (var i = from; i < col.length; i++) {
      if (!col[i].up) { return null; }
      out.push(col[i].c);
    }
    return out;
  }

  /* Déplaçable d'un bloc : descendante ET d'une seule enseigne. C'est toute la
     règle de l'araignée, et toute sa difficulté. */
  function movable(cards) {
    return cards.length === 1 || Cards.sameSuitRun(cards);
  }

  /* Mais on empile sans se soucier de l'enseigne : seul le rang compte. */
  function accepts(col, card) {
    if (!col.length) { return true; }
    var top = col[col.length - 1];
    if (!top.up) { return false; }
    return Cards.rank(top.c) === Cards.rank(card) + 1;
  }

  function cardsOf(src) {
    var col = cols[src.i];
    var n = src.n || 1;
    if (n > col.length) { return []; }
    return (runAt(col, col.length - n) || []);
  }

  function legal(src, dst) {
    if (src.i === dst.i) { return false; }
    var cards = cardsOf(src);
    if (!cards.length || !movable(cards)) { return false; }
    return accepts(cols[dst.i], cards[0]);
  }

  function flipExposed() {
    var flipped = 0;
    cols.forEach(function (col) {
      if (col.length && !col[col.length - 1].up) {
        col[col.length - 1].up = true;
        flipped++;
        score += FLIP_POINTS;
        run.flips++;
      }
    });
    if (flipped) { audio.blip(420, 0.05, 'triangle', 0.04); }
    return flipped;
  }

  /* Une suite complète du roi à l'as, d'une seule enseigne, s'envole. */
  function harvest() {
    var taken = 0;
    for (var i = 0; i < COLS; i++) {
      var col = cols[i];
      if (col.length < 13) { continue; }
      var tail = runAt(col, col.length - 13);
      if (!tail || tail.length !== 13) { continue; }
      if (Cards.rank(tail[0]) !== 12 || !Cards.sameSuitRun(tail)) { continue; }
      col.length -= 13;
      done.push(Cards.suit(tail[0]));
      taken++;
      score += Math.round(SUITE_POINTS * (conf().bonus || 1));
      run.suites++;
      run.best = Math.max(run.best, done.length);
      if (undos === 0) { run.cleanSuite = true; }
      if (deals === 0) { run.earlySuite = true; }
      burst(ramp().home, 20);
      floatText('Suite ! ' + done.length + ' / ' + SUITES, ramp().home);
      audio.unlocked();
    }
    if (taken) { flipExposed(); }
    return taken;
  }

  function snapshot() {
    return {
      cols: cols.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); }),
      stock: stock.slice(),
      done: done.slice(),
      score: score
    };
  }

  function restore(snap) {
    cols = snap.cols.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); });
    stock = snap.stock.slice();
    // Une suite ramenée sur la table n'est plus envolée.
    if (run) { run.suites -= done.length - snap.done.length; }
    done = snap.done.slice();
    score = snap.score;
  }

  function complete() { return done.length >= SUITES; }

  function hidden() {
    return cols.reduce(function (n, p) {
      return n + p.filter(function (e) { return !e.up; }).length;
    }, 0);
  }

  function play(src, dst) {
    if (state !== 'playing' || wonAt) { return false; }
    if (!legal(src, dst)) { return false; }
    history.push(snapshot());
    var cards = cardsOf(src);
    cols[src.i].length -= cards.length;
    cards.forEach(function (c) { cols[dst.i].push({ c: c, up: true }); });

    moves++;
    run.moves++;
    audio.pickup();
    flipExposed();
    harvest();
    if (cols.some(function (p) { return !p.length; })) { run.emptied = true; }
    if (complete()) { win(); }
    renderHud();
    return true;
  }

  /* La pioche distribue une carte à chaque colonne — et refuse tant qu'une
     colonne est vide, sinon elle la condamnerait. */
  function dealRow() {
    if (state !== 'playing' || wonAt) { return false; }
    if (!stock.length) {
      floatText('La pioche est vide', '#ff5d8f');
      audio.blip(120, 0.08, 'square', 0.04);
      return false;
    }
    if (cols.some(function (p) { return !p.length; })) {
      floatText('Remplis d\'abord les colonnes vides', '#ffd166');
      audio.blip(140, 0.08, 'square', 0.04);
      return false;
    }
    history.push(snapshot());
    for (var i = 0; i < COLS && stock.length; i++) {
      cols[i].push({ c: stock.pop(), up: true });
    }
    deals++;
    moves++;
    run.moves++;
    run.deals++;
    audio.blip(300, 0.07, 'triangle', 0.04);
    harvest();
    if (complete()) { win(); }
    renderHud();
    return true;
  }

  /* La tape : la suite part vers la colonne qui a le plus de sens — celle qui
     la prolonge, avant une colonne vide. */
  function autoPlace(src) {
    var cards = cardsOf(src);
    if (!cards.length || !movable(cards)) { audio.blip(120, 0.07, 'square', 0.03); return false; }
    var i;
    // D'abord une colonne de la même enseigne : elle rapproche d'une suite.
    for (i = 0; i < COLS; i++) {
      if (i === src.i || !cols[i].length) { continue; }
      var top = cols[i][cols[i].length - 1];
      if (top.up && Cards.suit(top.c) === Cards.suit(cards[0]) && legal(src, { t: 'col', i: i })) {
        return play(src, { t: 'col', i: i });
      }
    }
    for (i = 0; i < COLS; i++) {
      if (cols[i].length && legal(src, { t: 'col', i: i })) { return play(src, { t: 'col', i: i }); }
    }
    for (i = 0; i < COLS; i++) {
      if (!cols[i].length && legal(src, { t: 'col', i: i })) { return play(src, { t: 'col', i: i }); }
    }
    audio.blip(120, 0.07, 'square', 0.03);
    return false;
  }

  function undo() {
    if (state !== 'playing' || !history.length || wonAt) { return false; }
    restore(history.pop());
    undos++;
    held = null;
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
    return true;
  }

  function win() {
    wonAt = performance.now();
    var seconds = (wonAt - startedAt) / 1000;
    var speed = Math.max(0, Math.round(SPEED_MAX - seconds));
    var gained = Math.round((WIN_BONUS + speed) * (conf().bonus || 1));
    score += gained;
    run.score = score;
    burst(ramp().home, 34);
    floatText('Toile achevée ! +' + gained, ramp().home);
    audio.unlocked();
    checkUnlocks();
    renderHud();
    setTimeout(function () {
      if (state !== 'playing') { return; }
      finish(true);
    }, 1500);
  }

  function finish(won) {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : (won ? 'Toile achevée !' : 'Partie enregistrée'),
      subtitle: won ? 'Les huit suites sont tissées.'
                    : done.length + ' suite(s) envolée(s) sur ' + SUITES + '.',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Suites envolées',
        extra: run.suites,
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

  function burst(color, count) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.8 + Math.random() * 2.2;
      particles.push({
        x: g.size / 2, y: g.size * 0.42,
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
    setTimeout(function () { el.remove(); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  function geometry() {
    var size = loop.size();
    var pad = size * 0.008;
    var colW = (size - pad * 2) / COLS;
    var gap = colW * 0.10;
    var cardW = colW - gap;
    var cardH = cardW * 1.42;
    var topY = pad;
    var barH = cardH;
    var tableY = topY + barH + size * 0.022;
    var availH = size - tableY - pad;
    var longest = 1;
    for (var i = 0; i < cols.length; i++) { longest = Math.max(longest, cols[i].length); }
    var step = Math.min(cardH * 0.38, (availH - cardH) / Math.max(1, longest - 1));
    step = Math.max(step, Math.max(6, cardH * 0.11));
    return { size: size, pad: pad, colW: colW, gap: gap, cardW: cardW, cardH: cardH,
             topY: topY, barH: barH, tableY: tableY, step: step };
  }

  function slotX(g, index) { return g.pad + index * g.colW + g.gap / 2; }

  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;

    // La pioche occupe le coin haut droit du bandeau.
    if (py >= g.topY && py <= g.topY + g.barH) {
      if (px >= slotX(g, COLS - 1)) { return { t: 'stock' }; }
      return null;
    }

    if (py >= g.tableY - g.size * 0.01) {
      var c = clamp(Math.floor((px - g.pad) / g.colW), 0, COLS - 1);
      var col = cols[c];
      for (var k = col.length - 1; k >= 0; k--) {
        var top = g.tableY + k * g.step;
        var bottom = (k === col.length - 1) ? top + g.cardH : top + g.step;
        if (py >= top && py <= bottom) { return { t: 'col', i: c, card: k }; }
      }
      return { t: 'col', i: c, card: -1 };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Saisie, déplacement, dépôt                                          */
  /* ------------------------------------------------------------------ */

  function grab(pos) {
    if (state !== 'playing' || wonAt) { return false; }
    var g = geometry();
    var spot = locate(pos);
    if (!spot) { return false; }
    if (spot.t === 'stock') { dealRow(); return false; }
    if (spot.card < 0) { return false; }

    var col = cols[spot.i];
    if (!col[spot.card].up) { return false; }
    var run = runAt(col, spot.card);
    if (!run || !movable(run)) { return false; }
    held = {
      src: { t: 'col', i: spot.i, n: run.length },
      cards: run,
      x: pos.x * g.size, y: pos.y * g.size,
      offX: pos.x * g.size - slotX(g, spot.i),
      offY: pos.y * g.size - (g.tableY + spot.card * g.step),
      startX: pos.x * g.size, startY: pos.y * g.size, moved: false
    };
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

  function drop(pos) {
    if (!held) { return; }
    var current = held;
    held = null;
    if (!pos) { return; }
    if (!current.moved) { autoPlace(current.src); return; }
    var spot = locate(pos);
    if (!spot || spot.t !== 'col') { audio.blip(120, 0.07, 'square', 0.03); return; }
    if (!play(current.src, { t: 'col', i: spot.i })) { audio.blip(120, 0.07, 'square', 0.03); }
  }

  function dropZones() {
    if (!held || !progress.getSetting('guide')) { return null; }
    var out = [];
    for (var i = 0; i < COLS; i++) {
      if (legal(held.src, { t: 'col', i: i })) { out.push(i); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function inkOf(card) {
    var skin = progress.currentSkin();
    if (skin.rainbow) {
      return 'hsl(' + ((Cards.rank(card) * 27 + Cards.suit(card) * 90) % 360) + ', 85%, 68%)';
    }
    return null;
  }

  function card(x, y, c, band, lit, down, dim) {
    var g = geometry();
    ctx.save();
    if (dim) { ctx.globalAlpha = 0.55; }
    Cards.draw(ctx, x, y, g.cardW, g.cardH, c,
      { ramp: ramp(), band: band, lit: lit, down: down, ink: inkOf(c) });
    ctx.restore();
  }

  /* Une carte fait-elle partie d'une suite descendante que ses enseignes
     empêchent de déplacer ? Le joueur gagne à le voir tout de suite. */
  function mixedTail(col, k) {
    if (!progress.getSetting('mixed')) { return false; }
    if (!col[k].up || k === col.length - 1) { return false; }
    var tail = runAt(col, k);
    if (!tail) { return false; }
    var descend = true;
    for (var i = 1; i < tail.length; i++) {
      if (Cards.rank(tail[i - 1]) !== Cards.rank(tail[i]) + 1) { descend = false; break; }
    }
    return descend && !Cards.sameSuitRun(tail);
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!cols) { return; }

    var zones = dropZones();
    var i, k;

    // Bandeau : les huit suites à tisser, en pastilles, et la pioche à droite.
    var pipW = g.cardW * 0.46;
    var pipY = g.topY + (g.barH - pipW) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < SUITES; i++) {
      var sx = slotX(g, 0) + i * pipW * 1.3;
      var faite = i < done.length;
      ctx.globalAlpha = faite ? 1 : 0.3;
      ctx.fillStyle = faite ? ramp().home : (ramp().slot || 'rgba(120, 150, 200, 0.12)');
      Cards.roundRect(ctx, sx, pipY, pipW, pipW, pipW * 0.28);
      ctx.fill();
      if (!faite) {
        ctx.strokeStyle = ramp().edge;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = ramp().face;
        ctx.font = '700 ' + Math.round(pipW * 0.62) + 'px system-ui, sans-serif';
        ctx.fillText(Cards.SUITS[done[i]], sx + pipW / 2, pipY + pipW * 0.55);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(pipW * 0.52) + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(done.length + ' / ' + SUITES,
                 slotX(g, 0) + SUITES * pipW * 1.3 + pipW * 0.3, pipY + pipW * 0.55);
    ctx.restore();

    var stx = slotX(g, COLS - 1);
    if (stock.length) {
      // Une pile de dos, épaissie par le nombre de distributions restantes.
      var piles = Math.ceil(stock.length / COLS);
      for (k = piles - 1; k >= 0; k--) {
        Cards.draw(ctx, stx - k * g.cardW * 0.06, g.topY - k * g.cardH * 0.02,
                   g.cardW, g.cardH, 0, { ramp: ramp(), down: true });
      }
      ctx.save();
      ctx.fillStyle = '#e8eefc';
      ctx.font = '700 ' + Math.round(g.cardW * 0.42) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(piles), stx + g.cardW / 2, g.topY + g.cardH * 0.6);
      ctx.restore();
    } else {
      Cards.slot(ctx, stx, g.topY, g.cardW, g.cardH, { ramp: ramp(), glyph: '✕' });
    }

    // Les colonnes.
    for (i = 0; i < COLS; i++) {
      var col = cols[i];
      var hiddenCount = (held && held.src.i === i) ? held.src.n : 0;
      var shown = col.length - hiddenCount;
      var cx = slotX(g, i);
      var lit = zones && zones.indexOf(i) >= 0;
      if (!shown) {
        Cards.slot(ctx, cx, g.tableY, g.cardW, g.cardH,
          { ramp: ramp(), lit: lit ? ramp().home : null });
        continue;
      }
      for (k = 0; k < shown; k++) {
        var cy = g.tableY + k * g.step;
        var band = (k === shown - 1) ? g.cardH : g.step;
        var glow = (k === shown - 1 && lit) ? ramp().home : null;
        card(cx, cy, col[k].c, band, glow, !col[k].up, mixedTail(col, k));
      }
    }

    if (held) {
      var hx = clamp(held.x - held.offX, -g.cardW * 0.4, g.size - g.cardW * 0.6);
      var hy = clamp(held.y - held.offY, -g.cardH * 0.4, g.size - g.cardH * 0.4);
      for (var h = 0; h < held.cards.length; h++) {
        card(hx, hy + h * g.step, held.cards[h],
             h === held.cards.length - 1 ? g.cardH : g.step, ramp().pick, false);
      }
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
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: done.length + ' / ' + SUITES,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Coups',
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
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      held = null;
      panel.show({ title: 'Pause', subtitle: 'La toile t\'attend.', cta: 'Reprendre',
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
    running: function () { return false; },
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
    onAction: function () { if (!guardedStart() && state === 'paused') { togglePause(); } },
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    keys: { p: dealRow, u: undo }
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

  window.__neonSpider = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        suits: suitCount(),
        seed: seed,
        cols: cols.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); }),
        stock: stock.slice(),
        done: done.slice(),
        hidden: hidden(),
        score: score,
        moves: moves,
        deals: deals,
        undos: undos,
        suites: run ? run.suites : 0,
        complete: complete(),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Toutes les cartes en jeu, suites envolées comprises.
    allCards: function () {
      var out = stock.slice();
      cols.forEach(function (p) { p.forEach(function (e) { out.push(e.c); }); });
      done.forEach(function (s) {
        for (var r = 0; r < 13; r++) { out.push(r * 4 + s); }
      });
      return out;
    },
    dealSeed: function (n) { setDeal(n); },
    setBoard: function (b) {
      cols = b.cols.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); });
      stock = (b.stock || []).slice();
      done = (b.done || []).slice();
      history = [];
      held = null;
      if (b.harvest) { harvest(); }
      renderHud();
    },
    play: function (src, dst) { return play(src, dst); },
    legal: function (src, dst) { return legal(src, dst); },
    movable: function (cards) { return movable(cards); },
    autoPlace: function (src) { return autoPlace(src); },
    dealRow: dealRow,
    undo: undo,
    geometry: geometry,
    slotX: function (i) { return slotX(geometry(), i); },
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
