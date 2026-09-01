'use strict';

var harness = require('../lib/harness');

/* Neon Echo : la mémoire d'une séquence. Ce qu'on éprouve ici, c'est la règle —
   la suite garde son préfixe et gagne une dalle par manche, une faute à
   n'importe quelle position arrête la manche, et frapper pendant que la machine
   joue ne compte pas. Plus une exigence qui n'est pas du jeu mais de l'accès :
   la couleur n'est jamais la seule information. */

module.exports = {
  name: 'Neon Echo — séquence, fautes et rythme',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonEcho.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonEcho[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var set = function (key, value) {
      return page.evaluate(function (p) { window.Progress.setSetting(p[0], p[1]); }, [key, value]);
    };

    /* ---------------------------------------------------------------- */
    t.section('Mise en place');
    await page.goto(h.url('echo'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Echo/.test(await page.title()), await page.title());

    var pads = await api('pads');
    var notes = pads.map(function (p) { return p.note; });
    var glyphs = pads.map(function (p) { return p.glyph; });
    var colors = pads.map(function (p) { return p.color; });
    var distinct = function (a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }).length; };
    // Trois canaux pour la même information : qui n'entend pas voit, qui ne
    // distingue pas les couleurs lit la forme.
    check('chaque dalle a sa note', distinct(notes) === notes.length, notes.join(', '));
    check('chaque dalle a son symbole', distinct(glyphs) === glyphs.length, glyphs.join(' '));
    check('chaque dalle a sa couleur', distinct(colors) === colors.length, colors.length + ' couleurs');

    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var s = await snap();
    check('la machine joue d\'abord', s.state === 'showing', s.state);
    check('la première manche fait une dalle', s.sequence.length === 1, s.sequence.length);
    check('six dalles en normal', s.pads === 6, s.pads);

    t.section('Frapper pendant la démonstration ne compte pas');
    var pendant = await api('press', 0);
    var muet = await snap();
    check('la frappe est refusée', pendant === false);
    check('le curseur n\'a pas bougé', muet.cursor === 0, muet.cursor);
    check('elle n\'est pas comptée', muet.presses === 0, muet.presses);

    /* ---------------------------------------------------------------- */
    t.section('La séquence s\'allonge en gardant son préfixe');
    await api('skipDemo');
    var suites = [];
    for (var r = 0; r < 5; r++) {
      var avant = await snap();
      suites.push(avant.sequence.slice());
      await api('replay');
      await page.waitForTimeout(750);
      await api('skipDemo');
    }
    var prefixes = true, croissance = true, valides = true;
    for (var i = 1; i < suites.length; i++) {
      if (suites[i].length !== suites[i - 1].length + 1) { croissance = false; }
      if (suites[i].slice(0, suites[i - 1].length).join(',') !== suites[i - 1].join(',')) { prefixes = false; }
    }
    suites.forEach(function (seq) {
      seq.forEach(function (p) { if (p < 0 || p >= 6 || p !== Math.floor(p)) { valides = false; } });
    });
    check('une dalle de plus à chaque manche', croissance,
          suites.map(function (q) { return q.length; }).join(' → '));
    check('et la suite précédente est conservée telle quelle', prefixes,
          suites[suites.length - 1].join(','));
    check('aucune dalle tirée hors du plateau', valides);

    var apres = await snap();
    check('les manches sont comptées', apres.rounds >= 5, apres.rounds);
    check('elles rapportent des points', apres.score > 0, apres.score);
    check('le succès du premier écho tombe',
          apres.unlocked.indexOf('firstRound') !== -1, apres.unlocked.join(', '));
    check('celui des cinq de suite aussi',
          apres.unlocked.indexOf('round5') !== -1, apres.unlocked.join(', '));
    await page.screenshot({ path: h.shot('echo-jeu') });

    /* ---------------------------------------------------------------- */
    t.section('Une faute à n\'importe quelle position arrête la manche');
    /* On éprouve chaque position : rendre juste jusqu'à la k-ième, se tromper
       là, et vérifier que la manche s'arrête — pour tout k. */
    var suite = [0, 3, 1, 5, 2, 4];
    var fautes = [];
    for (var k = 0; k < suite.length; k++) {
      await api('arm', suite);
      for (var j = 0; j < k; j++) { await api('press', suite[j]); }
      var mauvais = (suite[k] + 1) % 6;
      var accepte = await api('press', mauvais);
      var etat = await snap();
      if (accepte !== false || etat.state !== 'wrong' || etat.cursor !== k) {
        fautes.push('position ' + k + ' : ' + etat.state + ', curseur ' + etat.cursor);
      }
    }
    check('les six positions arrêtent la manche quand on se trompe',
          fautes.length === 0, fautes.join(' | ') || '6 positions éprouvées');

    // Et la suite rendue juste jusqu'au bout passe la manche.
    await api('arm', suite);
    var juste = await api('replay');
    check('la même suite, rendue juste, passe', juste === true);

    /* ---------------------------------------------------------------- */
    t.section('Le rythme presse, sans jamais s\'emballer');
    await set('steady', false);
    await api('arm', [0]);
    var lent = (await snap()).litMs;
    await api('arm', [0, 1, 2, 3, 4, 5, 0, 1]);
    var vif = (await snap()).litMs;
    var longue = [];
    for (var n = 0; n < 40; n++) { longue.push(n % 6); }
    await api('arm', longue);
    var plancher = (await snap()).litMs;
    check('une manche plus longue va plus vite', vif < lent, lent + ' ms → ' + vif + ' ms');
    check('mais jamais sous le plancher de la difficulté', plancher === 220,
          plancher + ' ms après 40 manches');

    await set('steady', true);
    await api('arm', [0]);
    var fixe1 = (await snap()).litMs;
    await api('arm', longue);
    var fixe2 = (await snap()).litMs;
    check('réglage « rythme constant » : la durée ne bouge plus',
          fixe1 === fixe2 && fixe1 === 540, fixe1 + ' ms / ' + fixe2 + ' ms');
    await set('steady', false);

    /* ---------------------------------------------------------------- */
    t.section('Taper directement sur les dalles');
    await api('arm', [2]);
    var box = await page.evaluate(function () {
      var r = document.getElementById('board').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    var b = await api('padBox', 2);
    var avantTape = await snap();
    await page.mouse.click(box.x + b.x + b.w / 2, box.y + b.y + b.h / 2);
    await page.waitForTimeout(200);
    var frappe = await snap();
    check('la frappe est comptée', frappe.presses === avantTape.presses + 1,
          avantTape.presses + ' → ' + frappe.presses);
    // La manche suivante ne part qu'après un temps d'arrêt sur la réussite.
    await page.waitForTimeout(800);
    var tape = await snap();
    check('taper la bonne dalle passe la manche', tape.sequence.length === 2,
          tape.state + ', séquence de ' + tape.sequence.length);

    /* ---------------------------------------------------------------- */
    t.section('À l\'envers, en difficile');
    await page.goto(h.url('echo'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await api('arm', [1, 4, 2]);
    var envers = await snap();
    check('la difficulté demande l\'inverse', envers.reverse === true);
    check('l\'attendu est l\'exact inverse de la séquence',
          envers.expected.join(',') === '2,4,1',
          envers.sequence.join(',') + ' → ' + envers.expected.join(','));
    check('rendre à l\'endroit est une faute', await api('press', 1) === false);
    await api('arm', [1, 4, 2]);
    check('rendre à l\'envers passe', await api('replay') === true);

    /* ---------------------------------------------------------------- */
    t.section('En mode libre, une faute rejoue la manche');
    await page.goto(h.url('echo'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await api('arm', [0, 1, 2]);
    var avantFaute = await snap();
    await api('press', (avantFaute.expected[0] + 1) % 4);
    check('la faute est enregistrée', (await snap()).state === 'wrong');
    await page.waitForTimeout(1100);
    var doux = await snap();
    check('la partie continue', doux.state === 'showing' || doux.state === 'input', doux.state);
    check('la même séquence est rejouée', doux.sequence.join(',') === '0,1,2', doux.sequence.join(','));
    check('le mode libre ne produit pas de record',
          await page.evaluate(function () { return window.Progress.bestFor('zen'); }) === 0);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
