/* Neon Pyramid — la pyramide. Vingt-huit cartes en sept rangées, qu'on démolit
   deux par deux en formant treize.

   C'est la seule réussite de la plateforme où l'on ne construit rien : il n'y a
   pas de fondation à monter ni de colonne à ranger, seulement une pile à faire
   fondre par le bas. Et c'est la seule dont la donne n'est pas tirée au hasard —
   une pyramide au hasard est presque toujours perdue d'avance, alors le jeu
   pioche dans une table de donnes qu'un solveur a prouvées gagnables avec le
   nombre de passes que la difficulté accorde. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.pyramid;
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
    'src/games/pyramid/manifest.js': manifest,
    'src/games/pyramid/deals.js': window.Games && window.Games.pyramidDeals
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Pyramid : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var Cards = Core.Cards;
  var DEALS = window.Games.pyramidDeals;
  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var SIZE = 28;                // vingt-huit cartes, sept rangées
  var ROWS = 7;
  var ROW_BONUS = 60;
  var WIN_BONUS = 400;
  var SPEED_MAX = 300;
  var QUICK_MS = 180000;        // « main leste » : trois minutes
  var RESTART_GRACE = 700;
  var TAP_SLOP = 9;
  var FAN = 3;                  // cartes visibles de la défausse, en éventail

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* La rangée d'une carte, et le premier index de chaque rangée : deux tables
     qu'on calcule une fois pour toutes. */
  var ROW_OF = [], START_OF = [], CHILD = [];
  (function () {
    for (var r = 0; r < ROWS; r++) {
      var start = r * (r + 1) / 2, next = (r + 1) * (r + 2) / 2;
      START_OF[r] = start;
      for (var i = 0; i <= r; i++) {
        ROW_OF[start + i] = r;
        CHILD[start + i] = (r === ROWS - 1) ? null : [next + i, next + i + 1];
      }
    }
  }());

  function value(c) { return Cards.rank(c) + 1; }     // as = 1 … roi = 13

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var pyr, gone, stock, waste, pulled, pass, rowsPaid, seed;
  var history, pick, held, stuck;
  var score, moves, undos, startedAt, wonAt;
  var particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function passes() { return conf().passes || 1; }
  function best() { return progress.bestFor(difficulty); }

  /* Les donnes prouvées de cette difficulté. Le mode libre emprunte celles du
     mode facile : même nombre de passes, mêmes garanties. */
  function table() {
    var id = difficulty === 'zen' ? 'easy' : difficulty;
    return DEALS[id] || DEALS.easy;
  }

  /* La donne : le paquet est mélangé par le numéro, les vingt-huit premières
     cartes tirées font la pyramide, les vingt-quatre autres la pioche. Node et
     le navigateur en tirent exactement la même — c'est ce qui permet de prouver
     une donne hors ligne et de la servir ici par son seul numéro. */
  function dealFrom(n) {
    var d = Cards.shuffle(Cards.deck(1), Cards.mulberry32(n));
    pyr = [];
    for (var i = 0; i < SIZE; i++) { pyr.push(d.pop()); }
    gone = [];
    for (i = 0; i < SIZE; i++) { gone.push(false); }
    stock = d;                  // vingt-quatre cartes, piochées par la fin
    waste = [];
    pulled = [];                // les cartes de la défausse déjà retirées
    pass = 0;
    rowsPaid = [];
  }

  function setDeal(n) {
    seed = n >>> 0;
    dealFrom(seed);
    history = [];
    pick = null;
    held = null;
    stuck = false;
    wonAt = 0;
    startedAt = performance.now();
    renderHud();
  }

  function resetRun() {
    score = 0;
    moves = 0;
    undos = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.rows = 0;
    run.cleanWin = false;
    run.singlePass = false;
    run.quickWin = false;
    runStartedAt = performance.now();
    runCommitted = false;
    var list = table();
    setDeal(list[Math.floor(Math.random() * list.length)]);
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  /* Libre : encore là, et plus rien ne la recouvre. */
  function free(i) {
    if (gone[i]) { return false; }
    var kids = CHILD[i];
    if (!kids) { return true; }
    return gone[kids[0]] && gone[kids[1]];
  }

  function freeList() {
    var out = [];
    for (var i = 0; i < SIZE; i++) { if (free(i)) { out.push(i); } }
    return out;
  }

  function wasteTop() { return waste.length ? waste[waste.length - 1] : -1; }

  function cardAt(spot) {
    if (!spot) { return -1; }
    if (spot.t === 'pyr') { return free(spot.i) ? pyr[spot.i] : -1; }
    if (spot.t === 'waste') { return wasteTop(); }
    return -1;
  }

  function same(a, b) { return !!a && !!b && a.t === b.t && a.i === b.i; }

  /* Deux emplacements forment-ils treize ? */
  function pairs(a, b) {
    if (same(a, b)) { return false; }
    var ca = cardAt(a), cb = cardAt(b);
    if (ca < 0 || cb < 0) { return false; }
    return value(ca) + value(cb) === 13;
  }

  function isKing(spot) {
    var c = cardAt(spot);
    return c >= 0 && value(c) === 13;
  }

  function canDraw() { return stock.length > 0; }
  function canRedeal() { return !stock.length && waste.length > 0 && pass + 1 < passes(); }

  /* Reste-t-il quoi que ce soit à faire ? */
  function anyMove() {
    if (canDraw() || canRedeal()) { return true; }
    var open = freeList().map(function (i) { return { t: 'pyr', i: i }; });
    if (waste.length) { open.push({ t: 'waste' }); }
    for (var a = 0; a < open.length; a++) {
      if (isKing(open[a])) { return true; }
      for (var b = a + 1; b < open.length; b++) {
        if (pairs(open[a], open[b])) { return true; }
      }
    }
    return false;
  }

  function cleared() {
    var n = 0;
    for (var i = 0; i < SIZE; i++) { if (gone[i]) { n++; } }
    return n;
  }

  function complete() { return cleared() === SIZE; }

  /* Une carte du haut coûte cher à dégager : elle vaut donc davantage. */
  function worth(i) { return 5 * (ROWS - ROW_OF[i]); }

  function snapshot() {
    return {
      gone: gone.slice(), stock: stock.slice(), waste: waste.slice(),
      pulled: pulled.slice(), pass: pass, rowsPaid: rowsPaid.slice(),
      score: score, rows: run ? run.rows : 0
    };
  }

  function restore(snap) {
    gone = snap.gone.slice();
    stock = snap.stock.slice();
    waste = snap.waste.slice();
    pulled = snap.pulled.slice();
    pass = snap.pass;
    rowsPaid = snap.rowsPaid.slice();
    score = snap.score;
    if (run) { run.rows = snap.rows; }
    stuck = false;
  }

  /* Une rangée entièrement dégagée : on la paie une fois. */
  function payRows() {
    for (var r = 0; r < ROWS; r++) {
      if (rowsPaid.indexOf(r) >= 0) { continue; }
      var full = true;
      for (var i = START_OF[r]; i <= START_OF[r] + r; i++) {
        if (!gone[i]) { full = false; break; }
      }
      if (!full) { continue; }
      rowsPaid.push(r);
      run.rows++;
      score += Math.round(ROW_BONUS * (conf().bonus || 1));
      floatText('Rangée dégagée ! +' + Math.round(ROW_BONUS * (conf().bonus || 1)), ramp().home);
      burst(ramp().home, 14);
    }
  }

  function take(spot) {
    if (spot.t === 'pyr') {
      gone[spot.i] = true;
      score += Math.round(worth(spot.i) * (conf().bonus || 1));
      run.cleared++;
    } else {
      pulled.push(waste.pop());
    }
  }

  /* Retirer une paire, ou un roi tout seul. */
  function remove(a, b) {
    if (state !== 'playing' || wonAt) { return false; }
    if (b) {
      if (!pairs(a, b)) { return false; }
    } else {
      if (!isKing(a)) { return false; }
    }
    history.push(snapshot());
    take(a);
    if (b) { take(b); }
    moves++;
    run.moves++;
    run.pairs++;
    run.best = Math.max(run.best, cleared());
    pick = null;
    audio.pickup();
    payRows();
    if (complete()) { win(); }
    else { checkStuck(); }
    renderHud();
    return true;
  }

  function draw1() {
    if (state !== 'playing' || wonAt) { return false; }
    if (canDraw()) {
      history.push(snapshot());
      waste.push(stock.pop());
      moves++;
      run.moves++;
      pick = null;
      audio.blip(300, 0.06, 'triangle', 0.04);
      checkStuck();
      renderHud();
      return true;
    }
    if (canRedeal()) {
      history.push(snapshot());
      // La défausse se retourne : l'ordre de pioche est conservé.
      stock = waste.slice().reverse();
      waste = [];
      pass++;
      moves++;
      run.moves++;
      run.redeals++;
      pick = null;
      audio.blip(220, 0.08, 'triangle', 0.04);
      floatText('Passe ' + (pass + 1) + ' / ' + passes(), ramp().pick);
      renderHud();
      return true;
    }
    floatText(passes() === 1 ? 'Une seule passe : la pioche est finie'
                             : 'Plus aucune passe', '#ff5d8f');
    audio.blip(120, 0.08, 'square', 0.04);
    return false;
  }

  /* La tape sur une carte : le roi part seul, sinon on choisit puis on marie. */
  function tap(spot) {
    if (state !== 'playing' || wonAt) { return false; }
    if (spot.t === 'stock') { return draw1(); }
    if (cardAt(spot) < 0) {
      audio.blip(120, 0.07, 'square', 0.03);
      return false;
    }
    if (isKing(spot)) { return remove(spot, null); }
    if (same(pick, spot)) { pick = null; return false; }
    if (pick && pairs(pick, spot)) { return remove(pick, spot); }
    pick = spot;
    audio.blip(520, 0.04, 'triangle', 0.03);
    return false;
  }

  function undo() {
    if (state !== 'playing' || !history.length || wonAt) { return false; }
    restore(history.pop());
    undos++;
    pick = null;
    held = null;
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
    return true;
  }

  /* L'impasse : plus une paire, plus une carte à piocher, plus une passe. Elle
     est toujours annoncée ; le réglage décide seulement si la partie s'arrête
     là ou si l'on garde la main pour revenir en arrière. */
  function checkStuck() {
    if (stuck || complete() || anyMove()) { return; }
    stuck = true;
    floatText('Impasse', ramp().dead || '#ff5d8f');
    audio.blip(110, 0.16, 'square', 0.05);
    if (!progress.getSetting('dead')) { return; }
    setTimeout(function () {
      if (state !== 'playing' || complete() || !stuck) { return; }
      finish(false);
    }, 1200);
  }

  function win() {
    wonAt = performance.now();
    var seconds = (wonAt - startedAt) / 1000;
    var speed = Math.max(0, Math.round(SPEED_MAX - seconds));
    var gained = Math.round((WIN_BONUS + speed) * (conf().bonus || 1));
    score += gained;
    run.wins++;
    run.score = score;
    if (undos === 0) { run.cleanWin = true; }
    if (pass === 0) { run.singlePass = true; }
    if (wonAt - startedAt < QUICK_MS) { run.quickWin = true; }
    burst(ramp().home, 34);
    floatText('Sommet atteint ! +' + gained, ramp().home);
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
      title: beaten ? 'Nouveau record !' : (won ? 'Sommet atteint !' : 'Impasse'),
      subtitle: won ? 'La pyramide est à terre.'
                    : cleared() + ' carte(s) retirée(s) sur ' + SIZE +
                      ' — la donne était gagnable, le chemin est passé ailleurs.',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Cartes retirées',
        extra: cleared(),
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
        x: g.size / 2, y: g.size * 0.32,
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
    el.style.top = '34%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  /* Sept cartes de large en bas, sept rangées qui se recouvrent aux deux
     cinquièmes : la pyramide occupe le haut, la pioche et la défausse le bas. */
  function geometry() {
    var size = loop.size();
    var pad = size * 0.02;
    var cardW = (size - pad * 2) / 7.3;   // sept cartes de large, plus un souffle
    var cardH = cardW * 1.42;
    var rowStep = cardH * 0.44;
    var pyrTop = pad;
    var pyrH = rowStep * (ROWS - 1) + cardH;
    var barY = Math.min(pyrTop + pyrH + size * 0.05, size - pad - cardH);
    return { size: size, pad: pad, cardW: cardW, cardH: cardH, rowStep: rowStep,
             pyrTop: pyrTop, pyrH: pyrH, barY: barY, mid: size / 2 };
  }

  function cardX(g, i) {
    var r = ROW_OF[i], k = i - START_OF[r];
    return g.mid - (r + 1) * g.cardW / 2 + k * g.cardW;
  }
  function cardY(g, i) { return g.pyrTop + ROW_OF[i] * g.rowStep; }

  function stockX(g) { return g.pad; }
  function wasteX(g, k) { return g.pad + g.cardW * 1.3 + k * g.cardW * 0.34; }

  function inRect(px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  /* Les rangées basses recouvrent les hautes : on les interroge dans cet ordre. */
  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;

    for (var i = SIZE - 1; i >= 0; i--) {
      if (gone[i]) { continue; }
      if (inRect(px, py, cardX(g, i), cardY(g, i), g.cardW, g.cardH)) { return { t: 'pyr', i: i }; }
    }
    if (inRect(px, py, stockX(g), g.barY, g.cardW, g.cardH)) { return { t: 'stock' }; }
    /* Toute la défausse répond, éventail compris : c'est toujours la carte du
       dessus qu'on désigne, et viser précisément le quart visible d'une carte
       serait une exigence inutile. */
    var shown = fanCount();
    if (shown && inRect(px, py, wasteX(g, 0), g.barY,
                        wasteX(g, shown - 1) - wasteX(g, 0) + g.cardW, g.cardH)) {
      return { t: 'waste' };
    }
    return null;
  }

  function fanCount() {
    if (!waste.length) { return 0; }
    return progress.getSetting('fan') ? Math.min(FAN, waste.length) : 1;
  }

  /* ------------------------------------------------------------------ */
  /* Saisie, déplacement, dépôt                                          */
  /* ------------------------------------------------------------------ */

  function grab(pos) {
    if (state !== 'playing' || wonAt) { return false; }
    var spot = locate(pos);
    if (!spot) { pick = null; return false; }
    var g = geometry();
    held = {
      spot: spot,
      x: pos.x * g.size, y: pos.y * g.size,
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
    if (!current.moved || !pos) { tap(current.spot); return; }
    // Glisser une carte sur une autre : c'est la paire, sans passer par le choix.
    var target = locate(pos);
    if (!target || target.t === 'stock' || current.spot.t === 'stock') {
      tap(current.spot);
      return;
    }
    if (!remove(current.spot, target)) {
      pick = null;
      audio.blip(120, 0.07, 'square', 0.03);
    }
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

  /* Les emplacements qui complètent la carte choisie — le guide du joueur. */
  function mates() {
    if (!pick || !progress.getSetting('guide')) { return []; }
    var out = [];
    freeList().forEach(function (i) {
      if (pairs(pick, { t: 'pyr', i: i })) { out.push('pyr' + i); }
    });
    if (waste.length && pairs(pick, { t: 'waste' })) { out.push('waste'); }
    return out;
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!pyr) { return; }

    var lit = mates();
    var i;

    /* La pyramide se pose comme on la distribue : le sommet d'abord, puis
       chaque rangée par-dessus la précédente. Une carte est donc recouverte par
       les deux qui sont sous elle — exactement celles qui la bloquent — et ce
       qu'il en reste de visible est sa bande du haut, index compris. */
    for (i = 0; i < SIZE; i++) {
      if (gone[i]) { continue; }
      var derniere = ROW_OF[i] === ROWS - 1;
      var open = free(i);
      var glow = null;
      if (same(pick, { t: 'pyr', i: i })) { glow = ramp().pick; }
      else if (lit.indexOf('pyr' + i) >= 0) { glow = ramp().home; }
      Cards.draw(ctx, cardX(g, i), cardY(g, i), g.cardW, g.cardH, pyr[i],
        { ramp: ramp(), band: derniere ? g.cardH : g.rowStep, lit: glow, ink: inkOf(pyr[i]) });
      // Une carte encore bloquée reste dans l'ombre de celles qui la couvrent.
      // Un voile plutôt qu'une transparence : sinon on lirait à travers.
      if (!open && !glow) {
        ctx.save();
        ctx.fillStyle = 'rgba(4, 7, 14, 0.44)';
        Cards.roundRect(ctx, cardX(g, i), cardY(g, i), g.cardW, g.cardH, g.cardW * 0.14);
        ctx.fill();
        ctx.restore();
      }
    }

    // La pioche : une pile de dos, son compte, et la passe en cours.
    var sx = stockX(g);
    if (stock.length) {
      var piles = Math.min(4, Math.ceil(stock.length / 6));
      for (i = piles - 1; i >= 0; i--) {
        Cards.draw(ctx, sx - i * g.cardW * 0.05, g.barY - i * g.cardH * 0.02,
                   g.cardW, g.cardH, 0, { ramp: ramp(), down: true });
      }
      ctx.save();
      ctx.fillStyle = '#e8eefc';
      ctx.font = '700 ' + Math.round(g.cardW * 0.38) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(stock.length), sx + g.cardW / 2, g.barY + g.cardH * 0.6);
      ctx.restore();
    } else {
      Cards.slot(ctx, sx, g.barY, g.cardW, g.cardH,
        { ramp: ramp(), glyph: canRedeal() ? '↻' : '✕',
          lit: canRedeal() ? ramp().home : null });
    }

    // La défausse, en éventail : seule celle du dessus se joue.
    var shown = fanCount();
    for (i = 0; i < shown; i++) {
      var card = waste[waste.length - shown + i];
      var top = i === shown - 1;
      var wglow = null;
      if (top && same(pick, { t: 'waste' })) { wglow = ramp().pick; }
      else if (top && lit.indexOf('waste') >= 0) { wglow = ramp().home; }
      Cards.draw(ctx, wasteX(g, i), g.barY, g.cardW, g.cardH, card,
        { ramp: ramp(), band: top ? g.cardH : g.cardW * 0.34, lit: wglow, ink: inkOf(card) });
    }
    if (!waste.length) {
      Cards.slot(ctx, wasteX(g, 0), g.barY, g.cardW, g.cardH, { ramp: ramp() });
    }

    // Le compteur, à droite du bandeau : passe en cours et cartes restantes.
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(g.cardW * 0.30) + 'px system-ui, sans-serif';
    ctx.fillText('Passe ' + (pass + 1) + ' / ' + passes(),
                 g.size - g.pad, g.barY + g.cardH * 0.34);
    ctx.fillStyle = stuck ? (ramp().dead || '#ff5d8f') : ramp().home;
    ctx.font = '700 ' + Math.round(g.cardW * 0.40) + 'px system-ui, sans-serif';
    ctx.fillText(stuck ? 'Impasse' : (SIZE - cleared()) + ' cartes',
                 g.size - g.pad, g.barY + g.cardH * 0.72);
    ctx.restore();

    // La carte tenue suit le doigt.
    if (held && held.moved && held.spot.t !== 'stock') {
      var c = cardAt(held.spot);
      if (c >= 0) {
        var hx = clamp(held.x - g.cardW / 2, -g.cardW * 0.4, g.size - g.cardW * 0.6);
        var hy = clamp(held.y - g.cardH / 2, -g.cardH * 0.4, g.size - g.cardH * 0.4);
        Cards.draw(ctx, hx, hy, g.cardW, g.cardH, c,
          { ramp: ramp(), band: g.cardH, lit: ramp().pick, ink: inkOf(c) });
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
      side: cleared() + ' / ' + SIZE,
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
      panel.show({ title: 'Pause', subtitle: 'La pyramide t\'attend.', cta: 'Reprendre',
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
    keys: { p: draw1, u: undo }
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

  window.__neonPyramid = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        passes: passes(),
        seed: seed,
        pyr: pyr.slice(),
        gone: gone.slice(),
        stock: stock.slice(),
        waste: waste.slice(),
        pulled: pulled.slice(),
        pass: pass,
        free: freeList(),
        cleared: cleared(),
        complete: complete(),
        stuck: stuck,
        anyMove: anyMove(),
        score: score,
        moves: moves,
        undos: undos,
        pairs: run ? run.pairs : 0,
        rows: run ? run.rows : 0,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Toutes les cartes en jeu, celles déjà retirées comprises.
    allCards: function () {
      var out = stock.concat(waste).concat(pulled);
      for (var i = 0; i < SIZE; i++) { out.push(pyr[i]); }
      return out;
    },
    deals: function () { return DEALS; },
    dealSeed: function (n) { setDeal(n); },
    dealAt: function (id, k) { setDeal((DEALS[id] || DEALS.easy)[k]); },
    setBoard: function (b) {
      if (b.pyr) { pyr = b.pyr.slice(); }
      if (b.gone) { gone = b.gone.slice(); }
      if (b.stock) { stock = b.stock.slice(); }
      if (b.waste) { waste = b.waste.slice(); }
      pulled = (b.pulled || []).slice();
      if (b.pass !== undefined) { pass = b.pass; }
      history = [];
      pick = null;
      held = null;
      stuck = false;
      renderHud();
    },
    free: function (i) { return free(i); },
    pairs: function (a, b) { return pairs(a, b); },
    tap: function (spot) { return tap(spot); },
    remove: function (a, b) { return remove(a, b || null); },
    picked: function () { return pick; },
    drawCard: draw1,
    undo: undo,
    geometry: geometry,
    spotAt: function (spot) {
      var g = geometry();
      if (spot.t === 'pyr') {
        // Seul le haut de la carte dépasse de celles qui la recouvrent : c'est
        // là qu'il faut viser, et c'est là que le joueur clique.
        return { x: (cardX(g, spot.i) + g.cardW / 2) / g.size,
                 y: (cardY(g, spot.i) + g.rowStep * 0.5) / g.size };
      }
      if (spot.t === 'stock') {
        return { x: (stockX(g) + g.cardW / 2) / g.size, y: (g.barY + g.cardH / 2) / g.size };
      }
      var shown = Math.max(1, fanCount());
      return { x: (wasteX(g, shown - 1) + g.cardW / 2) / g.size,
               y: (g.barY + g.cardH / 2) / g.size };
    },
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
