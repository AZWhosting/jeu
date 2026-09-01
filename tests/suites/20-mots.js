'use strict';

var harness = require('../lib/harness');

/* Neon Mots : les listes, la saisie, et surtout le marquage des lettres.
   C'est là que les jeux de ce genre se trompent — sur les lettres répétées —
   et c'est donc là qu'on met la preuve : une propriété vérifiée sur toutes les
   paires de mots des trois listes, soit plus de trois cent mille marquages. */

module.exports = {
  name: 'Neon Mots — listes, saisie et marquage des lettres',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonMots.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonMots[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var set = function (key, value) {
      return page.evaluate(function (p) { window.Progress.setSetting(p[0], p[1]); }, [key, value]);
    };

    /* ---------------------------------------------------------------- */
    t.section('Mise en place');
    await page.goto(h.url('mots'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Mots/.test(await page.title()), await page.title());

    var listes = await page.evaluate(function () {
      var out = {};
      [4, 5, 6].forEach(function (n) {
        var mots = window.MotsWords[n];
        var trie = mots.slice().sort();
        var vus = {}, doubles = 0;
        mots.forEach(function (w) { if (vus[w]) { doubles++; } vus[w] = 1; });
        out[n] = {
          total: mots.length,
          malFormes: mots.filter(function (w) { return w.length !== n || !/^[A-Z]+$/.test(w); }),
          doubles: doubles,
          trie: JSON.stringify(trie) === JSON.stringify(mots)
        };
      });
      return out;
    });
    [4, 5, 6].forEach(function (n) {
      var l = listes[n];
      check(n + ' lettres : ' + l.total + ' mots, tous à la bonne longueur et en A-Z',
            l.malFormes.length === 0, l.malFormes.join(', ') || undefined);
      check(n + ' lettres : aucun doublon', l.doubles === 0, l.doubles);
      // Le jeu cherche les mots par dichotomie : la liste doit rester triée.
      check(n + ' lettres : liste triée, comme la recherche le suppose', l.trie);
      check(n + ' lettres : assez de mots pour ne pas tourner en rond', l.total >= 200, l.total);
    });

    /* ---------------------------------------------------------------- */
    t.section('Le marquage des lettres, éprouvé sur toutes les paires');
    /* La propriété : pour chaque lettre, le nombre de cases marquées « bien
       placée » ou « présente » vaut exactement le minimum entre ce que la
       proposition en contient et ce que la solution en contient. C'est ce que
       les clones ratent quand une lettre est répétée. Et une case est marquée
       « bien placée » si et seulement si les deux lettres coïncident. */
    var preuve = await page.evaluate(function () {
      var mark = window.__neonMots.mark;
      var paires = 0, fautes = [], places = 0;
      [4, 5, 6].forEach(function (n) {
        var mots = window.MotsWords[n];
        for (var a = 0; a < mots.length; a++) {
          for (var b = 0; b < mots.length; b++) {
            var g = mots[a], s = mots[b];
            var m = mark(g, s);
            paires++;
            var i, c;
            for (i = 0; i < n; i++) {
              if ((m[i] === 'correct') !== (g.charAt(i) === s.charAt(i))) {
                if (fautes.length < 5) { fautes.push('place ' + g + '/' + s + ' en ' + i); }
              } else if (m[i] === 'correct') { places++; }
            }
            var vus = {};
            for (i = 0; i < n; i++) {
              c = g.charAt(i);
              if (vus[c]) { continue; }
              vus[c] = 1;
              var signale = 0, dansG = 0, dansS = 0;
              for (var j = 0; j < n; j++) {
                if (g.charAt(j) === c) { dansG++; if (m[j] !== 'absent') { signale++; } }
                if (s.charAt(j) === c) { dansS++; }
              }
              if (signale !== Math.min(dansG, dansS)) {
                if (fautes.length < 5) {
                  fautes.push(g + '/' + s + ' lettre ' + c + ' : ' + signale +
                              ' signalée(s) pour ' + Math.min(dansG, dansS) + ' attendue(s)');
                }
              }
            }
          }
        }
      });
      return { paires: paires, fautes: fautes, places: places };
    });
    check('toutes les paires de mots marquées', preuve.paires > 300000,
          preuve.paires.toLocaleString('fr-FR') + ' marquages');
    check('« bien placée » vaut exactement coïncidence de position',
          preuve.places > 0 && preuve.fautes.length === 0, preuve.fautes.join(' | ') || undefined);
    check('chaque lettre signalée autant de fois qu\'elle peut l\'être',
          preuve.fautes.length === 0, preuve.fautes.join(' | ') || undefined);

    t.section('Les pièges connus, à la main');
    var elles = await api('mark', 'ELLES', 'ELEVE');
    check('ELLES contre ELEVE : le second E est « présent », le S absent',
          elles.join(',') === 'correct,correct,absent,present,absent', elles.join(','));
    var tete = await api('mark', 'TETE', 'ETRE');
    check('TETE contre ETRE : un seul T signalé, le second est absent',
          tete.join(',') === 'present,present,absent,correct', tete.join(','));
    var meme = await api('mark', 'AIDE', 'AIDE');
    check('un mot contre lui-même est tout entier bien placé',
          meme.join(',') === 'correct,correct,correct,correct', meme.join(','));

    /* ---------------------------------------------------------------- */
    t.section('Saisie et règles');
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await set('first', true);
    await api('setWord', 'TABLE');
    var s = await snap();
    check('la première lettre est offerte', s.current === 'T', JSON.stringify(s.current));
    await api('backspace');
    check('et elle ne s\'efface pas', (await snap()).current === 'T');

    await set('first', false);
    await api('setWord', 'TABLE');
    check('réglage éteint : la ligne part vide', (await snap()).current === '');

    check('un mot inconnu est refusé', await api('guess', 'ZZZZZ') === false);
    check('rien n\'est inscrit pour autant', (await snap()).rows.length === 0);
    await set('strict', false);
    check('réglage éteint : le même mot passe', await api('guess', 'ZZZZZ') === true);
    check('et il occupe une ligne', (await snap()).rows.length === 1);
    await set('strict', true);

    await api('setWord', 'TABLE');
    check('un mot de la mauvaise longueur est refusé', await api('guess', 'PORT') === false);

    t.section('Le clavier retient ce qu\'on sait');
    await api('setWord', 'TABLE');
    await api('guess', 'PORTE');
    var k = (await snap()).keys;
    check('E bien placé', k.E === 'correct', k.E);
    check('T présent ailleurs', k.T === 'present', k.T);
    check('P, O et R absents', k.P === 'absent' && k.O === 'absent' && k.R === 'absent',
          [k.P, k.O, k.R].join(','));
    await api('guess', 'TASSE');
    var k2 = (await snap()).keys;
    check('T passe de « présent » à « bien placé »', k2.T === 'correct', k2.T);
    check('et ne redescend jamais', k2.E === 'correct', k2.E);

    /* ---------------------------------------------------------------- */
    t.section('Le clavier de l\'écran');
    await api('setWord', 'TABLE');
    var box = await page.evaluate(function () {
      var r = document.getElementById('board').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    var keys = await api('keyBoxes');
    var touche = function (id) {
      var k = keys.filter(function (b) { return b.id === id; })[0];
      return { x: box.x + k.x + k.w / 2, y: box.y + k.y + k.h / 2 };
    };
    var p = touche('P');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
    check('taper une touche écrit sa lettre', (await snap()).current === 'P',
          JSON.stringify((await snap()).current));
    var del = touche('\b');
    await page.mouse.click(del.x, del.y);
    await page.waitForTimeout(80);
    check('la touche ⌫ efface', (await snap()).current === '');
    ['P', 'O', 'R', 'T', 'E'].forEach(function () { /* saisies enchaînées ci-dessous */ });
    for (var i = 0; i < 5; i++) {
      var c = 'PORTE'.charAt(i);
      var pt = touche(c);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(40);
    }
    var entree = touche('\n');
    await page.mouse.click(entree.x, entree.y);
    await page.waitForTimeout(120);
    check('la touche ⏎ valide la proposition', (await snap()).rows.length === 1,
          JSON.stringify((await snap()).rows));

    /* ---------------------------------------------------------------- */
    t.section('Trouver, et manquer');
    await api('setWord', 'TABLE');
    var avant = await snap();
    await api('guess', 'TABLE');
    await page.waitForTimeout(150);
    var gagne = await snap();
    check('le mot trouvé est reconnu', gagne.resolved === 1, gagne.resolved);
    check('il rapporte des points', gagne.score > avant.score, avant.score + ' → ' + gagne.score);
    check('la série monte', gagne.streak === avant.streak + 1, gagne.streak);
    check('le succès du premier mot tombe',
          gagne.unlocked.indexOf('firstWord') !== -1, gagne.unlocked.join(', '));
    await page.screenshot({ path: h.shot('mots-trouve') });
    await page.waitForTimeout(1700);
    var apres = await snap();
    check('un nouveau mot est servi', apres.rows.length === 0 && apres.word !== undefined,
          'mot de ' + apres.size + ' lettres, ' + apres.rows.length + ' ligne(s)');

    // Six propositions fausses de suite : la partie s'arrête.
    await api('setWord', 'TABLE');
    var faux = await page.evaluate(function () {
      var mots = window.MotsWords[5].filter(function (w) { return w !== 'TABLE'; });
      return mots.slice(0, 6);
    });
    for (var f = 0; f < faux.length; f++) { await api('guess', faux[f]); }
    var epuise = await snap();
    check('les six essais sont consommés', epuise.rows.length === 6, epuise.rows.length);
    check('le mot est compté comme manqué', epuise.resolved === -1, epuise.resolved);
    await page.waitForTimeout(1700);
    var fini = await snap();
    check('la partie s\'arrête', fini.state === 'over', fini.state);
    check('le panneau donne le mot',
          /TABLE/.test(await page.textContent('#subtitle')), await page.textContent('#subtitle'));

    t.section('En mode libre, un mot manqué n\'arrête rien');
    await page.goto(h.url('mots'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await set('first', false);
    await api('setWord', 'TABLE');
    var zenFaux = await page.evaluate(function () {
      return window.MotsWords[5].filter(function (w) { return w !== 'TABLE'; }).slice(0, 8);
    });
    for (var z = 0; z < zenFaux.length; z++) { await api('guess', zenFaux[z]); }
    var zen = await snap();
    check('huit essais en mode libre', zen.rows.length === 8, zen.rows.length);
    await page.waitForTimeout(1700);
    var suite = await snap();
    check('la partie continue', suite.state === 'playing', suite.state);
    check('un mot neuf est posé', suite.rows.length === 0);
    check('la série est retombée à zéro', suite.streak === 0, suite.streak);
    check('le mode libre ne produit pas de record',
          await page.evaluate(function () { return window.Progress.bestFor('zen'); }) === 0);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
