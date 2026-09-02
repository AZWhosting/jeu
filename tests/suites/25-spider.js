'use strict';

var harness = require('../lib/harness');

/* Neon Spider : l'araignée. Sa règle propre tient en deux phrases qui se
   contredisent presque — on empile sans se soucier de l'enseigne, mais on ne
   déplace d'un bloc qu'une suite d'une seule enseigne — et c'est exactement là
   qu'un jeu de ce genre se trompe. On l'éprouve, puis on vérifie que les deux
   paquets restent entiers sur des centaines de coups joués au hasard. */

module.exports = {
  name: 'Neon Spider — enseignes, suites envolées et paquets intacts',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonSpider.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonSpider[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var carte = function (rang, enseigne) { return rang * 4 + enseigne; };
    var poser = function (cols, opts) {
      return page.evaluate(function (b) {
        window.__neonSpider.setBoard({
          cols: b.cols.map(function (col) {
            return col.map(function (c) { return { c: c, up: true }; });
          }),
          stock: b.stock || [], done: [], harvest: !!b.harvest
        });
      }, Object.assign({ cols: cols }, opts || {}));
    };

    /* ---------------------------------------------------------------- */
    t.section('La donne');
    await page.goto(h.url('spider'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Spider/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);

    var s = await snap();
    check('dix colonnes : quatre de six cartes, six de cinq',
          s.cols.map(function (c) { return c.length; }).join(',') === '6,6,6,6,5,5,5,5,5,5',
          s.cols.map(function (c) { return c.length; }).join(','));
    check('une seule carte retournée par colonne',
          s.cols.every(function (c) { return c.filter(function (e) { return e.up; }).length === 1; }));
    check('cinquante cartes dans la pioche', s.stock.length === 50, s.stock.length);
    check('quarante-quatre cartes cachées', s.hidden === 44, s.hidden);

    var toutes = await api('allCards');
    check('deux paquets, soit 104 cartes', toutes.length === 104, toutes.length);
    var enseignes = toutes.filter(function (c, i, a) { return a.indexOf(c & 3) === -1 || true; })
                          .map(function (c) { return c & 3; });
    var distinctesEns = enseignes.filter(function (v, i) { return enseignes.indexOf(v) === i; });
    check('en facile, une seule enseigne', distinctesEns.length === 1, distinctesEns.join(','));
    var comptes = {};
    toutes.forEach(function (c) { comptes[c] = (comptes[c] || 0) + 1; });
    var rangs = Object.keys(comptes).map(function (k) { return comptes[k]; });
    check('huit exemplaires de chaque rang, de quoi tisser huit suites',
          rangs.length === 13 && rangs.every(function (n) { return n === 8; }),
          rangs.length + ' valeurs, ' + rangs.join(','));

    /* ---------------------------------------------------------------- */
    t.section('Empiler sans enseigne, déplacer avec');
    await page.goto(h.url('spider'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');     // quatre enseignes
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    check('quatre enseignes en difficile', (await snap()).suits === 4);

    // Empiler : seul le rang compte.
    await poser([[carte(9, 0)], [carte(8, 1)], [], [], [], [], [], [], [], []]);
    check('un 9 rouge se pose sur un 10 noir',
          await api('legal', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 0 }) === true);
    await poser([[carte(9, 0)], [carte(7, 1)], [], [], [], [], [], [], [], []]);
    check('un 8 ne se pose pas sur un 10',
          await api('legal', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 0 }) === false);

    // Déplacer : l'enseigne décide.
    await poser([[carte(10, 0)], [carte(9, 0), carte(8, 0)], [], [], [], [], [], [], [], []]);
    check('une suite de même enseigne se déplace d\'un bloc',
          await api('play', { t: 'col', i: 1, n: 2 }, { t: 'col', i: 0 }) === true);
    var bloc = await snap();
    check('les deux cartes sont arrivées ensemble',
          bloc.cols[0].length === 3 && bloc.cols[1].length === 0,
          bloc.cols[0].length + ' / ' + bloc.cols[1].length);

    /* Valet ♠ en 0, la paire mêlée 10♠ / 9♥ en 1, et un 10♦ en 2 : la paire ne
       peut pas monter sur le valet d'un bloc, mais le 9 seul trouve son 10. */
    await poser([[carte(10, 0)], [carte(9, 0), carte(8, 1)], [carte(9, 2)],
                 [], [], [], [], [], [], []]);
    check('une suite mêlée ne se déplace pas d\'un bloc',
          await api('play', { t: 'col', i: 1, n: 2 }, { t: 'col', i: 0 }) === false);
    check('mais sa dernière carte, seule, trouve sa place ailleurs',
          await api('legal', { t: 'col', i: 1, n: 1 }, { t: 'col', i: 2 }) === true);

    check('une colonne vide accepte n\'importe quoi',
          await api('legal', { t: 'col', i: 0, n: 1 }, { t: 'col', i: 5 }) === true);

    t.section('La suite complète s\'envole');
    var suite = [];
    for (var r = 12; r >= 0; r--) { suite.push(carte(r, 0)); }
    var autres = [];
    for (var i = 0; i < 9; i++) { autres.push([carte(1, 1)]); }
    await poser([suite].concat(autres), { harvest: true });
    await page.waitForTimeout(120);
    var envolee = await snap();
    check('les treize cartes du roi à l\'as disparaissent',
          envolee.done.length === 1 && envolee.cols[0].length === 0,
          envolee.done.length + ' suite(s), colonne ' + envolee.cols[0].length);
    check('elle rapporte des points', envolee.score > 0, envolee.score);

    // Une suite mêlée, elle, reste sur la table.
    var melee = [];
    for (var r2 = 12; r2 >= 0; r2--) { melee.push(carte(r2, r2 === 5 ? 1 : 0)); }
    await poser([melee].concat(autres), { harvest: true });
    await page.waitForTimeout(120);
    var restee = await snap();
    check('une suite d\'enseignes mêlées ne s\'envole pas',
          restee.done.length === 0 && restee.cols[0].length === 13,
          restee.done.length + ' suite(s), colonne ' + restee.cols[0].length);

    t.section('La distribution');
    await page.goto(h.url('spider'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var avantDeal = await snap();
    check('la distribution passe', await api('dealRow') === true);
    var apresDeal = await snap();
    check('une carte de plus à chaque colonne',
          apresDeal.cols.every(function (c, k) { return c.length === avantDeal.cols[k].length + 1; }));
    check('dix cartes de moins dans la pioche',
          apresDeal.stock.length === avantDeal.stock.length - 10, apresDeal.stock.length);

    // Une colonne vide condamnerait la carte qu'on y déposerait : on refuse.
    await poser([[carte(12, 0)], [], [carte(5, 0)], [carte(5, 0)], [carte(5, 0)],
                 [carte(5, 0)], [carte(5, 0)], [carte(5, 0)], [carte(5, 0)], [carte(5, 0)]],
                { stock: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    check('la distribution est refusée tant qu\'une colonne est vide',
          await api('dealRow') === false);
    check('et la pioche n\'a pas bougé', (await snap()).stock.length === 10);

    /* ---------------------------------------------------------------- */
    t.section('Les deux paquets restent entiers');
    /* Trois cents coups au hasard, en vérifiant après chacun que les 104
       cartes sont toujours là — suites envolées comprises. */
    await page.goto(h.url('spider'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var attendu = await page.evaluate(function () {
      var t = window.__neonSpider.allCards(), c = {};
      t.forEach(function (x) { c[x] = (c[x] || 0) + 1; });
      return { total: t.length, comptes: c };
    });
    var partie = await page.evaluate(function (ref) {
      var S = window.__neonSpider;

      function coups() {
        var s = S.snapshot(), out = [], i, k;
        for (i = 0; i < s.cols.length; i++) {
          for (k = 0; k < s.cols[i].length; k++) {
            if (!s.cols[i][k].up) { continue; }
            var src = { t: 'col', i: i, n: s.cols[i].length - k };
            for (var j = 0; j < s.cols.length; j++) {
              if (S.legal(src, { t: 'col', i: j })) { out.push([src, { t: 'col', i: j }]); }
            }
          }
        }
        return out;
      }

      var fautes = [];
      var joues = 0, distribs = 0, annules = 0;
      for (var pas = 0; pas < 300; pas++) {
        var possibles = coups();
        var r = Math.random();
        if (possibles.length && r < 0.7) {
          var m = possibles[Math.floor(Math.random() * possibles.length)];
          S.play(m[0], m[1]);
          joues++;
        } else if (r < 0.9) {
          S.dealRow();
          distribs++;
        } else {
          S.undo();
          annules++;
        }
        var toutes = S.allCards();
        var c = {};
        toutes.forEach(function (x) { c[x] = (c[x] || 0) + 1; });
        var ecart = toutes.length !== ref.total;
        Object.keys(ref.comptes).forEach(function (k) { if (c[k] !== ref.comptes[k]) { ecart = true; } });
        if (ecart) {
          fautes.push('pas ' + pas + ' : ' + toutes.length + ' cartes au lieu de ' + ref.total);
          if (fautes.length > 3) { break; }
        }
      }
      var fin = S.snapshot();
      return { fautes: fautes, joues: joues, distribs: distribs, annules: annules,
               suites: fin.done.length, cachees: fin.hidden };
    }, attendu);
    check('après chacun des 300 coups, les 104 cartes sont toutes là, en bon nombre',
          partie.fautes.length === 0, partie.fautes.join(' | ') ||
          partie.joues + ' déplacements, ' + partie.distribs + ' distributions, ' +
          partie.annules + ' annulations');
    check('la partie a réellement avancé', partie.joues > 20, partie.joues + ' déplacements');

    t.section('L\'annulation rend l\'état exact');
    // Sur une donne neuve : les trois cents coups précédents ont pu vider une
    // colonne, et la distribution s'y refuserait à juste titre.
    await page.goto(h.url('spider'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var fidelite = await page.evaluate(function () {
      var S = window.__neonSpider;
      function etat() {
        var s = S.snapshot();
        return JSON.stringify([s.cols, s.stock, s.done, s.score]);
      }
      var ecarts = 0, essais = 0;
      for (var i = 0; i < 40; i++) {
        var avant = etat();
        if (!S.dealRow()) { break; }
        essais++;
        S.undo();
        if (etat() !== avant) { ecarts++; }
      }
      return { ecarts: ecarts, essais: essais };
    });
    check('annuler une distribution rend l\'état au caractère près',
          fidelite.ecarts === 0 && fidelite.essais >= 1,
          fidelite.essais + ' essais, ' + fidelite.ecarts + ' écart(s)');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
