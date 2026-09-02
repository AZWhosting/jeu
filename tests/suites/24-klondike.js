'use strict';

var harness = require('../lib/harness');

/* Neon Klondike : les règles du solitaire, et l'invariant qui compte dans tout
   jeu de cartes — le paquet reste le paquet. Une carte dupliquée ou perdue est
   le défaut classique de ces jeux, et il ne se voit pas à l'œil : on le
   cherche donc après chaque coup, sur des centaines de coups joués au hasard. */

module.exports = {
  name: 'Neon Klondike — règles du solitaire et paquet intact',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonKlondike.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonKlondike[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };

    // rang = carte >> 2, enseigne = carte & 3 ; 0 ♠, 1 ♥, 2 ♦, 3 ♣
    var C = { A_PIQUE: 0, DEUX_COEUR: 1 * 4 + 1, TROIS_PIQUE: 2 * 4 + 0,
              DIX_COEUR: 9 * 4 + 1, VALET_PIQUE: 10 * 4 + 0, DAME_COEUR: 11 * 4 + 1,
              ROI_PIQUE: 12 * 4 + 0, ROI_COEUR: 12 * 4 + 1 };

    /* ---------------------------------------------------------------- */
    t.section('La donne');
    await page.goto(h.url('klondike'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Klondike/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);

    var s = await snap();
    check('sept colonnes de 1 à 7 cartes',
          s.piles.map(function (p) { return p.length; }).join(',') === '1,2,3,4,5,6,7',
          s.piles.map(function (p) { return p.length; }).join(','));
    check('une seule carte retournée par colonne',
          s.piles.every(function (p) { return p.filter(function (e) { return e.up; }).length === 1; }));
    check('et c\'est celle du dessus',
          s.piles.every(function (p) { return p[p.length - 1].up; }));
    check('vingt-quatre cartes dans la pioche', s.stock.length === 24, s.stock.length);
    check('vingt-et-une cartes cachées', s.hidden === 21, s.hidden);

    var toutes = await api('allCards');
    var distinctes = toutes.filter(function (c, i) { return toutes.indexOf(c) === i; });
    check('les 52 cartes sont là, une seule fois chacune',
          toutes.length === 52 && distinctes.length === 52,
          toutes.length + ' cartes, ' + distinctes.length + ' distinctes');

    /* ---------------------------------------------------------------- */
    t.section('Les règles');
    var poser = function (cols, found) {
      return page.evaluate(function (b) {
        window.__neonKlondike.setBoard({
          piles: b.cols.map(function (col) {
            return col.map(function (c) { return { c: c, up: true }; });
          }),
          stock: [], waste: [], found: b.found || [0, 0, 0, 0]
        });
      }, { cols: cols, found: found });
    };

    await poser([[C.DAME_COEUR], [C.VALET_PIQUE], [C.ROI_PIQUE], [], [], [], []]);
    check('valet noir accepté sur dame rouge',
          await api('legal', { t: 'pile', i: 1, n: 1 }, { t: 'pile', i: 0 }) === true);
    check('roi noir refusé sur dame rouge',
          await api('legal', { t: 'pile', i: 2, n: 1 }, { t: 'pile', i: 0 }) === false);

    await poser([[C.ROI_PIQUE], [C.DAME_COEUR], [], [], [], [], []]);
    check('seul un roi entre dans une colonne vide',
          await api('legal', { t: 'pile', i: 0, n: 1 }, { t: 'pile', i: 2 }) === true);
    check('une dame ne le peut pas',
          await api('legal', { t: 'pile', i: 1, n: 1 }, { t: 'pile', i: 2 }) === false);

    await poser([[C.A_PIQUE], [C.TROIS_PIQUE], [], [], [], [], []]);
    check('l\'as ouvre sa fondation',
          await api('play', { t: 'pile', i: 0, n: 1 }, { t: 'found', i: 0 }) === true);
    check('le trois n\'y saute pas par-dessus le deux',
          await api('legal', { t: 'pile', i: 1, n: 1 }, { t: 'found', i: 0 }) === false);
    var apres = await snap();
    check('la fondation pique est à l\'as', apres.found[0] === 1, apres.found.join(','));

    /* Une suite alternée se déplace d'un bloc ; une suite mêlée, non. La dame
       est rouge : il lui faut un roi noir, pas le roi de cœur. */
    await poser([[C.ROI_PIQUE], [C.DAME_COEUR, C.VALET_PIQUE, C.DIX_COEUR], [], [], [], [], []]);
    check('une suite alternée de trois cartes se déplace',
          await api('play', { t: 'pile', i: 1, n: 3 }, { t: 'pile', i: 0 }) === true);
    var bloc = await snap();
    check('les trois cartes sont arrivées ensemble',
          bloc.piles[0].length === 4 && bloc.piles[1].length === 0,
          bloc.piles[0].length + ' / ' + bloc.piles[1].length);

    await poser([[C.ROI_PIQUE], [C.DAME_COEUR, C.DIX_COEUR], [], [], [], [], []]);
    check('une suite qui saute un rang ne se déplace pas',
          await api('play', { t: 'pile', i: 1, n: 2 }, { t: 'pile', i: 0 }) === false);

    t.section('La carte cachée se retourne');
    await page.evaluate(function (cartes) {
      window.__neonKlondike.setBoard({
        piles: [[{ c: cartes.DEUX_COEUR, up: false }, { c: cartes.ROI_PIQUE, up: true }],
                [], [], [], [], [], []],
        stock: [], waste: [], found: [0, 0, 0, 0]
      });
    }, C);
    var avantFlip = await snap();
    check('la carte du dessous est bien cachée', avantFlip.piles[0][0].up === false);
    await api('play', { t: 'pile', i: 0, n: 1 }, { t: 'pile', i: 1 });
    var apresFlip = await snap();
    check('découverte, elle se retourne d\'elle-même', apresFlip.piles[0][0].up === true);
    check('et elle rapporte des points', apresFlip.score > avantFlip.score,
          avantFlip.score + ' → ' + apresFlip.score);

    /* ---------------------------------------------------------------- */
    t.section('La pioche');
    await page.goto(h.url('klondike'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    check('la pioche donne trois cartes en normal', (await snap()).pull === 3);
    await api('drawStock');
    check('trois cartes sur la défausse', (await snap()).waste.length === 3);

    /* La défausse retournée doit revenir dans le même ordre : c'est ce qui rend
       le jeu jouable — on peut compter sur ce qui reviendra. */
    var cycle = await page.evaluate(function () {
      var K = window.__neonKlondike;
      while (K.snapshot().stock.length) { K.drawStock(); }
      var avant = K.snapshot().waste.slice();
      K.drawStock();                       // retournement
      var pioche = K.snapshot().stock.slice();
      while (K.snapshot().stock.length) { K.drawStock(); }
      return { avant: avant, apres: K.snapshot().waste.slice(), taillePioche: pioche.length };
    });
    check('toute la pioche est passée sur la défausse', cycle.avant.length === 24, cycle.avant.length);
    check('le retournement rend exactement les mêmes cartes',
          cycle.taillePioche === 24 && cycle.apres.length === 24);
    check('et dans le même ordre qu\'au tour précédent',
          cycle.apres.join(',') === cycle.avant.join(','));

    t.section('La limite de retournements');
    await page.goto(h.url('klondike'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    check('deux retournements en difficile', (await snap()).redealLimit === 2);
    var limite = await page.evaluate(function () {
      var K = window.__neonKlondike;
      var tours = 0;
      for (var essai = 0; essai < 5; essai++) {
        while (K.snapshot().stock.length) { K.drawStock(); }
        if (!K.drawStock()) { break; }      // retournement refusé
        tours++;
      }
      return { tours: tours, redeals: K.snapshot().redeals };
    });
    check('le troisième retournement est refusé', limite.tours === 2,
          limite.tours + ' retournement(s)');

    /* ---------------------------------------------------------------- */
    t.section('Le paquet reste le paquet');
    /* Trois cents coups au hasard, en vérifiant après chacun que les 52 cartes
       sont toujours là, une seule fois chacune. C'est le défaut qui ne se voit
       pas : une carte dupliquée par un déplacement mal défait. */
    await page.goto(h.url('klondike'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var partie = await page.evaluate(function () {
      var K = window.__neonKlondike;

      function coups() {
        var s = K.snapshot(), out = [], i, k;
        var sources = [];
        if (s.waste.length) { sources.push({ t: 'waste' }); }
        for (i = 0; i < 4; i++) { if (s.found[i]) { sources.push({ t: 'found', i: i }); } }
        for (i = 0; i < s.piles.length; i++) {
          for (k = 0; k < s.piles[i].length; k++) {
            if (s.piles[i][k].up) { sources.push({ t: 'pile', i: i, n: s.piles[i].length - k }); }
          }
        }
        sources.forEach(function (src) {
          for (var j = 0; j < 4; j++) {
            if (K.legal(src, { t: 'found', i: j })) { out.push([src, { t: 'found', i: j }]); }
          }
          for (var p = 0; p < 7; p++) {
            if (K.legal(src, { t: 'pile', i: p })) { out.push([src, { t: 'pile', i: p }]); }
          }
        });
        return out;
      }

      var fautes = [];
      var joues = 0, pioches = 0, annules = 0;
      for (var pas = 0; pas < 300; pas++) {
        var possibles = coups();
        var r = Math.random();
        if (possibles.length && r < 0.65) {
          var m = possibles[Math.floor(Math.random() * possibles.length)];
          K.play(m[0], m[1]);
          joues++;
        } else if (r < 0.9) {
          K.drawStock();
          pioches++;
        } else {
          K.undo();
          annules++;
        }
        var toutes = K.allCards();
        var vues = {}, doubles = 0;
        toutes.forEach(function (c) { if (vues[c]) { doubles++; } vues[c] = 1; });
        if (toutes.length !== 52 || doubles) {
          fautes.push('pas ' + pas + ' : ' + toutes.length + ' cartes, ' + doubles + ' doublon(s)');
          if (fautes.length > 3) { break; }
        }
      }
      var fin = K.snapshot();
      return { fautes: fautes, joues: joues, pioches: pioches, annules: annules,
               montees: fin.found.reduce(function (a, b) { return a + b; }, 0) };
    });
    check('après chacun des 300 coups, les 52 cartes sont toujours là',
          partie.fautes.length === 0, partie.fautes.join(' | ') ||
          partie.joues + ' déplacements, ' + partie.pioches + ' pioches, ' +
          partie.annules + ' annulations');
    check('la partie a réellement avancé', partie.joues > 20 && partie.montees > 0,
          partie.montees + ' carte(s) montée(s)');

    t.section('L\'annulation rend l\'état exact');
    var fidelite = await page.evaluate(function () {
      var K = window.__neonKlondike;
      function etat() {
        var s = K.snapshot();
        return JSON.stringify([s.piles, s.stock, s.waste, s.found, s.score]);
      }
      var ecarts = 0, essais = 0;
      for (var i = 0; i < 60; i++) {
        var avant = etat();
        var bouge = K.drawStock();
        if (!bouge) { break; }
        essais++;
        K.undo();
        if (etat() !== avant) { ecarts++; }
      }
      return { ecarts: ecarts, essais: essais };
    });
    check('annuler une pioche rend l\'état au caractère près',
          fidelite.ecarts === 0 && fidelite.essais > 5,
          fidelite.essais + ' essais, ' + fidelite.ecarts + ' écart(s)');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
