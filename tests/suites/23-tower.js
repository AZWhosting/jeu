'use strict';

var harness = require('../lib/harness');

/* Neon Tower : le seul jeu de la plateforme où le hasard décide. Deux
   questions se posent alors, et une seule vaut d'être prouvée par des mots —
   les deux autres le sont ici par des mesures.

   1. Le jeu triche-t-il ? La porte piégée est-elle vraiment fixée avant le
      choix du joueur, ou décidée après coup ?
   2. Le tirage est-il honnête, ou penche-t-il ?
   3. Les chiffres affichés au joueur sont-ils exacts ?

   Le reste — encaisser, tomber, les vies — n'est que de la règle. */

module.exports = {
  name: 'Neon Tower — hasard honnête et chiffres exacts',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonTower.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonTower[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var set = function (key, value) {
      return page.evaluate(function (p) { window.Progress.setSetting(p[0], p[1]); }, [key, value]);
    };

    /* ---------------------------------------------------------------- */
    t.section('Mise en place');
    await page.goto(h.url('tower'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Tower/.test(await page.title()), await page.title());

    /* ---------------------------------------------------------------- */
    t.section('Le jeu ne décide pas après le choix');
    /* On lit la porte piégée avant de choisir, puis on choisit — d'abord à
       côté, ensuite dessus. Si le jeu décidait après coup, l'un des deux
       résultats finirait par démentir la lecture. Soixante manches. */
    // En mode libre : les soixante pièges ouverts ici ne coûtent pas de vie,
    // et la manche peut donc être replacée soixante fois de suite.
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var honnete = await page.evaluate(function () {
      var T = window.__neonTower;
      var survecu = 0, tombe = 0, dementis = [];
      for (var i = 0; i < 30; i++) {
        // À côté du piège : on doit passer.
        T.setLevel(1);
        var piege = T.peek();
        var s0 = T.snapshot();
        var autre = (piege + 1) % s0.doors;
        T.open(autre);
        var s1 = T.snapshot();
        if (s1.level === 2) { survecu++; }
        else { dementis.push('ouvert ' + autre + ' hors du piège ' + piege + ' et pourtant tombé'); }

        // Sur le piège : on doit tomber.
        T.setLevel(1);
        var piege2 = T.peek();
        T.open(piege2);
        var s2 = T.snapshot();
        if (s2.state === 'falling' || s2.pot === 0) { tombe++; }
        else { dementis.push('ouvert le piège ' + piege2 + ' et pourtant passé'); }
      }
      return { survecu: survecu, tombe: tombe, dementis: dementis };
    });
    check('ouvrir à côté du piège fait toujours monter', honnete.survecu === 30,
          honnete.survecu + '/30');
    check('ouvrir le piège fait toujours tomber', honnete.tombe === 30, honnete.tombe + '/30');
    check('aucun démenti : le sort est fixé avant le choix', honnete.dementis.length === 0,
          honnete.dementis.slice(0, 3).join(' | ') || '60 manches, aucun démenti');

    t.section('Et il ne penche pas');
    /* Six mille tirages sur un palier à six portes : chaque porte doit être
       piégée à peu près mille fois. On borne l'écart plutôt que d'espérer
       l'exactitude — c'est du hasard, pas une distribution. */
    var tirage = await page.evaluate(function () {
      var T = window.__neonTower;
      T.setLevel(1);
      var doors = T.snapshot().doors;
      var compte = new Array(doors).fill(0);
      for (var i = 0; i < 6000; i++) { compte[T.reseat()]++; }
      return { doors: doors, compte: compte };
    });
    var attendu = 6000 / tirage.doors;
    var ecartMax = 0;
    tirage.compte.forEach(function (c) { ecartMax = Math.max(ecartMax, Math.abs(c - attendu)); });
    check('les six portes sont tirées', tirage.compte.every(function (c) { return c > 0; }),
          tirage.compte.join(', '));
    // ±5 σ autour de 1000, soit environ ±150 : un tirage biaisé le dépasserait.
    check('aucune porte n\'est favorisée', ecartMax < attendu * 0.15,
          'écart maximal ' + Math.round(ecartMax) + ' pour ' + attendu + ' attendus');

    /* ---------------------------------------------------------------- */
    t.section('Les chiffres affichés sont les bons');
    var niveaux = [['easy', 6], ['normal', 5], ['hard', 4]];
    for (var d = 0; d < niveaux.length; d++) {
      var id = niveaux[d][0], basculeAnnoncee = niveaux[d][1];
      await page.goto(h.url('tower'));
      await page.waitForTimeout(300);
      await page.click('.choice[data-diff="' + id + '"]');
      await page.click('#playBtn');
      await page.waitForTimeout(150);

      var table = await api('ladder');
      var faux = [];
      var basculeMesuree = 0;
      for (var k = 1; k <= table.length; k++) {
        await api('setLevel', k);
        var s = await snap();
        var pas = table[k - 1];
        var chanceAttendue = (pas.doors - 1) / pas.doors;
        if (s.doors !== pas.doors) { faux.push('palier ' + k + ' : ' + s.doors + ' portes'); }
        if (Math.abs(s.chance - chanceAttendue) > 1e-9) {
          faux.push('palier ' + k + ' : chance ' + s.chance + ' au lieu de ' + chanceAttendue);
        }
        if (s.nextPot !== pas.pot) { faux.push('palier ' + k + ' : pot ' + s.nextPot); }
        if (Math.abs(s.expected - chanceAttendue * pas.pot) > 1e-6) {
          faux.push('palier ' + k + ' : espérance ' + s.expected);
        }
        // Le pot déjà acquis vaut celui du palier précédent.
        var acquis = k > 1 ? table[k - 2].pot : 0;
        if (s.pot !== acquis) { faux.push('palier ' + k + ' : acquis ' + s.pot + ' au lieu de ' + acquis); }
        if (!basculeMesuree && k > 1 && chanceAttendue * pas.pot < acquis) { basculeMesuree = k; }
      }
      check(id + ' : portes, chances, pots et espérances exacts sur les ' + table.length + ' paliers',
            faux.length === 0, faux.slice(0, 3).join(' | ') || undefined);
      check(id + ' : le basculement tombe où le manifeste l\'annonce',
            basculeMesuree === basculeAnnoncee && basculeMesuree === (await snap()).tipping,
            'mesuré ' + basculeMesuree + ', annoncé ' + basculeAnnoncee);
    }

    /* ---------------------------------------------------------------- */
    t.section('Encaisser, tomber');
    await page.goto(h.url('tower'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(150);

    check('on ne peut rien encaisser avant d\'avoir rien gagné', await api('bank') === false);
    await api('setLevel', 4);
    var avant = await snap();
    check('trois paliers franchis valent le pot annoncé', avant.pot === 240, avant.pot);
    check('l\'encaissement passe', await api('bank') === true);
    var apres = await snap();
    check('le score gagne exactement le pot', apres.score === avant.score + avant.pot,
          avant.score + ' + ' + avant.pot + ' = ' + apres.score);
    check('la manche repart au premier palier', apres.level === 1 && apres.pot === 0,
          'palier ' + apres.level + ', pot ' + apres.pot);
    check('l\'encaissement offre une sonde', apres.probes === avant.probes + 1,
          avant.probes + ' → ' + apres.probes);
    check('le succès du premier retrait tombe',
          apres.unlocked.indexOf('firstBank') !== -1, apres.unlocked.join(', '));

    await api('setLevel', 3);
    var riche = await snap();
    var piege = await api('peek');
    await api('open', piege);
    await page.waitForTimeout(120);
    var tombe = await snap();
    check('le piège emporte le pot', tombe.pot === 0, tombe.pot);
    check('mais pas le score déjà encaissé', tombe.score === riche.score, tombe.score);
    check('et il coûte une vie', tombe.lives === riche.lives - 1,
          riche.lives + ' → ' + tombe.lives);
    await page.screenshot({ path: h.shot('tower-piege') });

    t.section('La sonde');
    await page.waitForTimeout(1300);
    await api('setLevel', 1);
    var avantSonde = await snap();
    var porte = await api('probe');
    var apresSonde = await snap();
    var verite = await api('peek');
    check('la sonde désigne une porte', porte >= 0 && porte < avantSonde.doors, porte);
    check('elle dit la vérité sur cette porte',
          apresSonde.revealed[String(porte)] === (porte === verite),
          'porte ' + porte + ' annoncée ' + (apresSonde.revealed[String(porte)] ? 'piégée' : 'sûre') +
          ', piège en ' + verite);
    check('elle se dépense', apresSonde.probes === avantSonde.probes - 1,
          avantSonde.probes + ' → ' + apresSonde.probes);

    t.section('Confirmer au-delà du basculement');
    await set('confirm', true);
    await api('setLevel', 5);          // le palier du basculement, en normal
    var seuil = await snap();
    check('on est bien au palier du basculement', seuil.level === seuil.tipping, seuil.level);
    check('monter n\'y est plus payant en moyenne', seuil.worth === false,
          Math.round(seuil.expected) + ' contre ' + seuil.pot);
    var sain = await page.evaluate(function () {
      var T = window.__neonTower;
      var piege = T.peek();
      return (piege + 1) % T.snapshot().doors;
    });
    check('la première pression ne fait rien', await api('open', sain) === false);
    check('le palier n\'a pas bougé', (await snap()).level === 5);
    check('la seconde ouvre bien la porte', await api('open', sain) === true);
    await set('confirm', false);

    /* ---------------------------------------------------------------- */
    t.section('Les vies s\'épuisent');
    await page.goto(h.url('tower'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(150);
    var vies = (await snap()).lives;
    check('deux vies en difficile', vies === 2, vies);
    for (var v = 0; v < vies; v++) {
      await api('setLevel', 2);
      await api('open', await api('peek'));
      await page.waitForTimeout(1300);
    }
    var mort = await snap();
    check('deux pièges épuisent les deux vies', mort.state === 'over', mort.state);

    t.section('En mode libre, les pièges ne tuent pas');
    await page.goto(h.url('tower'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(150);
    for (var z = 0; z < 4; z++) {
      await api('setLevel', 2);
      await api('open', await api('peek'));
      await page.waitForTimeout(1300);
    }
    var libre = await snap();
    check('quatre pièges et la partie continue', libre.state === 'playing', libre.state);
    check('ils sont tout de même comptés', libre.traps === 4, libre.traps);
    check('le mode libre ne produit pas de record',
          await page.evaluate(function () { return window.Progress.bestFor('zen'); }) === 0);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
