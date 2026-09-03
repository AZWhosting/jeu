/* Neon Klondike — la réussite classique. Sept colonnes dont l'essentiel est
   caché, une pioche, quatre fondations.

   Le paquet et le rendu des cartes viennent du socle (`core/cards.js`) :
   ce fichier ne contient que les règles du Klondike et sa mise en place. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.klondike;
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
    'src/games/klondike/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Klondike : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var Cards = Core.Cards;
  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var FOUND_POINTS = 10;        // une carte montée sur une fondation
  var FLIP_POINTS = 5;          // une carte cachée retournée
  var WASTE_POINTS = 5;         // une carte tirée de la défausse vers une colonne
  var TAKE_BACK = 15;           // redescendre une carte d'une fondation
  var WIN_BONUS = 300;
  var SPEED_MAX = 300;
  var RESTART_GRACE = 700;
  var TAP_SLOP = 9;
  var PILES = 7;

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
  var piles, stock, waste, found, seed, redeals, history;
  var score, moves, undos, dealCards, startedAt, wonAt;
  var particles, held;
  /* Les cartes que le joueur a délibérément redescendues d'une fondation : la
     montée automatique doit les laisser où il les a mises, sinon elles
     remonteraient aussitôt et le déblocage serait impossible. */
  var keptDown;
  var cascade = null;           // la remontée finale, carte après carte
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function pull() { return conf().pull || 1; }
  function redealLimit() { return conf().redeals || 0; }     // 0 = sans limite
  function best() { return progress.bestFor(difficulty); }

  function dealFrom(n) {
    var rnd = Cards.mulberry32(n);
    var deck = Cards.shuffle(Cards.deck(1), rnd);
    piles = [];
    for (var i = 0; i < PILES; i++) {
      var col = [];
      for (var k = 0; k <= i; k++) { col.push({ c: deck.pop(), up: k === i }); }
      piles.push(col);
    }
    stock = deck;                 // le reste forme la pioche
    waste = [];
    found = [0, 0, 0, 0];
  }

  function setDeal(n) {
    seed = n >>> 0;
    dealFrom(seed);
    redeals = 0;
    history = [];
    keptDown = {};
    stopCascade();
    held = null;
    wonAt = 0;
    dealCards = 0;
    startedAt = performance.now();
    settle(false);
    renderHud();
  }

  function resetRun() {
    score = 0;
    moves = 0;
    undos = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.cleanWin = false;
    run.quickWin = false;
    run.hardPullWin = false;
    run.emptied = false;
    run.allUp = false;
    runStartedAt = performance.now();
    runCommitted = false;
    setDeal(Math.floor(Math.random() * 999999) + 1);
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function faceUpRun(pile, from) {
    var out = [];
    for (var i = from; i < pile.length; i++) {
      if (!pile[i].up) { return null; }
      out.push(pile[i].c);
    }
    return out;
  }

  function cardsOf(src) {
    if (src.t === 'waste') { return waste.length ? [waste[waste.length - 1]] : []; }
    if (src.t === 'found') {
      return found[src.i] ? [(found[src.i] - 1) * 4 + src.i] : [];
    }
    var pile = piles[src.i];
    var n = src.n || 1;
    if (n > pile.length) { return []; }
    var run = faceUpRun(pile, pile.length - n);
    return run || [];
  }

  /* Une colonne n'accepte qu'une carte de rang immédiatement supérieur et de
     couleur opposée — ou un roi, si elle est vide. */
  function accepts(pile, card) {
    if (!pile.length) { return Cards.rank(card) === 12; }
    var top = pile[pile.length - 1];
    if (!top.up) { return false; }
    return Cards.rank(top.c) === Cards.rank(card) + 1 &&
           Cards.isRed(top.c) !== Cards.isRed(card);
  }

  function legal(src, dst) {
    var cards = cardsOf(src);
    if (!cards.length) { return false; }
    if (dst.t === 'found') {
      if (cards.length !== 1) { return false; }
      if (src.t === 'found') { return false; }
      return Cards.suit(cards[0]) === dst.i && found[dst.i] === Cards.rank(cards[0]);
    }
    if (src.t === 'pile' && src.i === dst.i) { return false; }
    if (!Cards.alternating(cards)) { return false; }
    return accepts(piles[dst.i], cards[0]);
  }

  function removeFrom(src, count) {
    if (src.t === 'waste') { waste.pop(); return; }
    if (src.t === 'found') { found[src.i]--; return; }
    piles[src.i].length -= count;
  }

  /* Une colonne dont la carte du dessus est cachée se retourne d'elle-même :
     personne ne joue au Klondike en laissant une carte face cachée découverte. */
  function flipExposed() {
    var flipped = 0;
    piles.forEach(function (pile) {
      if (pile.length && !pile[pile.length - 1].up) {
        pile[pile.length - 1].up = true;
        flipped++;
        score += FLIP_POINTS;
        run.flips++;
      }
    });
    if (flipped) { audio.blip(420, 0.05, 'triangle', 0.04); }
    return flipped;
  }

  function snapshot() {
    return {
      piles: piles.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); }),
      stock: stock.slice(),
      waste: waste.slice(),
      found: found.slice(),
      redeals: redeals,
      score: score,
      dealCards: dealCards,
      keptDown: JSON.parse(JSON.stringify(keptDown))
    };
  }

  function restore(snap) {
    piles = snap.piles.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); });
    stock = snap.stock.slice();
    waste = snap.waste.slice();
    found = snap.found.slice();
    redeals = snap.redeals;
    score = snap.score;
    keptDown = JSON.parse(JSON.stringify(snap.keptDown || {}));
    // Une carte redescendue n'est plus montée : le total de la partie l'oublie.
    if (run) { run.cards -= dealCards - snap.dealCards; }
    dealCards = snap.dealCards;
  }

  function toFoundation(card) {
    found[Cards.suit(card)]++;
    score += FOUND_POINTS;
    dealCards++;
    run.cards++;
    run.best = Math.max(run.best, dealCards);
  }

  /* Monte d'office ce qui ne peut plus servir à personne. */
  function safeHome(card) {
    if (keptDown[card]) { return false; }   // le joueur l'a voulue en bas
    var r = Cards.rank(card);
    if (found[Cards.suit(card)] !== r) { return false; }
    if (r <= 1) { return true; }
    var o1 = Cards.isRed(card) ? 0 : 1, o2 = Cards.isRed(card) ? 3 : 2;
    return found[o1] >= r && found[o2] >= r;
  }

  function settle(force) {
    if (!force && !progress.getSetting('auto')) { return 0; }
    var moved = 0, again = true;
    while (again) {
      again = false;
      if (waste.length && safeHome(waste[waste.length - 1])) {
        homeBurst(Cards.suit(waste[waste.length - 1]));
        toFoundation(waste.pop()); again = true; moved++;
      }
      for (var j = 0; j < piles.length; j++) {
        var pile = piles[j];
        if (pile.length && pile[pile.length - 1].up && safeHome(pile[pile.length - 1].c)) {
          homeBurst(Cards.suit(pile[pile.length - 1].c));
          toFoundation(pile.pop().c); again = true; moved++;
        }
      }
      if (again) { flipExposed(); }
    }
    return moved;
  }

  function complete() {
    return found[0] === 13 && found[1] === 13 && found[2] === 13 && found[3] === 13;
  }

  /* Une carte, n'importe laquelle, qui peut monter tout de suite. */
  function anyHome() {
    if (waste.length) {
      var w = waste[waste.length - 1];
      if (found[Cards.suit(w)] === Cards.rank(w)) { return { t: 'waste' }; }
    }
    for (var i = 0; i < PILES; i++) {
      var pile = piles[i];
      if (!pile.length) { continue; }
      var top = pile[pile.length - 1];
      if (top.up && found[Cards.suit(top.c)] === Cards.rank(top.c)) {
        return { t: 'pile', i: i, n: 1 };
      }
    }
    return null;
  }

  /* Le jeu ne se termine tout seul que s'il va réellement jusqu'au bout : on
     simule la remontée avant de la lancer. Sans cette prudence, elle
     s'enclencherait dès que plus rien n'est caché et reprendrait aussitôt la
     carte que le joueur vient de redescendre pour se débloquer. */
  function wouldFinish() {
    var f = found.slice();
    var tops = piles.map(function (p) {
      return p.filter(function (e) { return e.up; }).map(function (e) { return e.c; });
    });
    var pile = waste.slice();
    var total = f[0] + f[1] + f[2] + f[3];
    var bouge = true;
    while (bouge && total < 52) {
      bouge = false;
      if (pile.length) {
        var w = pile[pile.length - 1];
        if (f[Cards.suit(w)] === Cards.rank(w)) { f[Cards.suit(w)]++; pile.pop(); total++; bouge = true; }
      }
      for (var i = 0; i < tops.length; i++) {
        var col = tops[i];
        if (!col.length) { continue; }
        var c = col[col.length - 1];
        if (f[Cards.suit(c)] === Cards.rank(c)) { f[Cards.suit(c)]++; col.pop(); total++; bouge = true; }
      }
    }
    return total === 52;
  }

  function readyToFinish() {
    return !wonAt && !complete() && hidden() === 0 && !stock.length && wouldFinish();
  }

  function stopCascade() {
    if (cascade) { clearInterval(cascade); cascade = null; }
  }

  function startCascade() {
    if (cascade) { return; }
    keptDown = {};
    cascade = setInterval(function () {
      if (state !== 'playing' || wonAt) { stopCascade(); return; }
      var src = anyHome();
      if (!src) { stopCascade(); return; }
      var c = cardsOf(src)[0];
      history.push(snapshot());
      removeFrom(src, 1);
      homeBurst(Cards.suit(c));
      toFoundation(c);
      audio.bonus();
      moves++;
      run.moves++;
      if (complete()) { stopCascade(); win(); }
      renderHud();
    }, 90);
  }

  /* Monte tout ce qui peut monter, sans attendre : la même remontée, mais
     immédiate — ce dont les tests ont besoin. */
  function finishNow() {
    var n = 0;
    keptDown = {};
    var src = anyHome();
    while (src) {
      var c = cardsOf(src)[0];
      history.push(snapshot());
      removeFrom(src, 1);
      toFoundation(c);
      n++;
      moves++;
      run.moves++;
      src = anyHome();
    }
    if (complete() && !wonAt) { win(); }
    renderHud();
    return n;
  }

  function hidden() {
    return piles.reduce(function (n, p) {
      return n + p.filter(function (e) { return !e.up; }).length;
    }, 0);
  }

  function play(src, dst) {
    if (state !== 'playing' || wonAt) { return false; }
    if (!legal(src, dst)) { return false; }
    history.push(snapshot());
    var cards = cardsOf(src);
    var fromWaste = src.t === 'waste';
    removeFrom(src, cards.length);

    if (dst.t === 'found') {
      homeBurst(dst.i);
      toFoundation(cards[0]);
      delete keptDown[cards[0]];
      audio.bonus();
    } else {
      cards.forEach(function (c) { piles[dst.i].push({ c: c, up: true }); });
      if (src.t === 'found') {
        score = Math.max(0, score - TAKE_BACK);
        dealCards--;
        run.cards--;
        keptDown[cards[0]] = 1;
      } else if (fromWaste) { score += WASTE_POINTS; }
      // Une carte recouverte n'a plus à être protégée de la montée automatique.
      cards.slice(0, -1).forEach(function (c) { delete keptDown[c]; });
      audio.pickup();
    }

    moves++;
    run.moves++;
    flipExposed();
    settle(false);

    if (piles.some(function (p) { return !p.length; })) { run.emptied = true; }
    if (hidden() === 0) { run.allUp = true; }

    if (complete()) { win(); }
    else if (readyToFinish()) { startCascade(); }
    renderHud();
    return true;
  }

  /* La pioche : elle retourne des cartes, et se recycle quand elle est vide. */
  function drawStock() {
    if (state !== 'playing' || wonAt) { return false; }
    if (!stock.length && !waste.length) { return false; }
    history.push(snapshot());

    if (!stock.length) {
      if (redealLimit() && redeals >= redealLimit()) {
        floatText('Plus de retournement', '#ff5d8f');
        history.pop();
        audio.blip(120, 0.08, 'square', 0.04);
        return false;
      }
      // La défausse retourne dans la pioche, dans l'ordre exact où elle est venue.
      while (waste.length) { stock.push(waste.pop()); }
      redeals++;
      audio.blip(200, 0.09, 'triangle', 0.04);
    } else {
      for (var i = 0; i < pull() && stock.length; i++) { waste.push(stock.pop()); }
      audio.blip(360, 0.04, 'square', 0.03);
    }
    moves++;
    run.moves++;
    settle(false);
    if (readyToFinish()) { startCascade(); }
    renderHud();
    return true;
  }

  /* La tape : la carte part d'elle-même là où elle a le plus de sens. */
  function autoPlace(src) {
    var cards = cardsOf(src);
    if (!cards.length) { return false; }
    if (cards.length === 1) {
      var c = cards[0];
      if (play(src, { t: 'found', i: Cards.suit(c) })) { return true; }
    }
    var i;
    for (i = 0; i < PILES; i++) {
      if (piles[i].length && legal(src, { t: 'pile', i: i })) { return play(src, { t: 'pile', i: i }); }
    }
    for (i = 0; i < PILES; i++) {
      if (!piles[i].length && legal(src, { t: 'pile', i: i })) { return play(src, { t: 'pile', i: i }); }
    }
    audio.blip(120, 0.07, 'square', 0.03);
    return false;
  }

  function undo() {
    if (state !== 'playing' || !history.length || wonAt) { return false; }
    restore(history.pop());
    undos++;
    run.undos++;
    held = null;
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
    return true;
  }

  function win() {
    stopCascade();
    wonAt = performance.now();
    var seconds = (wonAt - startedAt) / 1000;
    var speed = Math.max(0, Math.round(SPEED_MAX - seconds));
    var gained = Math.round((WIN_BONUS + speed) * (conf().bonus || 1));
    score += gained;
    run.score = score;
    run.wins++;
    if (undos === 0) { run.cleanWin = true; }
    if (seconds < 300) { run.quickWin = true; }
    if (pull() === 3) { run.hardPullWin = true; }

    burst(ramp().home, 30);
    floatText('Réussite ! +' + gained, ramp().home);
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
      title: beaten ? 'Nouveau record !' : (won ? 'Réussite !' : 'Partie enregistrée'),
      subtitle: won ? 'Les 52 cartes sont montées.'
                    : dealCards + ' carte(s) montée(s) sur cette donne.',
      cta: 'Nouvelle donne',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Cartes montées',
        extra: run.cards,
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

  function homeBurst(suit) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    var x = slotX(g, 3 + suit) + g.cardW / 2;
    var y = g.topY + g.cardH / 2;
    for (var i = 0; i < 9; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.6 + Math.random() * 1.6;
      particles.push({
        x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.0022 + Math.random() * 0.002,
        size: 1.4 + Math.random() * 2.2, color: ramp().home
      });
    }
  }

  function burst(color, count) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.8 + Math.random() * 2.2;
      particles.push({
        x: g.size / 2, y: g.size / 2,
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
    el.style.top = '42%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  function geometry() {
    var size = loop.size();
    var pad = size * 0.012;
    var colW = (size - pad * 2) / PILES;
    var gap = colW * 0.10;
    var cardW = colW - gap;
    var cardH = cardW * 1.42;
    var topY = pad;
    var tableY = topY + cardH + size * 0.030;
    var availH = size - tableY - pad;
    var longest = 1;
    for (var i = 0; i < piles.length; i++) { longest = Math.max(longest, piles[i].length); }
    var step = Math.min(cardH * 0.40, (availH - cardH) / Math.max(1, longest - 1));
    step = Math.max(step, Math.max(8, cardH * 0.13));
    return { size: size, pad: pad, colW: colW, gap: gap, cardW: cardW, cardH: cardH,
             topY: topY, tableY: tableY, step: step };
  }

  function slotX(g, index) { return g.pad + index * g.colW + g.gap / 2; }

  /* La défausse étale ses dernières cartes : la carte jouable, celle du dessus,
     n'est donc pas à l'aplomb de son emplacement. Le dessin et la détection du
     toucher lisent le même décalage — sans quoi on clique sur la carte qu'on
     voit et rien ne se passe. */
  function wasteSpread(g) { return g.cardW * 0.16 * 0.6; }

  function wasteShown(g) { return Math.min(waste.length, pull()); }

  function wasteTopX(g) {
    return slotX(g, 1) + Math.max(0, wasteShown(g) - 1) * wasteSpread(g);
  }

  /* Où le doigt vient-il de se poser ? La rangée du haut porte la pioche, la
     défausse et les quatre fondations ; le reste, ce sont les colonnes. */
  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;

    if (py >= g.topY && py <= g.topY + g.cardH) {
      // La carte du dessus de la défausse d'abord : c'est celle qu'on vise.
      if (waste.length) {
        var wx = wasteTopX(g);
        if (px >= wx && px <= wx + g.cardW) { return { t: 'waste' }; }
      }
      var slot = Math.floor((px - g.pad) / g.colW);
      if (slot < 0 || slot > 6) { return null; }
      if (slot === 0) { return { t: 'stock' }; }
      // L'emplacement 2 sépare la défausse des fondations : il lui revient,
      // puisque c'est là que ses cartes étalées débordent.
      if (slot === 1 || slot === 2) { return { t: 'waste' }; }
      if (slot >= 3) { return { t: 'found', i: slot - 3 }; }
      return null;
    }

    if (py >= g.tableY - g.size * 0.01) {
      var c = clamp(Math.floor((px - g.pad) / g.colW), 0, PILES - 1);
      var pile = piles[c];
      for (var k = pile.length - 1; k >= 0; k--) {
        var top = g.tableY + k * g.step;
        var bottom = (k === pile.length - 1) ? top + g.cardH : top + g.step;
        if (py >= top && py <= bottom) { return { t: 'pile', i: c, card: k }; }
      }
      return { t: 'pile', i: c, card: -1 };
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

    if (spot.t === 'stock') { drawStock(); return false; }
    if (spot.t === 'found') {
      if (!found[spot.i]) { return false; }
      held = {
        src: { t: 'found', i: spot.i },
        cards: [(found[spot.i] - 1) * 4 + spot.i],
        x: pos.x * g.size, y: pos.y * g.size,
        offX: pos.x * g.size - slotX(g, 3 + spot.i), offY: pos.y * g.size - g.topY,
        startX: pos.x * g.size, startY: pos.y * g.size, moved: false
      };
      audio.unlock();
      return true;
    }
    if (spot.t === 'waste') {
      if (!waste.length) { return false; }
      held = {
        src: { t: 'waste' },
        cards: [waste[waste.length - 1]],
        x: pos.x * g.size, y: pos.y * g.size,
        offX: pos.x * g.size - wasteTopX(g), offY: pos.y * g.size - g.topY,
        startX: pos.x * g.size, startY: pos.y * g.size, moved: false
      };
      audio.unlock();
      return true;
    }

    if (spot.card < 0) { return false; }
    var pile = piles[spot.i];
    if (!pile[spot.card].up) { return false; }        // on ne saisit pas une carte cachée
    var run = faceUpRun(pile, spot.card);
    if (!run || !Cards.alternating(run)) { return false; }
    held = {
      src: { t: 'pile', i: spot.i, n: run.length },
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
    if (!spot || spot.t === 'stock') { audio.blip(120, 0.07, 'square', 0.03); return; }
    var dst = spot.t === 'pile' ? { t: 'pile', i: spot.i } :
              (spot.t === 'found' ? { t: 'found', i: spot.i } : null);
    if (!dst || !play(current.src, dst)) { audio.blip(120, 0.07, 'square', 0.03); }
  }

  function dropZones() {
    if (!held || !progress.getSetting('guide')) { return null; }
    var zones = { piles: [], found: [] };
    for (var i = 0; i < PILES; i++) {
      if (legal(held.src, { t: 'pile', i: i })) { zones.piles.push(i); }
    }
    for (var k = 0; k < 4; k++) {
      if (legal(held.src, { t: 'found', i: k })) { zones.found.push(k); }
    }
    return zones;
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

  function card(x, y, c, band, lit, down) {
    var g = geometry();
    Cards.draw(ctx, x, y, g.cardW, g.cardH, c,
      { ramp: ramp(), band: band, lit: lit, down: down, ink: inkOf(c) });
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!piles) { return; }

    var zones = dropZones();
    var i, k;

    // La pioche : un dos de carte, ou l'emplacement vide quand tout est passé.
    if (stock.length) { card(slotX(g, 0), g.topY, stock[stock.length - 1], g.cardH, null, true); }
    else {
      var reste = !redealLimit() || redeals < redealLimit();
      Cards.slot(ctx, slotX(g, 0), g.topY, g.cardW, g.cardH,
        { ramp: ramp(), glyph: reste ? '↻' : '✕' });
    }

    // La défausse : les dernières cartes tirées, légèrement décalées.
    if (waste.length) {
      var show = wasteShown(g);
      var spread = wasteSpread(g);
      for (k = 0; k < show; k++) {
        var idx = waste.length - show + k;
        var last = k === show - 1;
        if (held && held.src.t === 'waste' && last) { continue; }
        card(slotX(g, 1) + k * spread, g.topY, waste[idx], g.cardH,
             last ? ramp().pick : null, false);
      }
    } else {
      Cards.slot(ctx, slotX(g, 1), g.topY, g.cardW, g.cardH, { ramp: ramp() });
    }

    // Les fondations, une par enseigne.
    for (i = 0; i < 4; i++) {
      var fx = slotX(g, 3 + i);
      var flit = zones && zones.found.indexOf(i) >= 0;
      var hideTop = held && held.src.t === 'found' && held.src.i === i;
      if (!found[i] || hideTop) {
        Cards.slot(ctx, fx, g.topY, g.cardW, g.cardH,
          { ramp: ramp(), glyph: Cards.SUITS[i], lit: flit ? ramp().home : null });
      } else {
        card(fx, g.topY, (found[i] - 1) * 4 + i, g.cardH, flit ? ramp().home : null, false);
      }
    }

    // Les colonnes.
    for (i = 0; i < PILES; i++) {
      var pile = piles[i];
      var hiddenCount = (held && held.src.t === 'pile' && held.src.i === i) ? held.src.n : 0;
      var shown = pile.length - hiddenCount;
      var cx = slotX(g, i);
      var clit = zones && zones.piles.indexOf(i) >= 0;
      if (!shown) {
        Cards.slot(ctx, cx, g.tableY, g.cardW, g.cardH,
          { ramp: ramp(), lit: clit ? ramp().home : null });
        continue;
      }
      for (k = 0; k < shown; k++) {
        var cy = g.tableY + k * g.step;
        var band = (k === shown - 1) ? g.cardH : g.step;
        var glow = (k === shown - 1 && clit) ? ramp().home : null;
        card(cx, cy, pile[k].c, band, glow, !pile[k].up);
      }
    }

    // Les cartes tenues, par-dessus tout le reste.
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
      side: found.reduce(function (a, b) { return a + b; }, 0) + ' / 52',
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
      stopCascade();
      held = null;
      panel.show({ title: 'Pause', subtitle: 'La donne t\'attend.', cta: 'Reprendre',
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
      if (name === 'auto' && state === 'playing') { settle(false); renderHud(); }
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
    keys: { p: drawStock, u: undo }
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

  window.__neonKlondike = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        pull: pull(),
        redeals: redeals,
        redealLimit: redealLimit(),
        seed: seed,
        piles: piles.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); }),
        stock: stock.slice(),
        waste: waste.slice(),
        found: found.slice(),
        hidden: hidden(),
        keptDown: Object.keys(keptDown).map(Number),
        cascading: !!cascade,
        score: score,
        moves: moves,
        undos: undos,
        cards: run ? run.cards : 0,
        wins: run ? run.wins : 0,
        complete: complete(),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Toutes les cartes en jeu, où qu'elles soient : la sonde de l'invariant.
    allCards: function () {
      var out = stock.concat(waste);
      piles.forEach(function (p) { p.forEach(function (e) { out.push(e.c); }); });
      for (var s = 0; s < 4; s++) {
        for (var r = 0; r < found[s]; r++) { out.push(r * 4 + s); }
      }
      return out;
    },
    dealSeed: function (n) { setDeal(n); },
    setBoard: function (b) {
      stopCascade();
      piles = b.piles.map(function (p) { return p.map(function (e) { return { c: e.c, up: e.up }; }); });
      stock = (b.stock || []).slice();
      waste = (b.waste || []).slice();
      found = (b.found || [0, 0, 0, 0]).slice();
      history = [];
      keptDown = {};
      held = null;
      if (b.settle) { settle(true); }
      renderHud();
    },
    play: function (src, dst) { return play(src, dst); },
    legal: function (src, dst) { return legal(src, dst); },
    autoPlace: function (src) { return autoPlace(src); },
    drawStock: drawStock,
    finishNow: finishNow,
    readyToFinish: readyToFinish,
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
