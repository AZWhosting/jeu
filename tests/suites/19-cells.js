'use strict';

var harness = require('../lib/harness');

/* Neon Cells : les règles de la réussite, le glisser-déposer réel à la souris,
   et surtout la promesse du jeu — aucune donne n'arrive sur le tapis sans
   avoir été résolue d'abord. On la vérifie en resolvant nous-mêmes, depuis la
   position servie, chaque donne que le jeu propose. */

// carte = rang * 4 + enseigne ; enseignes 0 ♠, 1 ♥, 2 ♦, 3 ♣ ; rang 0 = as.
var C = {
  A_PIQUE: 0, DEUX_PIQUE: 4,
  DIX_PIQUE: 36, DIX_COEUR: 37, DIX_CARREAU: 38, DIX_TREFLE: 39,
  VALET_PIQUE: 40,
  DAME_PIQUE: 44, DAME_COEUR: 45, DAME_CARREAU: 46, DAME_TREFLE: 47,
  ROI_PIQUE: 48, ROI_COEUR: 49, ROI_CARREAU: 50, ROI_TREFLE: 51
};

/* Position sans issue : que des dames et des dix, qui n'ont ni roi ni valet où
   se poser, trois rois immobilisés en cellule, et pas une colonne vide. */
function impasse() {
  return {
    cols: [[C.DIX_PIQUE, C.DAME_PIQUE], [C.DAME_COEUR], [C.DAME_CARREAU], [C.DAME_TREFLE],
           [C.DIX_COEUR], [C.DIX_CARREAU], [C.DIX_TREFLE], [C.DEUX_PIQUE]],
    free: [-1, C.ROI_TREFLE, C.ROI_CARREAU, C.ROI_COEUR],
    found: [0, 0, 0, 0]
  };
}

