'use strict';

var harness = require('../lib/harness');

/* Neon Pyramid : la pyramide. Deux choses s'y vérifient mal à l'œil.

   La première est la couverture : une carte n'est jouable que si les deux
   cartes qui la chevauchent sont parties, et un décalage d'un rang dans le
   calcul des enfants ne se voit qu'au moment où le joueur reste bloqué.

   La seconde est la donne. Une pyramide tirée au hasard est presque toujours
   perdue d'avance — la suite le mesure — alors le jeu sert une table de donnes
   prouvées gagnables. Cette promesse-là ne vaut que si on la revérifie : la
   suite embarque son propre solveur, indépendant du jeu, et le fait tourner sur
   les donnes servies. */

module.exports = {
  name: 'Neon Pyramid — couverture, treize, et donnes prouvées gagnables',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonPyramid.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonPyramid[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var carte = function (valeur, enseigne) { return (valeur - 1) * 4 + enseigne; };
    var pyrSpot = function (i) { return { t: 'pyr', i: i }; };

    /* Une pyramide construite à la main : `plan` donne les 28 cartes, `partis`
       les index déjà retirés. */
    var poser = function (plan, partis, stock, waste) {
      return page.evaluate(function (b) {
        var gone = [];
        for (var i = 0; i < 28; i++) { gone.push(b.partis.indexOf(i) >= 0); }
        window.__neonPyramid.setBoard({
          pyr: b.plan, gone: gone, stock: b.stock || [], waste: b.waste || [], pass: 0
        });
      }, { plan: plan, partis: partis || [], stock: stock, waste: waste });
    };

    // Une pyramide neutre : que des 2, qui ne font jamais 13 entre eux.
    var neutre = function () {
      var out = [];
      for (var i = 0; i < 28; i++) { out.push(carte(2, i % 4)); }
      return out;
    };

    /* ---------------------------------------------------------------- */
    t.section('La donne');
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Pyramid/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);

    var s = await snap();
    check('vingt-huit cartes dans la pyramide', s.pyr.length === 28, s.pyr.length);
    check('vingt-quatre dans la pioche', s.stock.length === 24, s.stock.length);
    check('la défausse est vide', s.waste.length === 0, s.waste.length);
    check('trois passes en facile', s.passes === 3, s.passes);

    var toutes = await api('allCards');
    var vues = {};
    toutes.forEach(function (c) { vues[c] = (vues[c] || 0) + 1; });
    check('un paquet complet, sans doublon',
          toutes.length === 52 && Object.keys(vues).length === 52,
          toutes.length + ' cartes, ' + Object.keys(vues).length + ' distinctes');

    check('seule la rangée du bas est libre au départ',
          s.free.join(',') === '21,22,23,24,25,26,27', s.free.join(','));

    /* ---------------------------------------------------------------- */
    t.section('Ce qui recouvre quoi');
    // La 15 (rangée 5, première) est couverte par la 21 et la 22.
    await poser(neutre(), [21]);
    check('une carte reste couverte tant qu\'il reste un enfant',
          await api('free', 15) === false);
    await poser(neutre(), [21, 22]);
    check('elle se libère quand les deux sont partis', await api('free', 15) === true);
    await poser(neutre(), [21, 22]);
    check('sa voisine, elle, est encore couverte', await api('free', 16) === false);
    check('le sommet reste couvert', await api('free', 0) === false);
    var apex = [];
    for (var k = 1; k < 28; k++) { apex.push(k); }
    await poser(neutre(), apex);
    check('le sommet se libère quand tout le reste est parti', await api('free', 0) === true);

    /* ---------------------------------------------------------------- */
    t.section('Faire treize');
    var plan = neutre();
    plan[21] = carte(1, 0);      // as
    plan[22] = carte(12, 1);     // dame : 1 + 12 = 13
    plan[23] = carte(6, 2);
    plan[24] = carte(7, 3);      // 6 + 7 = 13
    plan[25] = carte(13, 0);     // roi
    plan[26] = carte(5, 1);
    plan[27] = carte(9, 2);      // 5 + 9 = 14 : rien

    await poser(plan, []);
    check('un as et une dame font treize',
          await api('pairs', pyrSpot(21), pyrSpot(22)) === true);
    check('un six et un sept aussi',
          await api('pairs', pyrSpot(23), pyrSpot(24)) === true);
    check('un cinq et un neuf, non',
          await api('pairs', pyrSpot(26), pyrSpot(27)) === false);
    check('une carte avec elle-même, non',
          await api('pairs', pyrSpot(21), pyrSpot(21)) === false);

    // Une carte couverte ne se marie pas, même si le compte y est.
    var couvert = neutre();
    couvert[15] = carte(1, 0);
    couvert[27] = carte(12, 1);
    await poser(couvert, []);
    check('une carte encore couverte ne fait pas la paire',
          await api('pairs', pyrSpot(15), pyrSpot(27)) === false);

    await poser(plan, []);
    check('la paire se retire', await api('remove', pyrSpot(21), pyrSpot(22)) === true);
    var apres = await snap();
    check('les deux cartes ont disparu',
          apres.gone[21] === true && apres.gone[22] === true);
    check('elle rapporte des points', apres.score > 0, apres.score);
    check('et compte pour une paire', apres.pairs === 1, apres.pairs);

    await poser(plan, []);
    check('le roi part tout seul', await api('tap', pyrSpot(25)) === true);
    check('et il est bien parti', (await snap()).gone[25] === true);

    await poser(plan, []);
    check('une tape choisit la carte sans la retirer', await api('tap', pyrSpot(23)) === false);
    var choisie = await api('picked');
    check('la carte choisie est mémorisée', choisie && choisie.i === 23, JSON.stringify(choisie));
    check('la seconde tape ferme la paire', await api('tap', pyrSpot(24)) === true);
    check('plus rien n\'est choisi après le retrait', (await api('picked')) === null);

    await poser(plan, []);
    await api('tap', pyrSpot(26));
    check('une tape sur une carte qui ne complète pas ne retire rien',
          await api('tap', pyrSpot(27)) === false);
    check('mais elle devient la nouvelle carte choisie',
          (await api('picked')).i === 27);

    /* ---------------------------------------------------------------- */
    t.section('La pioche et ses passes');
    await poser(neutre(), [], [carte(3, 0), carte(4, 1), carte(5, 2)], []);
    check('piocher passe une carte à la défausse', await api('drawCard') === true);
    var pioche = await snap();
    check('la dernière carte de la pioche arrive sur la défausse',
          pioche.waste.length === 1 && pioche.waste[0] === carte(5, 2) && pioche.stock.length === 2,
          pioche.waste.join(',') + ' / ' + pioche.stock.length);

    // La défausse se marie avec la pyramide.
    var avecDef = neutre();
    avecDef[27] = carte(4, 0);
    await poser(avecDef, [], [carte(9, 1)], []);
    await api('drawCard');
    check('le dessus de la défausse fait treize avec la pyramide',
          await api('pairs', { t: 'waste' }, pyrSpot(27)) === true);
    check('et la paire se retire', await api('remove', { t: 'waste' }, pyrSpot(27)) === true);
    var apresDef = await snap();
    check('la défausse s\'est vidée et la carte de la pyramide est partie',
          apresDef.waste.length === 0 && apresDef.gone[27] === true);

    // Le retournement conserve l'ordre de pioche.
    await poser(neutre(), [], [carte(2, 0), carte(3, 0), carte(4, 0)], []);
    await api('drawCard');    // 4
    await api('drawCard');    // 3
    await api('drawCard');    // 2
    var vide = await snap();
    check('la pioche est épuisée', vide.stock.length === 0 && vide.waste.length === 3);
    check('la pioche se retourne', await api('drawCard') === true);
    var tour2 = await snap();
    check('la passe suivante est entamée', tour2.pass === 1, tour2.pass);
    var attendu = [carte(2, 0), carte(3, 0), carte(4, 0)];
    check('l\'ordre de pioche est conservé au retournement',
          tour2.stock.join(',') === attendu.join(','),
          tour2.stock.join(',') + ' au lieu de ' + attendu.join(','));

    // En difficile, une seule passe : pas de retournement.
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    check('une seule passe en difficile', (await snap()).passes === 1);
    await poser(neutre(), [], [carte(2, 0)], []);
    await api('drawCard');
    check('la pioche refuse de se retourner à la dernière passe',
          await api('drawCard') === false);
    check('et la défausse n\'a pas bougé', (await snap()).waste.length === 1);

    /* ---------------------------------------------------------------- */
    t.section('L\'impasse');
    // Que des 2 : aucune paire possible, et la pioche épuisée.
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await poser(neutre(), [], [], []);
    check('aucun coup possible', (await snap()).anyMove === false);
    await poser(neutre(), [], [carte(2, 0)], []);
    check('mais tant qu\'il reste à piocher, la partie continue',
          (await snap()).anyMove === true);

    /* ---------------------------------------------------------------- */
    t.section('La tape sur le plateau');
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(400);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);
    var boite = await page.locator('#board').boundingBox();
    /* Une pyramide de deux : aucune paire possible, aucun roi qui partirait
       seul. Une tape ne peut donc que choisir — la donne du jour n'a pas son
       mot à dire. */
    await poser(neutre(), [], [carte(3, 0), carte(4, 1)], []);
    var pointStock = await api('spotAt', { t: 'stock' });
    await page.mouse.click(boite.x + pointStock.x * boite.width,
                           boite.y + pointStock.y * boite.height);
    await page.waitForTimeout(150);
    check('cliquer la pioche tire une carte',
          (await snap()).stock.length === 1, (await snap()).stock.length);

    var pointBas = await api('spotAt', pyrSpot(24));
    await page.mouse.click(boite.x + pointBas.x * boite.width,
                           boite.y + pointBas.y * boite.height);
    await page.waitForTimeout(150);
    var apresClic = await api('picked');
    check('cliquer une carte libre la choisit',
          !!apresClic && apresClic.t === 'pyr' && apresClic.i === 24,
          JSON.stringify(apresClic));

    // Et une carte encore recouverte ne répond pas : le choix ne bouge pas.
    var pointHaut = await api('spotAt', pyrSpot(17));
    await page.mouse.click(boite.x + pointHaut.x * boite.width,
                           boite.y + pointHaut.y * boite.height);
    await page.waitForTimeout(150);
    var inchange = await api('picked');
    check('cliquer une carte encore couverte ne la choisit pas',
          !!inchange && inchange.i === 24, JSON.stringify(inchange));

    /* ---------------------------------------------------------------- */
    t.section('Le paquet reste entier');
    /* Trois cents coups au hasard — retraits, pioches, annulations — en
       vérifiant après chacun que les cinquante-deux cartes sont là. */
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var partie = await page.evaluate(function () {
      var P = window.__neonPyramid;

      function valeur(c) { return (c >> 2) + 1; }
      function coups() {
        var s = P.snapshot(), out = [], a, b;
        var libres = s.free.map(function (i) { return { t: 'pyr', i: i, c: s.pyr[i] }; });
        if (s.waste.length) {
          libres.push({ t: 'waste', c: s.waste[s.waste.length - 1] });
        }
        for (a = 0; a < libres.length; a++) {
          // Le roi part seul : sans lui, la pyramide se bloque tout de suite.
          if (valeur(libres[a].c) === 13) { out.push([libres[a], null]); continue; }
          for (b = a + 1; b < libres.length; b++) {
            if (P.pairs(libres[a], libres[b])) { out.push([libres[a], libres[b]]); }
          }
        }
        return out;
      }

      var fautes = [], retires = 0, pioches = 0, annules = 0;
      for (var pas = 0; pas < 300; pas++) {
        var possibles = coups();
        var r = Math.random();
        if (possibles.length && r < 0.6) {
          var m = possibles[Math.floor(Math.random() * possibles.length)];
          P.remove(m[0], m[1]);
          retires++;
        } else if (r < 0.9) {
          P.drawCard();
          pioches++;
        } else {
          P.undo();
          annules++;
        }
        var toutes = P.allCards(), c = {}, ecart = toutes.length !== 52;
        toutes.forEach(function (x) { c[x] = (c[x] || 0) + 1; });
        Object.keys(c).forEach(function (k) { if (c[k] !== 1) { ecart = true; } });
        if (Object.keys(c).length !== 52) { ecart = true; }
        if (ecart) {
          fautes.push('pas ' + pas + ' : ' + toutes.length + ' cartes, ' +
                      Object.keys(c).length + ' distinctes');
          if (fautes.length > 3) { break; }
        }
      }
      var fin = P.snapshot();
      return { fautes: fautes, retires: retires, pioches: pioches, annules: annules,
               restantes: 28 - fin.cleared };
    });
    check('après chacun des 300 coups, les 52 cartes sont là, une fois chacune',
          partie.fautes.length === 0, partie.fautes.join(' | ') ||
          partie.retires + ' retraits, ' + partie.pioches + ' pioches, ' +
          partie.annules + ' annulations');
    check('la partie a réellement avancé', partie.retires > 15, partie.retires + ' retraits');

    t.section('L\'annulation rend l\'état exact');
    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var fidelite = await page.evaluate(function () {
      var P = window.__neonPyramid;
      function etat() {
        var s = P.snapshot();
        return JSON.stringify([s.gone, s.stock, s.waste, s.pass, s.score]);
      }
      var ecarts = 0, essais = 0;
      for (var i = 0; i < 40; i++) {
        var avant = etat();
        if (!P.drawCard()) { break; }
        essais++;
        P.undo();
        if (etat() !== avant) { ecarts++; }
      }
      return { ecarts: ecarts, essais: essais };
    });
    check('annuler une pioche rend l\'état au caractère près',
          fidelite.ecarts === 0 && fidelite.essais >= 20,
          fidelite.essais + ' essais, ' + fidelite.ecarts + ' écart(s)');

    /* ---------------------------------------------------------------- */
    t.section('Les donnes servies sont gagnables');
    /* Le solveur de la suite est écrit ici, à part du jeu : il ne partage avec
       lui que les règles, pas une ligne de code. Il explore les coups en
       mémorisant les positions déjà vues, et rend « gagnable » ou « non ». */
    var solveur = function () {
      window.__solvePyramid = function (pyr, stock, passes, plafond) {
        // `chemin` retient les coups choisis : la suite les rejoue ensuite dans
        // le jeu lui-même, pour que la preuve ne reste pas entre solveurs.
        var chemin = [];
        var CHILD = [];
        for (var r = 0; r < 7; r++) {
          var start = r * (r + 1) / 2, next = (r + 1) * (r + 2) / 2;
          for (var i = 0; i <= r; i++) {
            CHILD[start + i] = r === 6 ? null : [next + i, next + i + 1];
          }
        }
        var line = stock.slice().reverse();      // ordre de pioche
        var n = line.length;
        var val = function (c) { return (c >> 2) + 1; };
        var vu = {}, etats = 0;

        function libre(masque, i) {
          if (!(masque & (1 << i))) { return false; }
          var k = CHILD[i];
          if (!k) { return true; }
          return !(masque & (1 << k[0])) && !(masque & (1 << k[1]));
        }
        function nieme(sm, k) {
          var c = 0;
          for (var j = 0; j < n; j++) {
            if (sm & (1 << j)) { if (c === k) { return j; } c++; }
          }
          return -1;
        }
        function reste(sm) {
          var c = 0;
          for (var j = 0; j < n; j++) { if (sm & (1 << j)) { c++; } }
          return c;
        }
        function sommet(sm, pos) { return pos > 0 ? nieme(sm, pos - 1) : -1; }

        function go(masque, sm, pos, passe) {
          if (masque === 0) { return true; }
          if (++etats > plafond) { return false; }
          var cle = masque + '|' + sm + '|' + pos + '|' + passe;
          if (vu[cle]) { return false; }
          vu[cle] = 1;

          // Les rois s'en vont seuls : jamais un mauvais coup.
          var change = true;
          while (change) {
            change = false;
            for (var r2 = 0; r2 < 28; r2++) {
              if (libre(masque, r2) && val(pyr[r2]) === 13) { masque &= ~(1 << r2); change = true; }
            }
            var haut = sommet(sm, pos);
            if (haut >= 0 && val(line[haut]) === 13) { sm &= ~(1 << haut); pos--; change = true; }
          }
          if (masque === 0) { return true; }

          var ouvertes = [], i, j;
          for (i = 0; i < 28; i++) { if (libre(masque, i)) { ouvertes.push(i); } }
          for (i = 0; i < ouvertes.length; i++) {
            for (j = i + 1; j < ouvertes.length; j++) {
              if (val(pyr[ouvertes[i]]) + val(pyr[ouvertes[j]]) === 13) {
                chemin.push({ k: 'pp', i: ouvertes[i], j: ouvertes[j] });
                if (go(masque & ~(1 << ouvertes[i]) & ~(1 << ouvertes[j]), sm, pos, passe)) { return true; }
                chemin.pop();
              }
            }
          }
          var top = sommet(sm, pos);
          if (top >= 0) {
            for (i = 0; i < ouvertes.length; i++) {
              if (val(pyr[ouvertes[i]]) + val(line[top]) === 13) {
                chemin.push({ k: 'pw', i: ouvertes[i] });
                if (go(masque & ~(1 << ouvertes[i]), sm & ~(1 << top), pos - 1, passe)) { return true; }
                chemin.pop();
              }
            }
          }
          if (pos < reste(sm)) {
            chemin.push({ k: 'd' });
            if (go(masque, sm, pos + 1, passe)) { return true; }
            chemin.pop();
          } else if (passe + 1 < passes && reste(sm) > 0) {
            chemin.push({ k: 'd' });
            if (go(masque, sm, 0, passe + 1)) { return true; }
            chemin.pop();
          }
          return false;
        }

        var ok = go((1 << 28) - 1, (1 << n) - 1, 0, 0);
        return { ok: ok, etats: etats, chemin: ok ? chemin.slice() : [] };
      };
    };

    await page.goto(h.url('pyramid'));
    await page.waitForTimeout(300);
    // Une partie doit tourner : le rejeu plus bas passe par les coups du jeu,
    // que le menu refuserait.
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await page.evaluate(solveur);

    // D'abord : le solveur sait dire non. Une pyramide de vingt-huit deux ne
    // peut jamais faire treize, quelle que soit la pioche.
    var refus = await page.evaluate(function (plan) {
      return window.__solvePyramid(plan, [4, 5, 6, 7], 3, 200000);
    }, neutre());
    check('le solveur refuse une pyramide sans issue', refus.ok === false);

    var tables = await api('deals');
    var attendus = { easy: 3, normal: 2, hard: 1 };
    for (var mode in attendus) {
      if (!Object.prototype.hasOwnProperty.call(attendus, mode)) { continue; }
      var liste = tables[mode];
      check(mode + ' : la table est fournie', !!liste && liste.length >= 100,
            liste ? liste.length + ' donnes' : 'absente');
      var verdict = await page.evaluate(function (job) {
        var P = window.__neonPyramid;
        var perdues = [], plafonnees = 0;
        for (var k = 0; k < job.seeds.length; k++) {
          P.dealSeed(job.seeds[k]);
          var s = P.snapshot();
          var r = window.__solvePyramid(s.pyr, s.stock, job.passes, 400000);
          if (!r.ok) {
            if (r.etats > 400000) { plafonnees++; }
            else { perdues.push(job.seeds[k]); }
          }
        }
        return { perdues: perdues, plafonnees: plafonnees };
      }, { seeds: liste, passes: attendus[mode] });
      check(mode + ' : les ' + liste.length + ' donnes servies sont gagnables en ' +
            attendus[mode] + ' passe(s)',
            verdict.perdues.length === 0 && verdict.plafonnees === 0,
            verdict.perdues.length ? 'perdues : ' + verdict.perdues.slice(0, 5).join(',')
                                   : verdict.plafonnees + ' plafonnée(s)');
    }

    /* ---------------------------------------------------------------- */
    t.section('Une donne se gagne réellement dans le jeu');
    /* La preuve la plus forte : reprendre le chemin trouvé par le solveur et le
       rejouer coup par coup dans le jeu, par sa propre interface. Si le jeu et
       le solveur divergeaient d'une règle, la pyramide ne tomberait pas. */
    var rejeu = await page.evaluate(function (job) {
      var P = window.__neonPyramid;
      var out = [];
      for (var m = 0; m < job.length; m++) {
        var mode = job[m][0], graine = job[m][1], passes = job[m][2];
        P.dealSeed(graine);
        var depart = P.snapshot();
        var sol = window.__solvePyramid(depart.pyr, depart.stock, passes, 400000);
        if (!sol.ok) { out.push({ mode: mode, graine: graine, souci: 'insoluble' }); continue; }

        function valeur(c) { return (c >> 2) + 1; }
        // Les rois s'en vont seuls, comme dans le solveur.
        function rois() {
          var encore = true;
          while (encore) {
            encore = false;
            var s = P.snapshot(), k;
            for (k = 0; k < s.free.length; k++) {
              if (valeur(s.pyr[s.free[k]]) !== 13) { continue; }
              // `encore` ne se rallume que sur un retrait réellement accepté :
              // sinon un refus du jeu ferait tourner cette boucle sans fin.
              if (P.remove({ t: 'pyr', i: s.free[k] })) { encore = true; }
            }
            s = P.snapshot();
            if (s.waste.length && valeur(s.waste[s.waste.length - 1]) === 13) {
              if (P.remove({ t: 'waste' })) { encore = true; }
            }
          }
        }

        var refus = 0;
        rois();
        for (var c = 0; c < sol.chemin.length; c++) {
          var coup = sol.chemin[c], fait;
          if (coup.k === 'pp') { fait = P.remove({ t: 'pyr', i: coup.i }, { t: 'pyr', i: coup.j }); }
          else if (coup.k === 'pw') { fait = P.remove({ t: 'waste' }, { t: 'pyr', i: coup.i }); }
          else { fait = P.drawCard(); }
          if (!fait) { refus++; break; }
          rois();
        }
        var fin = P.snapshot();
        out.push({ mode: mode, graine: graine, refus: refus, coups: sol.chemin.length,
                   restantes: 28 - fin.cleared, gagnee: fin.complete, score: fin.score });
      }
      return out;
    }, [['easy', tables.easy[0], 3], ['easy', tables.easy[97], 3],
        ['normal', tables.normal[42], 2], ['hard', tables.hard[0], 1],
        ['hard', tables.hard[61], 1]]);

    rejeu.forEach(function (r) {
      check(r.mode + ' : la donne ' + r.graine + ' tombe entièrement, jouée dans le jeu',
            r.gagnee === true && !r.refus && !r.souci,
            r.souci || (r.refus ? 'un coup refusé par le jeu' :
                        r.restantes + ' carte(s) restée(s) sur 28'));
    });
    check('la victoire est bien marquée', rejeu.every(function (r) { return r.score > 400; }),
          rejeu.map(function (r) { return r.score; }).join(', '));

    /* Et la mesure qui justifie la table : sur des donnes tirées au hasard, la
       proportion de gagnables s'effondre. C'est pour cela que le jeu ne tire
       pas au hasard. */
    var hasard = await page.evaluate(function () {
      var P = window.__neonPyramid;
      var gagnables = 0, sures = 0;
      for (var n = 900001; n <= 900060; n++) {
        P.dealSeed(n);
        var s = P.snapshot();
        var r = window.__solvePyramid(s.pyr, s.stock, 1, 150000);
        if (r.etats <= 150000) { sures++; if (r.ok) { gagnables++; } }
      }
      return { gagnables: gagnables, sures: sures };
    });
    check('une pyramide tirée au hasard n\'est presque jamais gagnable en une passe',
          hasard.sures >= 40 && hasard.gagnables * 5 < hasard.sures,
          hasard.gagnables + ' gagnables sur ' + hasard.sures + ' tranchées');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
