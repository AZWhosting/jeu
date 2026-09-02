/* Neon Cells — réussite FreeCell. Tout le jeu est visible dès la donne : il n'y
   a donc pas de hasard subi, seulement des décisions. Le jeu embarque son
   propre solveur, qui sert deux fois : il refuse de servir une donne qu'il n'a
   pas su résoudre, et il répond quand le joueur demande un indice. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.cells;
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
    'src/games/cells/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Cells : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var Cards = Core.Cards;
  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var CARD_POINTS = 12;         // par carte montée sur une fondation
  var WIN_BONUS = 250;          // à la donne terminée, avant coefficient
  var SPEED_MAX = 300;          // bonus de rapidité, un point par seconde gagnée
  var HINT_COST = 40;
  var RESTART_GRACE = 700;
  var SOLVE_BUDGET = 15000;     // états développés avant d'abandonner
  var DEAL_TRIES = 12;          // donnes tirées avant de renoncer à en prouver une
  var TAP_SLOP = 9;             // px : en deçà, le geste est une tape, pas un glissé

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  var SUITS = ['♠', '♥', '♦', '♣'];   // pique coeur carreau trèfle

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  function rankOf(c) { return c >> 2; }
  function suitOf(c) { return c & 3; }
  function isRed(c) { var s = c & 3; return s === 1 || s === 2; }

  /* ------------------------------------------------------------------ */
  /* Donne                                                               */
  /* ------------------------------------------------------------------ */

  // Générateur reproductible : une donne se rejoue à partir de son numéro.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function dealFrom(seed) {
    var rnd = mulberry32(seed);
    var deck = [];
    for (var i = 0; i < 52; i++) { deck.push(i); }
    for (var j = 51; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = deck[j]; deck[j] = deck[k]; deck[k] = t;
    }
    var out = [[], [], [], [], [], [], [], []];
    deck.forEach(function (c, n) { out[n % 8].push(c); });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Solveur — recherche au meilleur d'abord                             */
  /* ------------------------------------------------------------------ */

  /* Les coups y sont notés en abrégé : cf colonne→fondation, xf cellule→
     fondation, cx colonne→cellule, cc colonne→colonne, xc cellule→colonne. */
  var Solver = (function () {

    function safeHome(found, c) {
      var r = rankOf(c);
      if (found[suitOf(c)] !== r) { return false; }
      if (r <= 1) { return true; }              // as et deux ne servent plus à personne
      var o1 = isRed(c) ? 0 : 1, o2 = isRed(c) ? 3 : 2;
      return found[o1] >= r && found[o2] >= r;  // plus aucune carte n'a besoin de celle-ci
    }

    function enc(st) {
      var parts = [];
      for (var i = 0; i < st.cols.length; i++) {
        var s = '';
        for (var j = 0; j < st.cols[i].length; j++) { s += String.fromCharCode(65 + st.cols[i][j]); }
        parts.push(s);
      }
      var f = '';
      for (var k = 0; k < st.free.length; k++) {
        f += String.fromCharCode(st.free[k] < 0 ? 64 : 65 + st.free[k]);
      }
      return parts.join('/') + '|' + f + '|' +
        String.fromCharCode(65 + st.found[0], 65 + st.found[1], 65 + st.found[2], 65 + st.found[3]);
    }

    function dec(str) {
      var parts = str.split('|');
      var cols = parts[0].split('/').map(function (s) {
        var col = [];
        for (var i = 0; i < s.length; i++) { col.push(s.charCodeAt(i) - 65); }
        return col;
      });
      var free = [];
      for (var j = 0; j < parts[1].length; j++) {
        var v = parts[1].charCodeAt(j) - 65;
        free.push(v < 0 ? -1 : v);
      }
      var found = [];
      for (var k = 0; k < 4; k++) { found.push(parts[2].charCodeAt(k) - 65); }
      return { cols: cols, free: free, found: found };
    }

    /* L'ordre des colonnes et des cellules ne change rien à une position :
       la forme canonique évite d'explorer deux fois la même. */
    function canon(st) {
      var parts = st.cols.map(function (col) {
        var s = '';
        for (var i = 0; i < col.length; i++) { s += String.fromCharCode(65 + col[i]); }
        return s;
      });
      parts.sort();
      var f = st.free.filter(function (c) { return c >= 0; }).sort(function (a, b) { return a - b; });
      return parts.join('/') + '|' + f.join(',') + '|' + st.found.join(',');
    }

    function makeHeap() {
      var a = [];
      return {
        size: function () { return a.length; },
        push: function (item) {
          a.push(item);
          var i = a.length - 1;
          while (i > 0) {
            var p = (i - 1) >> 1;
            if (a[p].f <= a[i].f) { break; }
            var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
          }
        },
        pop: function () {
          var top = a[0], last = a.pop();
          if (a.length) {
            a[0] = last;
            var i = 0;
            for (;;) {
              var l = i * 2 + 1, r = l + 1, m = i;
              if (l < a.length && a[l].f < a[m].f) { m = l; }
              if (r < a.length && a[r].f < a[m].f) { m = r; }
              if (m === i) { break; }
              var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
            }
          }
          return top;
        }
      };
    }

    function autoplay(st, log) {
      var again = true;
      while (again) {
        again = false;
        for (var i = 0; i < st.free.length; i++) {
          if (st.free[i] >= 0 && safeHome(st.found, st.free[i])) {
            log.push(['xf', i, suitOf(st.free[i])]);
            st.found[suitOf(st.free[i])]++; st.free[i] = -1; again = true;
          }
        }
        for (var j = 0; j < st.cols.length; j++) {
          var col = st.cols[j];
          if (col.length && safeHome(st.found, col[col.length - 1])) {
            log.push(['cf', j, suitOf(col[col.length - 1])]);
            st.found[suitOf(col.pop())]++; again = true;
          }
        }
      }
    }

    function won(st) {
      return st.found[0] === 13 && st.found[1] === 13 && st.found[2] === 13 && st.found[3] === 13;
    }

    function accepts(col, c) {
      if (!col.length) { return true; }
      var t = col[col.length - 1];
      return rankOf(t) === rankOf(c) + 1 && isRed(t) !== isRed(c);
    }

    /* Estimation du chemin restant : cartes encore en jeu, désordre des
       colonnes, cellules occupées ; une colonne vide est une bonne nouvelle. */
    function estimate(st) {
      var v = (52 - (st.found[0] + st.found[1] + st.found[2] + st.found[3])) * 2;
      for (var i = 0; i < st.cols.length; i++) {
        var col = st.cols[i];
        if (!col.length) { v -= 4; continue; }
        for (var j = 0; j < col.length; j++) {
          if (j > 0) {
            var b = col[j - 1], c = col[j];
            if (!(rankOf(b) === rankOf(c) + 1 && isRed(b) !== isRed(c))) { v += 1; }
          }
          if (st.found[suitOf(col[j])] === rankOf(col[j])) { v += col.length - 1 - j; }
        }
      }
      for (var k = 0; k < st.free.length; k++) { if (st.free[k] >= 0) { v += 2; } }
      return v;
    }

    function successors(st) {
      var out = [];
      var emptyCol = -1, freeSlot = -1;
      for (var e = 0; e < st.cols.length; e++) { if (!st.cols[e].length) { emptyCol = e; break; } }
      for (var f = 0; f < st.free.length; f++) { if (st.free[f] < 0) { freeSlot = f; break; } }

      for (var i = 0; i < st.cols.length; i++) {
        var col = st.cols[i];
        if (!col.length) { continue; }
        var c = col[col.length - 1];
        if (st.found[suitOf(c)] === rankOf(c)) { out.push(['cf', i, suitOf(c)]); }
        for (var j = 0; j < st.cols.length; j++) {
          if (j === i) { continue; }
          if (!st.cols[j].length) {
            // Vider une colonne pour en remplir une autre ne mène nulle part,
            // et une seule colonne vide mérite d'être essayée.
            if (col.length === 1 || j !== emptyCol) { continue; }
            out.push(['cc', i, j]);
          } else if (accepts(st.cols[j], c)) {
            out.push(['cc', i, j]);
          }
        }
        if (freeSlot >= 0) { out.push(['cx', i, freeSlot]); }
      }
      for (var k = 0; k < st.free.length; k++) {
        var fc = st.free[k];
        if (fc < 0) { continue; }
        if (st.found[suitOf(fc)] === rankOf(fc)) { out.push(['xf', k, suitOf(fc)]); }
        for (var l = 0; l < st.cols.length; l++) {
          if (!st.cols[l].length) {
            if (l !== emptyCol) { continue; }
            out.push(['xc', k, l]);
          } else if (accepts(st.cols[l], fc)) {
            out.push(['xc', k, l]);
          }
        }
      }
      return out;
    }

    function apply(st, m) {
      if (m[0] === 'cf') { st.found[suitOf(st.cols[m[1]].pop())]++; return; }
      if (m[0] === 'xf') { st.found[suitOf(st.free[m[1]])]++; st.free[m[1]] = -1; return; }
      if (m[0] === 'cx') { st.free[m[2]] = st.cols[m[1]].pop(); return; }
      if (m[0] === 'cc') { st.cols[m[2]].push(st.cols[m[1]].pop()); return; }
      st.cols[m[2]].push(st.free[m[1]]); st.free[m[1]] = -1;
    }

    function copy(st) {
      return {
        cols: st.cols.map(function (c) { return c.slice(); }),
        free: st.free.slice(),
        found: st.found.slice()
      };
    }

    /* Renvoie { solved, moves, nodes } — `moves` est la suite complète de coups
       abrégés, montées automatiques comprises, rejouable telle quelle. */
    function solve(start, budget) {
      var st = copy(start);
      var pre = [];
      autoplay(st, pre);
      if (won(st)) { return { solved: true, moves: pre, nodes: 0 }; }

      var nodes = [{ s: enc(st), p: -1, m: pre }];
      var open = makeHeap();
      open.push({ f: estimate(st), g: 0, i: 0 });
      var seen = {};
      seen[canon(st)] = true;
      var expanded = 0;
      var cap = budget || SOLVE_BUDGET;

      while (open.size()) {
        if (expanded >= cap) { return { solved: false, truncated: true, nodes: expanded }; }
        var node = open.pop();
        expanded++;
        var cur = dec(nodes[node.i].s);
        var list = successors(cur);
        for (var i = 0; i < list.length; i++) {
          var next = copy(cur);
          var log = [list[i]];
          apply(next, list[i]);
          autoplay(next, log);
          var ck = canon(next);
          if (seen[ck]) { continue; }
          seen[ck] = true;
          var idx = nodes.length;
          nodes.push({ s: enc(next), p: node.i, m: log });
          if (won(next)) {
            var path = [], at = idx;
            while (at >= 0) { path.unshift(nodes[at].m); at = nodes[at].p; }
            return { solved: true, moves: [].concat.apply([], path), nodes: expanded };
          }
          // Meilleur d'abord, avec juste assez de poids sur la longueur du
          // chemin pour que la recherche ne tourne pas en rond.
          open.push({ f: estimate(next) + (node.g + 1) * 0.2, g: node.g + 1, i: idx });
        }
      }
      return { solved: false, truncated: false, nodes: expanded };
    }

    return { solve: solve, safeHome: safeHome, accepts: accepts };
  }());

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var cols, free, found, seed, history;
  var score, moves, undos, hints, dealCards, dealStartedAt, dealMoves, maxCellsUsed;
  var particles, held, hint;
  var run, runStartedAt, runCommitted, overSince = 0, wonAt = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function cellCount() { return conf().cells || 4; }
  function best() { return progress.bestFor(difficulty); }
  function board() { return { cols: cols, free: free, found: found }; }

  function newDeal() {
    var cellsWanted = cellCount();
    var chosen = null;
    for (var attempt = 0; attempt < DEAL_TRIES; attempt++) {
      var candidate = Math.floor(Math.random() * 999999) + 1;
      var laid = dealFrom(candidate);
      var result = Solver.solve({ cols: laid, free: emptyCells(cellsWanted), found: [0, 0, 0, 0] }, SOLVE_BUDGET);
      if (result.solved) { chosen = { seed: candidate, cols: laid }; break; }
      if (!chosen) { chosen = { seed: candidate, cols: laid }; }
    }
    setDeal(chosen.seed, chosen.cols);
  }

  function emptyCells(n) {
    var out = [];
    for (var i = 0; i < n; i++) { out.push(-1); }
    return out;
  }

  function setDeal(n, laid) {
    seed = n;
    cols = (laid || dealFrom(n)).map(function (c) { return c.slice(); });
    free = emptyCells(cellCount());
    found = [0, 0, 0, 0];
    history = [];
    dealCards = 0;
    dealMoves = 0;
    maxCellsUsed = 0;
    // Annulations et indices se comptent par donne : ce sont eux qui décident
    // si la réussite est « sans repentir » ou « en autonomie ».
    undos = 0;
    hints = 0;
    dealStartedAt = performance.now();
    held = null;
    hint = null;
    wonAt = 0;
    settle(false);
    renderHud();
  }

  function resetRun() {
    score = 0;
    moves = 0;
    undos = 0;
    hints = 0;
    particles = [];
    run = progress.newRun(difficulty);
    run.cleanWin = false;
    run.soloWin = false;
    run.quickWin = false;
    run.tidyWin = false;
    run.oneCellWin = false;
    runStartedAt = performance.now();
    runCommitted = false;
    dealStartedAt = performance.now();
    newDeal();
  }

  /* ------------------------------------------------------------------ */
  /* Règles                                                              */
  /* ------------------------------------------------------------------ */

  function accepts(col, c) { return Solver.accepts(col, c); }

  function isRun(cards) {
    for (var i = 1; i < cards.length; i++) {
      var a = cards[i - 1], b = cards[i];
      if (rankOf(a) !== rankOf(b) + 1 || isRed(a) === isRed(b)) { return false; }
    }
    return true;
  }

  /* Déplacer plusieurs cartes n'est qu'un raccourci : le nombre transportable
     est celui que les cellules et les colonnes vides permettraient à la main. */
  function maxMove(toEmptyColumn) {
    var slots = free.filter(function (c) { return c < 0; }).length;
    var empties = cols.filter(function (c) { return !c.length; }).length;
    if (toEmptyColumn && empties > 0) { empties--; }
    return (slots + 1) * Math.pow(2, empties);
  }

  function cellsUsed() { return free.filter(function (c) { return c >= 0; }).length; }

  function snapshot() {
    return {
      cols: cols.map(function (c) { return c.slice(); }),
      free: free.slice(),
      found: found.slice(),
      score: score,
      dealCards: dealCards
    };
  }

  function restore(snap) {
    cols = snap.cols.map(function (c) { return c.slice(); });
    free = snap.free.slice();
    found = snap.found.slice();
    score = snap.score;
    // Une carte redescendue de sa fondation n'y est plus montée : le total de
    // la partie doit l'oublier aussi, sinon les statistiques enflent.
    if (run) { run.cards -= dealCards - snap.dealCards; }
    dealCards = snap.dealCards;
  }

  function toFoundation(card) {
    found[suitOf(card)]++;
    score += CARD_POINTS;
    dealCards++;
    run.cards++;
  }

  /* Monte d'office ce qui ne peut plus servir à personne. */
  function settle(force) {
    if (!force && !progress.getSetting('auto')) { return 0; }
    var moved = 0, again = true;
    while (again) {
      again = false;
      for (var i = 0; i < free.length; i++) {
        if (free[i] >= 0 && Solver.safeHome(found, free[i])) {
          homeBurst(suitOf(free[i]));
          toFoundation(free[i]); free[i] = -1; again = true; moved++;
        }
      }
      for (var j = 0; j < cols.length; j++) {
        var col = cols[j];
        if (col.length && Solver.safeHome(found, col[col.length - 1])) {
          homeBurst(suitOf(col[col.length - 1]));
          toFoundation(col.pop()); again = true; moved++;
        }
      }
    }
    return moved;
  }

  function complete() {
    return found[0] === 13 && found[1] === 13 && found[2] === 13 && found[3] === 13;
  }

  /* Un coup légal existe-t-il encore ? Sinon la donne est terminée. */
  function anyMove() {
    var slot = free.some(function (c) { return c < 0; });
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      if (!col.length) { return true; }
      var c = col[col.length - 1];
      if (found[suitOf(c)] === rankOf(c)) { return true; }
      if (slot) { return true; }
      for (var j = 0; j < cols.length; j++) {
        if (j !== i && cols[j].length && accepts(cols[j], c)) { return true; }
      }
    }
    for (var k = 0; k < free.length; k++) {
      if (free[k] < 0) { continue; }
      if (found[suitOf(free[k])] === rankOf(free[k])) { return true; }
      for (var l = 0; l < cols.length; l++) {
        if (!cols[l].length || accepts(cols[l], free[k])) { return true; }
      }
    }
    return false;
  }

  /* `src` : { t:'col'|'free', i, n }   `dst` : { t:'col'|'free'|'found', i } */
  function legal(src, dst) {
    var cards = cardsOf(src);
    if (!cards.length) { return false; }
    if (dst.t === 'found') {
      if (cards.length !== 1) { return false; }
      return suitOf(cards[0]) === dst.i && found[dst.i] === rankOf(cards[0]);
    }
    if (dst.t === 'free') {
      return cards.length === 1 && free[dst.i] < 0 && !(src.t === 'free' && src.i === dst.i);
    }
    if (src.t === 'col' && src.i === dst.i) { return false; }
    if (!isRun(cards)) { return false; }
    var target = cols[dst.i];
    if (!accepts(target, cards[0])) { return false; }
    return cards.length <= maxMove(!target.length);
  }

  function cardsOf(src) {
    if (src.t === 'free') { return free[src.i] >= 0 ? [free[src.i]] : []; }
    var col = cols[src.i];
    var n = src.n || 1;
    if (n > col.length) { return []; }
    return col.slice(col.length - n);
  }

  function play(src, dst) {
    if (state !== 'playing' || wonAt) { return false; }
    if (!legal(src, dst)) { return false; }
    history.push(snapshot());
    var cards = cardsOf(src);

    if (src.t === 'free') { free[src.i] = -1; }
    else { cols[src.i].length -= cards.length; }

    if (dst.t === 'found') { homeBurst(dst.i); toFoundation(cards[0]); audio.bonus(); }
    else if (dst.t === 'free') { free[dst.i] = cards[0]; audio.blip(300, 0.04, 'square', 0.03); }
    else {
      cols[dst.i] = cols[dst.i].concat(cards);
      if (cards.length > 1) { audio.chain(cards.length); } else { audio.pickup(); }
    }

    moves++;
    dealMoves++;
    run.moves++;
    maxCellsUsed = Math.max(maxCellsUsed, cellsUsed());
    settle(false);
    maxCellsUsed = Math.max(maxCellsUsed, cellsUsed());
    hint = null;

    if (complete()) { winDeal(); }
    else if (!anyMove()) { stuck(); }
    renderHud();
    return true;
  }

  /* La tape : la carte part d'elle-même là où elle a le plus de sens. */
  function autoPlace(src) {
    var cards = cardsOf(src);
    if (!cards.length) { return false; }

    if (cards.length === 1) {
      var c = cards[0];
      if (play(src, { t: 'found', i: suitOf(c) })) { return true; }
    }
    // Une colonne qui prolonge une suite vaut mieux qu'une colonne vide.
    var best = -1;
    for (var i = 0; i < cols.length; i++) {
      if (!cols[i].length) { continue; }
      if (legal(src, { t: 'col', i: i })) { best = i; break; }
    }
    if (best < 0) {
      for (var j = 0; j < cols.length; j++) {
        if (cols[j].length) { continue; }
        if (legal(src, { t: 'col', i: j })) { best = j; break; }
      }
    }
    if (best >= 0) { return play(src, { t: 'col', i: best }); }

    if (cards.length === 1 && src.t === 'col') {
      for (var k = 0; k < free.length; k++) {
        if (legal(src, { t: 'free', i: k })) { return play(src, { t: 'free', i: k }); }
      }
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
    hint = null;
    audio.blip(160, 0.06, 'triangle', 0.04);
    renderHud();
    return true;
  }

  function redeal() {
    if (state !== 'playing') { return; }
    setDeal(seed, dealFrom(seed));
    undos++;                     // redonner, c'est renoncer : le succès tombe
    audio.blip(140, 0.08, 'triangle', 0.04);
  }

  function askHint() {
    if (state !== 'playing' || wonAt) { return null; }
    var result = Solver.solve(board(), SOLVE_BUDGET);
    hints++;
    run.hints++;
    score = Math.max(0, score - HINT_COST);
    renderHud();
    if (!result.solved) {
      hint = null;
      floatText(result.truncated ? 'Aucune suite trouvée' : 'Cette position est perdue', '#ff5d8f');
      audio.fail();
      return null;
    }
    if (!result.moves.length) { return null; }
    hint = { move: result.moves[0], until: performance.now() + 2600 };
    floatText('Indice −' + HINT_COST, '#ffd166');
    audio.blip(700, 0.1, 'triangle', 0.05);
    return hint.move;
  }

  /* ------------------------------------------------------------------ */
  /* Fin de donne et de partie                                           */
  /* ------------------------------------------------------------------ */

  function winDeal() {
    wonAt = performance.now();
    var seconds = (wonAt - dealStartedAt) / 1000;
    var speed = Math.max(0, Math.round(SPEED_MAX - seconds));
    var bonus = Math.round((WIN_BONUS + speed) * (conf().bonus || 1));
    score += bonus;
    run.wins++;
    run.streak++;
    if (undos === 0) { run.cleanWin = true; }
    if (hints === 0) { run.soloWin = true; }
    if (seconds < 180) { run.quickWin = true; }
    if (dealMoves < 100) { run.tidyWin = true; }
    if (maxCellsUsed <= 1) { run.oneCellWin = true; }
    run.score = score;

    floatText('Réussite ! +' + bonus, manifest.color);
    audio.unlocked();
    checkUnlocks();
    renderHud();

    // Un temps d'arrêt sur le tapis rangé, puis la donne suivante.
    setTimeout(function () {
      if (state !== 'playing') { return; }
      newDeal();
    }, 1400);
  }

  function stuck() {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    audio.fail();
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Plus aucun coup',
      subtitle: 'Aucune carte ne peut plus bouger sur cette donne.',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Donnes réussies',
        extra: run.wins,
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
  /* Géométrie du tapis                                                  */
  /* ------------------------------------------------------------------ */

  function geometry() {
    var size = loop.size();
    var pad = size * 0.014;
    var colW = (size - pad * 2) / 8;
    var gap = colW * 0.10;
    var cardW = colW - gap;
    var cardH = cardW * 1.42;
    var topY = pad;
    var barY = topY + cardH + size * 0.018;
    var barH = Math.max(size * 0.052, 26);
    var tableY = barY + barH + size * 0.020;
    var availH = size - tableY - pad;
    var longest = 1;
    for (var i = 0; i < cols.length; i++) { longest = Math.max(longest, cols[i].length); }
    // L'écart entre deux cartes s'ouvre tant que la colonne la plus haute
    // tient dans la hauteur disponible : le tapis respire en début de donne.
    var step = Math.min(cardH * 0.52, (availH - cardH) / Math.max(1, longest - 1));
    step = Math.max(step, Math.max(8, cardH * 0.13));
    return { size: size, pad: pad, colW: colW, gap: gap, cardW: cardW, cardH: cardH,
             topY: topY, barY: barY, barH: barH, tableY: tableY, step: step };
  }

  function slotX(g, index) { return g.pad + index * g.colW + g.gap / 2; }

  function buttons(g) {
    var w = Math.max(g.size * 0.17, 74);
    var h = g.barH;
    var gapB = g.size * 0.012;
    return [
      { id: 'undo', label: '↺ Annuler', x: g.size - g.pad - w * 2 - gapB, y: g.barY, w: w, h: h },
      { id: 'hint', label: '✦ Indice', x: g.size - g.pad - w, y: g.barY, w: w, h: h }
    ];
  }

  /* Où le doigt vient-il de se poser ? */
  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;

    if (py >= g.barY && py <= g.barY + g.barH) {
      var list = buttons(g);
      for (var b = 0; b < list.length; b++) {
        var btn = list[b];
        if (px >= btn.x && px <= btn.x + btn.w) { return { t: 'button', id: btn.id }; }
      }
      return null;
    }

    if (py >= g.topY && py <= g.topY + g.cardH) {
      var slot = Math.floor((px - g.pad) / g.colW);
      if (slot < 0 || slot > 7) { return null; }
      if (slot < cellCount()) { return { t: 'free', i: slot }; }
      if (slot >= 4) { return { t: 'found', i: slot - 4 }; }
      return null;
    }

    if (py >= g.tableY - g.size * 0.01) {
      var c = clamp(Math.floor((px - g.pad) / g.colW), 0, 7);
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

    if (spot.t === 'button') {
      if (spot.id === 'undo') { undo(); } else { askHint(); }
      return false;
    }
    if (spot.t === 'found') { return false; }

    if (spot.t === 'free') {
      if (free[spot.i] < 0) { return false; }
      held = {
        src: { t: 'free', i: spot.i },
        cards: [free[spot.i]],
        x: pos.x * g.size, y: pos.y * g.size,
        offX: pos.x * g.size - slotX(g, spot.i),
        offY: pos.y * g.size - g.topY,
        startX: pos.x * g.size, startY: pos.y * g.size,
        moved: false
      };
      audio.unlock();
      return true;
    }

    if (spot.card < 0) { return false; }
    var col = cols[spot.i];
    var cards = col.slice(spot.card);
    if (cards.length > 1 && !isRun(cards)) { return false; }
    held = {
      src: { t: 'col', i: spot.i, n: cards.length },
      cards: cards,
      x: pos.x * g.size, y: pos.y * g.size,
      offX: pos.x * g.size - slotX(g, spot.i),
      offY: pos.y * g.size - (g.tableY + spot.card * g.step),
      startX: pos.x * g.size, startY: pos.y * g.size,
      moved: false
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
    if (!pos) { return; }                       // geste interrompu : rien ne bouge

    if (!current.moved) { autoPlace(current.src); return; }

    var spot = locate(pos);
    if (!spot || spot.t === 'button') { snapBack(); return; }
    var dst = spot.t === 'col' ? { t: 'col', i: spot.i } : { t: spot.t, i: spot.i };
    if (!play(current.src, dst)) { snapBack(); }
  }

  function snapBack() { audio.blip(120, 0.07, 'square', 0.03); }

  /* Les emplacements qui accepteraient la carte tenue, pour les éclairer. */
  function dropZones() {
    if (!held || !progress.getSetting('guide')) { return null; }
    var zones = { cols: [], free: [], found: [] };
    for (var i = 0; i < cols.length; i++) {
      if (legal(held.src, { t: 'col', i: i })) { zones.cols.push(i); }
    }
    for (var j = 0; j < free.length; j++) {
      if (legal(held.src, { t: 'free', i: j })) { zones.free.push(j); }
    }
    for (var k = 0; k < 4; k++) {
      if (legal(held.src, { t: 'found', i: k })) { zones.found.push(k); }
    }
    return zones;
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function homeBurst(suit) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    var x = slotX(g, 4 + suit) + g.cardW / 2;
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
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function inkOf(card) {
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((rankOf(card) * 27 + suitOf(card) * 90) % 360) + ', 85%, 68%)'; }
    return isRed(card) ? ramp().red : ramp().black;
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

  function drawSlot(g, x, y, glyph, lit) {
    Cards.slot(ctx, x, y, g.cardW, g.cardH,
      { ramp: ramp(), glyph: glyph, lit: lit ? ramp().home : null });
  }

  /* Le dessin des cartes vient du socle : les trois réussites de la
     plateforme montrent ainsi exactement les mêmes cartes. `band` est la
     hauteur réellement visible — sous une carte couverte, seul l'index compte. */
  function drawCard(g, x, y, card, band, lit) {
    var skin = progress.currentSkin();
    Cards.draw(ctx, x, y, g.cardW, g.cardH, card, {
      ramp: ramp(), band: band, lit: lit,
      ink: skin.rainbow ? inkOf(card) : null
    });
  }

  function hintSpots() {
    if (!hint || performance.now() > hint.until) { return null; }
    var m = hint.move;
    var from = null, to = null;
    if (m[0] === 'cf') { from = { t: 'col', i: m[1] }; to = { t: 'found', i: m[2] }; }
    else if (m[0] === 'xf') { from = { t: 'free', i: m[1] }; to = { t: 'found', i: m[2] }; }
    else if (m[0] === 'cx') { from = { t: 'col', i: m[1] }; to = { t: 'free', i: m[2] }; }
    else if (m[0] === 'cc') { from = { t: 'col', i: m[1] }; to = { t: 'col', i: m[2] }; }
    else { from = { t: 'free', i: m[1] }; to = { t: 'col', i: m[2] }; }
    return { from: from, to: to };
  }

  function matches(spot, t, i) { return spot && spot.t === t && spot.i === i; }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!cols) { return; }

    var zones = dropZones();
    var marks = hintSpots();
    var pulse = 0.55 + 0.45 * Math.sin(now / 190);

    // Cellules libres.
    for (var i = 0; i < free.length; i++) {
      var x = slotX(g, i);
      var lit = zones && zones.free.indexOf(i) >= 0;
      var marked = marks && (matches(marks.from, 'free', i) || matches(marks.to, 'free', i));
      if (free[i] < 0 || (held && held.src.t === 'free' && held.src.i === i)) {
        drawSlot(g, x, g.topY, null, lit || marked);
      } else {
        drawCard(g, x, g.topY, free[i], g.cardH,
          marked ? withAlpha(ramp().pick, pulse) : (lit ? ramp().home : null));
      }
    }

    // Fondations, une par enseigne.
    for (var s = 0; s < 4; s++) {
      var fx = slotX(g, 4 + s);
      var flit = zones && zones.found.indexOf(s) >= 0;
      var fmark = marks && matches(marks.to, 'found', s);
      if (!found[s]) { drawSlot(g, fx, g.topY, SUITS[s], flit || fmark); }
      else {
        drawCard(g, fx, g.topY, (found[s] - 1) * 4 + s, g.cardH,
          fmark ? withAlpha(ramp().pick, pulse) : (flit ? ramp().home : null));
      }
    }

    drawBar(g);

    // Colonnes.
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var hidden = (held && held.src.t === 'col' && held.src.i === c) ? held.src.n : 0;
      var shown = col.length - hidden;
      var cx = slotX(g, c);
      var clit = zones && zones.cols.indexOf(c) >= 0;
      var cmark = marks && (matches(marks.to, 'col', c) || matches(marks.from, 'col', c));
      if (!shown) {
        drawSlot(g, cx, g.tableY, null, clit || cmark);
        continue;
      }
      for (var k = 0; k < shown; k++) {
        var cy = g.tableY + k * g.step;
        var band = (k === shown - 1) ? g.cardH : g.step;
        var last = k === shown - 1;
        var glow = null;
        if (last && cmark) { glow = withAlpha(ramp().pick, pulse); }
        else if (last && clit) { glow = ramp().home; }
        drawCard(g, cx, cy, col[k], band, glow);
      }
    }

    // Cartes tenues : dessinées en dernier, elles passent au-dessus.
    if (held) {
      var hx = clamp(held.x - held.offX, -g.cardW * 0.4, g.size - g.cardW * 0.6);
      var hy = clamp(held.y - held.offY, -g.cardH * 0.4, g.size - g.cardH * 0.4);
      for (var h = 0; h < held.cards.length; h++) {
        drawCard(g, hx, hy + h * g.step, held.cards[h],
          h === held.cards.length - 1 ? g.cardH : g.step, ramp().pick);
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

  function withAlpha(color, a) {
    // Les palettes sont en #rrggbb : on y ajoute une transparence.
    if (color.charAt(0) !== '#' || color.length !== 7) { return color; }
    var v = Math.round(clamp(a, 0, 1) * 255).toString(16);
    return color + (v.length < 2 ? '0' + v : v);
  }

  function drawBar(g) {
    ctx.save();
    ctx.font = '600 ' + Math.max(10, Math.round(g.barH * 0.42)) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    var room = buttons(g)[0].x - g.pad - 10;
    var wording = ['Donne n° ' + seed + ' · ' + dealMoves + ' coups',
                   'n° ' + seed + ' · ' + dealMoves + ' coups',
                   'n° ' + seed, String(dealMoves) + ' coups'];
    var label = wording[wording.length - 1];
    for (var w = 0; w < wording.length; w++) {
      if (ctx.measureText(wording[w]).width <= room) { label = wording[w]; break; }
    }
    ctx.fillText(label, g.pad + 2, g.barY + g.barH / 2);

    buttons(g).forEach(function (btn) {
      var on = btn.id === 'undo' ? history.length > 0 : true;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.fillStyle = 'rgba(120, 150, 200, 0.14)';
      roundRect(btn.x, btn.y, btn.w, btn.h, btn.h * 0.34);
      ctx.fill();
      ctx.strokeStyle = ramp().edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e8eefc';
      ctx.font = '600 ' + Math.max(10, Math.round(btn.h * 0.38)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: run ? run.streak : 0,
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
      panel.show({ title: 'Pause', subtitle: 'Le tapis t\'attend.', cta: 'Reprendre',
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
    onAction: function () { if (!guardedStart() && state === 'paused') { togglePause(); } },
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    keys: { u: undo, i: askHint, r: redeal }
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

  window.__neonCells = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        cells: cellCount(),
        seed: seed,
        cols: cols.map(function (c) { return c.slice(); }),
        free: free.slice(),
        found: found.slice(),
        score: score,
        moves: moves,
        dealMoves: dealMoves,
        undos: undos,
        hints: hints,
        streak: run ? run.streak : 0,
        wins: run ? run.wins : 0,
        cards: run ? run.cards : 0,
        complete: complete(),
        anyMove: anyMove(),
        maxMove: maxMove(false),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Sert une donne connue, sans passer par la preuve de solubilité.
    dealSeed: function (n) { setDeal(n >>> 0, dealFrom(n >>> 0)); },
    setBoard: function (b) {
      cols = b.cols.map(function (c) { return c.slice(); });
      free = b.free.slice();
      found = b.found.slice();
      history = [];
      held = null;
      if (b.settle) { settle(true); }
      renderHud();
    },
    solve: function (budget) { return Solver.solve(board(), budget || SOLVE_BUDGET); },
    solveDeal: function (n, cellsWanted, budget) {
      return Solver.solve({ cols: dealFrom(n >>> 0), free: emptyCells(cellsWanted || cellCount()),
                            found: [0, 0, 0, 0] }, budget || SOLVE_BUDGET);
    },
    play: function (src, dst) { return play(src, dst); },
    autoPlace: function (src) { return autoPlace(src); },
    undo: undo,
    redeal: redeal,
    hint: askHint,
    // Rejoue une solution complète : les coups abrégés du solveur, un par un.
    playSolution: function (budget) {
      var result = Solver.solve(board(), budget || SOLVE_BUDGET);
      if (!result.solved) { return { solved: false, played: 0 }; }
      var played = 0;
      for (var i = 0; i < result.moves.length; i++) {
        var m = result.moves[i];
        var src, dst;
        if (m[0] === 'cf') { src = { t: 'col', i: m[1], n: 1 }; dst = { t: 'found', i: m[2] }; }
        else if (m[0] === 'xf') { src = { t: 'free', i: m[1] }; dst = { t: 'found', i: m[2] }; }
        else if (m[0] === 'cx') { src = { t: 'col', i: m[1], n: 1 }; dst = { t: 'free', i: m[2] }; }
        else if (m[0] === 'cc') { src = { t: 'col', i: m[1], n: 1 }; dst = { t: 'col', i: m[2] }; }
        else { src = { t: 'free', i: m[1] }; dst = { t: 'col', i: m[2] }; }
        // La montée automatique du socle peut avoir déjà joué ce coup.
        if (!legal(src, dst)) { continue; }
        if (!play(src, dst)) { return { solved: false, played: played, stuckAt: i }; }
        played++;
        if (complete()) { break; }
      }
      return { solved: complete(), played: played };
    },
    geometry: function () { return geometry(); },
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