module.exports = {
  name: 'Neon Cells — règles, glisser-déposer et donnes prouvées solubles',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonCells.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonCells[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var setBoard = function (b) { return api('setBoard', b); };

    /* Un vrai geste à la souris, en coordonnées de plateau. */
    async function point(px, py) {
      var box = await page.evaluate(function () {
        var r = document.getElementById('board').getBoundingClientRect();
        return { x: r.left, y: r.top };
      });
      return { x: box.x + px, y: box.y + py };
    }
    async function columnPoint(index, depth) {
      var g = await api('geometry');
      var x = g.pad + index * g.colW + g.gap / 2 + g.cardW / 2;
      var y = g.tableY + (depth || 0) * g.step + g.cardH * 0.25;
      return point(x, y);
    }

    /* ---------------------------------------------------------------- */
    t.section('Mise en place');
    await page.goto(h.url('cells'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Cells/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(300);

    var s = await snap();
    var total = s.cols.reduce(function (a, c) { return a + c.length; }, 0) +
                s.free.filter(function (c) { return c >= 0; }).length +
                s.found.reduce(function (a, b) { return a + b; }, 0);
    check('la partie démarre', s.state === 'playing', s.state);
    check('les 52 cartes sont sur le tapis', total === 52, total);
    var seen = {};
    var doubles = 0;
    s.cols.forEach(function (col) { col.forEach(function (c) { if (seen[c]) { doubles++; } seen[c] = true; }); });
    check('aucune carte en double', doubles === 0, doubles + ' doublon(s)');
    check('quatre cellules libres en facile', s.cells === 4, s.cells);

    // Sans montée automatique, la donne est intacte : on peut en lire la coupe.
    await page.evaluate(function () { window.Progress.setSetting('auto', false); });
    await api('dealSeed', 4242);
    var a1 = await snap();
    check('colonnes de 7, 7, 7, 7, 6, 6, 6, 6',
          a1.cols.map(function (c) { return c.length; }).join(',') === '7,7,7,7,6,6,6,6',
          a1.cols.map(function (c) { return c.length; }).join(','));
    check('rien n\'est monté sans le réglage', a1.found.join(',') === '0,0,0,0', a1.found.join(','));
    await api('dealSeed', 4242);
    var a2 = await snap();
    check('un numéro de donne redonne la même donne',
          JSON.stringify(a1.cols) === JSON.stringify(a2.cols), 'donne ' + a1.seed);
    await page.evaluate(function () { window.Progress.setSetting('auto', true); });

    /* ---------------------------------------------------------------- */
    t.section('Les règles de la réussite');

    // Un valet noir sur une dame rouge : la couleur alterne, le rang descend.
    await setBoard({ cols: [[C.DAME_COEUR], [C.VALET_PIQUE], [C.DAME_PIQUE], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    check('valet noir accepté sur dame rouge',
          await api('play', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 0 }) === true);
    await setBoard({ cols: [[C.DAME_PIQUE], [C.VALET_PIQUE], [], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    check('valet noir refusé sur dame noire',
          await api('play', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 0 }) === false);

    await setBoard({ cols: [[C.A_PIQUE], [C.DAME_COEUR], [], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    check('la dame ne monte pas sur une fondation vide',
          await api('play', { t: 'col', i: 1, n: 1 }, { t: 'found', i: 1 }) === false);
    check('l\'as de pique ouvre la fondation pique',
          await api('play', { t: 'col', i: 0, n: 1 }, { t: 'found', i: 0 }) === true);
    check('la fondation pique est à l\'as', (await snap()).found[0] === 1);

    await setBoard({ cols: [[C.ROI_PIQUE], [C.ROI_COEUR], [], [], [], [], [], []],
                     free: [C.DAME_TREFLE, -1, -1, -1], found: [0, 0, 0, 0] });
    check('une cellule occupée n\'en reçoit pas une seconde',
          await api('play', { t: 'col', i: 0, n: 1 }, { t: 'free', i: 0 }) === false);
    check('une cellule libre accueille une carte',
          await api('play', { t: 'col', i: 0, n: 1 }, { t: 'free', i: 1 }) === true);

    t.section('Combien de cartes d\'un coup');
    // Rien de libre : une seule carte à la fois, donc la suite reste sur place.
    var packed = {
      cols: [[C.ROI_TREFLE], [C.DAME_COEUR, C.VALET_PIQUE], [C.DAME_CARREAU], [C.DAME_TREFLE],
             [C.DIX_COEUR], [C.DIX_CARREAU], [C.DIX_TREFLE], [C.DEUX_PIQUE]],
      free: [C.ROI_PIQUE, C.ROI_COEUR, C.ROI_CARREAU, C.DAME_PIQUE], found: [0, 0, 0, 0]
    };
    await setBoard(packed);
    var s0 = await snap();
    check('sans cellule ni colonne vide, une carte à la fois', s0.maxMove === 1, s0.maxMove);
    check('la suite de deux cartes est refusée',
          await api('play', { t: 'col', i: 1, n: 2 }, { t: 'col', i: 0 }) === false);

    packed.free = [-1, C.ROI_COEUR, C.ROI_CARREAU, C.DAME_PIQUE];
    await setBoard(packed);
    var s1 = await snap();
    check('une cellule libre permet deux cartes', s1.maxMove === 2, s1.maxMove);
    check('la suite de deux cartes passe',
          await api('play', { t: 'col', i: 1, n: 2 }, { t: 'col', i: 0 }) === true);
    var s2 = await snap();
    check('les deux cartes sont bien arrivées ensemble',
          s2.cols[0].length === 3 && s2.cols[1].length === 0,
          'colonne 0 : ' + s2.cols[0].length + ' cartes, colonne 1 : ' + s2.cols[1].length);

    /* ---------------------------------------------------------------- */
    t.section('Montée automatique et annulation');
    await page.evaluate(function () { window.Progress.setSetting('auto', false); });
    await setBoard({ cols: [[C.A_PIQUE], [C.DAME_COEUR], [C.ROI_TREFLE], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    await api('play', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 2 });
    check('réglage éteint : l\'as reste en place', (await snap()).found[0] === 0);

    await page.evaluate(function () { window.Progress.setSetting('auto', true); });
    await setBoard({ cols: [[C.A_PIQUE], [C.DAME_COEUR], [C.ROI_TREFLE], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    var before = await snap();
    await api('play', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 2 });
    var after = await snap();
    check('réglage allumé : l\'as monte tout seul', after.found[0] === 1, after.found.join(','));
    check('la carte montée rapporte des points', after.score > before.score,
          before.score + ' → ' + after.score);

    check('l\'annulation est acceptée', await api('undo') === true);
    var undone = await snap();
    check('le tapis revient à l\'état d\'avant',
          JSON.stringify(undone.cols) === JSON.stringify(before.cols) &&
          undone.found.join(',') === before.found.join(','),
          undone.found.join(','));
    check('le score revient avec lui', undone.score === before.score,
          before.score + ' → ' + undone.score);
    check('la carte redescendue n\'est plus comptée dans la partie',
          undone.cards === before.cards, before.cards + ' → ' + undone.cards);

    /* ---------------------------------------------------------------- */
    t.section('Glisser-déposer à la souris');
    await setBoard({ cols: [[C.DAME_COEUR], [C.VALET_PIQUE], [], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    var from = await columnPoint(1, 0);
    var to = await columnPoint(0, 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 24, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y + 18, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    var dragged = await snap();
    check('la carte glissée a changé de colonne',
          dragged.cols[0].length === 2 && dragged.cols[1].length === 0,
          'colonne 0 : ' + JSON.stringify(dragged.cols[0]));

    await setBoard({ cols: [[C.DAME_COEUR], [C.VALET_PIQUE], [], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    var refused = await columnPoint(4, 0);   // colonne vide : la dame y va, le valet aussi
    var badFrom = await columnPoint(0, 0);
    await page.mouse.move(badFrom.x, badFrom.y);
    await page.mouse.down();
    await page.mouse.move(badFrom.x, badFrom.y - 200, { steps: 6 });  // au-dessus du tapis
    await page.mouse.up();
    await page.waitForTimeout(120);
    check('un dépôt hors cible remet la carte à sa place',
          (await snap()).cols[0].length === 1);

    t.section('La tape envoie la carte d\'elle-même');
    await page.evaluate(function () { window.Progress.setSetting('auto', false); });
    await setBoard({ cols: [[C.A_PIQUE], [], [], [], [], [], [], []],
                     free: [-1, -1, -1, -1], found: [0, 0, 0, 0] });
    var tap = await columnPoint(0, 0);
    await page.mouse.click(tap.x, tap.y);
    await page.waitForTimeout(120);
    check('taper l\'as l\'envoie à sa fondation', (await snap()).found[0] === 1);
    await page.evaluate(function () { window.Progress.setSetting('auto', true); });

    /* ---------------------------------------------------------------- */
    t.section('Le solveur sait dire non');
    await setBoard(impasse());
    var lost = await snap();
    check('la position paraît encore jouable', lost.anyMove === true);
    var verdict = await api('solve');
    check('le solveur la déclare perdue', verdict.solved === false, JSON.stringify(verdict));
    check('et c\'est une preuve, pas un abandon', !verdict.truncated,
          verdict.truncated ? 'budget épuisé' : verdict.nodes + ' positions explorées');
    check('l\'indice ne ment pas', await api('hint') === null);

    await setBoard(impasse());
    check('le dernier coup possible passe',
          await api('play', { t: 'col', i: 0, n: 1 }, { t: 'free', i: 0 }) === true);
    var dead = await snap();
    check('plus aucun coup : la partie s\'arrête', dead.state === 'over', dead.state);
    check('le panneau de fin annonce l\'impasse',
          /Plus aucun coup|record/.test(await page.textContent('#title')),
          await page.textContent('#title'));

    /* ---------------------------------------------------------------- */
    t.section('L\'indice donne un coup jouable');
    await page.click('#playBtn');
    await page.waitForTimeout(400);
    var beforeHint = await snap();
    var move = await api('hint');
    var afterHint = await snap();
    check('un indice est proposé', Array.isArray(move), JSON.stringify(move));
    check('il coûte des points', afterHint.score <= beforeHint.score,
          beforeHint.score + ' → ' + afterHint.score);
    check('il est compté', afterHint.hints === beforeHint.hints + 1, afterHint.hints);

    /* ---------------------------------------------------------------- */
    t.section('Toute donne servie est soluble');
    var levels = [['easy', 4, 3], ['normal', 3, 3], ['hard', 2, 2]];
    for (var d = 0; d < levels.length; d++) {
      var id = levels[d][0], cells = levels[d][1], rounds = levels[d][2];
      await page.goto(h.url('cells'));
      await page.waitForTimeout(350);
      await page.click('.choice[data-diff="' + id + '"]');
      var solvedAll = true, worst = 0, sample = [];
      for (var k = 0; k < rounds; k++) {
        var t0 = Date.now();
        await page.click(k === 0 ? '#playBtn' : '#restartBtn');
        await page.waitForTimeout(120);
        var dealt = await snap();
        var proof = await api('solve');
        worst = Math.max(worst, Date.now() - t0);
        sample.push(dealt.seed);
        if (!proof.solved) { solvedAll = false; }
      }
      var conf = await snap();
      check(id + ' : ' + cells + ' cellules libres', conf.cells === cells, conf.cells);
      check(id + ' : les ' + rounds + ' donnes servies sont solubles', solvedAll,
            'donnes ' + sample.join(', ') + ' — au pire ' + worst + ' ms');
    }

    t.section('Le validateur ne dit pas oui à tout');
    // Sur des donnes tirées au hasard et non filtrées, le solveur doit en
    // résoudre l'immense majorité à quatre cellules — sans quoi il est cassé.
    var trial = await page.evaluate(function () {
      var ok = 0, tried = 8;
      for (var i = 0; i < tried; i++) {
        var seed = (Math.random() * 2147483647) >>> 0;
        if (window.__neonCells.solveDeal(seed, 4).solved) { ok++; }
      }
      return { ok: ok, tried: tried };
    });
    check('donnes brutes résolues à quatre cellules', trial.ok >= trial.tried - 2,
          trial.ok + '/' + trial.tried);

    /* ---------------------------------------------------------------- */
    t.section('Une donne menée jusqu\'au bout');
    await page.goto(h.url('cells'));
    await page.waitForTimeout(350);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var play = await api('playSolution');
    await page.waitForTimeout(200);
    var win = await snap();
    check('la solution rejouée range les 52 cartes', play.solved === true, JSON.stringify(play));
    check('les quatre fondations sont pleines', win.found.join(',') === '13,13,13,13', win.found.join(','));
    check('la réussite est comptée', win.wins >= 1 && win.streak >= 1,
          win.wins + ' réussite(s), série ' + win.streak);
    check('le score récompense la donne', win.score > 52 * 12, win.score);
    check('la première réussite débloque son succès',
          win.unlocked.indexOf('firstWin') !== -1, win.unlocked.join(', '));
    await page.screenshot({ path: h.shot('cells-reussite') });

    // La donne suivante arrive d'elle-même, et le tapis est de nouveau plein.
    await page.waitForTimeout(1600);
    var next = await snap();
    var back = next.cols.reduce(function (a, c) { return a + c.length; }, 0) +
               next.free.filter(function (c) { return c >= 0; }).length +
               next.found.reduce(function (a, b) { return a + b; }, 0);
    check('une nouvelle donne est servie', back === 52 && next.seed !== win.seed,
          'donne ' + next.seed + ', ' + back + ' cartes');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
