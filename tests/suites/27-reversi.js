'use strict';

var harness = require('../lib/harness');

/* Neon Reversi : l'othello. Trois choses s'y vérifient mal à l'œil.

   La première est le bord du plateau. Le plateau tient dans un tableau de
   soixante-quatre cases, et un pas vers la droite y est « +1 » — ce qui, depuis
   la dernière colonne, tombe sur la première de la ligne suivante. C'est le
   défaut classique de cette représentation : une ligne de pions retournée d'un
   bord à l'autre du plateau.

   La deuxième est le passe : quand un camp ne peut plus poser, l'autre rejoue,
   et la partie ne s'arrête que si plus personne ne peut.

   La troisième est la force de l'adversaire, qui ne se voit pas dans le code.
   La suite embarque donc son propre solveur de fin de partie, écrit à part, et
   vérifie que le coup choisi par le jeu atteint bien le meilleur écart final
   possible — puis le fait jouer des parties entières pour mesurer qu'il gagne. */

module.exports = {
  name: 'Neon Reversi — bords, passes et fins de partie calculées',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonReversi.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonReversi[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var idx = function (x, y) { return y * 8 + x; };
    var vide = function () { return new Array(64).fill(0); };
    var poser = function (cells, who) {
      return page.evaluate(function (b) {
        window.__neonReversi.setBoard(b.cells, b.who);
      }, { cells: cells, who: who || 'you' });
    };

    /* ---------------------------------------------------------------- */
    t.section('L\'ouverture');
    await page.goto(h.url('reversi'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Reversi/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);

    var s = await snap();
    check('quatre pions au centre, deux par camp', s.you === 2 && s.ai === 2,
          s.you + ' / ' + s.ai);
    check('soixante cases vides', s.empties === 60, s.empties);
    check('quatre coups d\'ouverture', s.legal.length === 4, s.legal.join(','));
    check('et ce sont les quatre cases attendues',
          s.legal.slice().sort(function (a, b) { return a - b; }).join(',') === '20,29,34,43',
          s.legal.join(','));

    /* ---------------------------------------------------------------- */
    t.section('Encadrer, en ligne comme en diagonale');
    var b = vide();
    b[idx(2, 3)] = 1; b[idx(3, 3)] = 2; b[idx(4, 3)] = 2;   // toi, lui, lui, vide
    await poser(b);
    check('une ligne encadrée se retourne',
          (await api('flipsFor', idx(5, 3), 'you')).length === 2,
          JSON.stringify(await api('flipsFor', idx(5, 3), 'you')));
    check('mais pas si rien ne ferme la ligne',
          (await api('flipsFor', idx(1, 3), 'you')).length === 0);

    b = vide();
    b[idx(2, 2)] = 1; b[idx(3, 3)] = 2; b[idx(4, 4)] = 2;
    await poser(b);
    check('une diagonale encadrée se retourne aussi',
          (await api('flipsFor', idx(5, 5), 'you')).length === 2,
          JSON.stringify(await api('flipsFor', idx(5, 5), 'you')));

    // Quatre directions d'un coup, autour d'une même case.
    b = vide();
    b[idx(4, 2)] = 2; b[idx(4, 1)] = 1;      // vers le haut
    b[idx(4, 4)] = 2; b[idx(4, 5)] = 1;      // vers le bas
    b[idx(3, 3)] = 2; b[idx(2, 3)] = 1;      // vers la gauche
    b[idx(5, 3)] = 2; b[idx(6, 3)] = 1;      // vers la droite
    await poser(b);
    check('un coup retourne toutes les directions à la fois',
          (await api('flipsFor', idx(4, 3), 'you')).length === 4,
          JSON.stringify(await api('flipsFor', idx(4, 3), 'you')));

    b = vide();
    b[idx(3, 3)] = 1;
    await poser(b);
    check('une case occupée ne se joue pas',
          (await api('flipsFor', idx(3, 3), 'you')).length === 0);
    check('et un coup qui ne retourne rien est illégal',
          (await api('legalFor', 'you')).length === 0,
          JSON.stringify(await api('legalFor', 'you')));

    /* ---------------------------------------------------------------- */
    t.section('Le bord du plateau n\'est pas un passage');
    /* Le piège : dans un tableau à plat, la case 7 (dernière colonne) et la
       case 8 (première colonne de la ligne suivante) sont voisines. Elles ne le
       sont pas sur le plateau. */
    b = vide();
    b[idx(0, 1)] = 2;      // case 8
    b[idx(1, 1)] = 1;      // case 9
    await poser(b);
    check('un pas à droite depuis la dernière colonne ne franchit pas le bord',
          (await api('flipsFor', idx(7, 0), 'you')).length === 0,
          JSON.stringify(await api('flipsFor', idx(7, 0), 'you')));

    b = vide();
    b[idx(7, 1)] = 2;      // case 15
    b[idx(6, 1)] = 1;      // case 14
    await poser(b);
    check('ni un pas à gauche depuis la première colonne',
          (await api('flipsFor', idx(0, 2), 'you')).length === 0,
          JSON.stringify(await api('flipsFor', idx(0, 2), 'you')));

    b = vide();
    b[idx(0, 2)] = 2;      // case 16
    b[idx(1, 3)] = 1;      // case 25
    await poser(b);
    check('ni une diagonale qui repartirait de l\'autre côté',
          (await api('flipsFor', idx(7, 1), 'you')).length === 0,
          JSON.stringify(await api('flipsFor', idx(7, 1), 'you')));

    // Et la vraie ligne de bord, elle, fonctionne : sept cases d'affilée.
    b = vide();
    for (var x = 1; x <= 6; x++) { b[idx(x, 0)] = 2; }
    b[idx(7, 0)] = 1;
    await poser(b);
    check('une ligne entière sur le bord se retourne bien',
          (await api('flipsFor', idx(0, 0), 'you')).length === 6,
          (await api('flipsFor', idx(0, 0), 'you')).length + ' pions');

    /* ---------------------------------------------------------------- */
    t.section('Passer son tour');
    /* Une position où l'adversaire n'a aucun coup. Elle tient au bord : ton
       unique pion est collé contre lui, si bien qu'aucune case vide ne peut
       l'encadrer contre un pion adverse — alors que toi, tu fermes la ligne par
       la droite. */
    b = vide();
    b[idx(0, 3)] = 1;                       // ton pion, contre le bord gauche
    b[idx(1, 3)] = 2; b[idx(2, 3)] = 2;     // les siens, à sa droite
    await poser(b, 'you');
    check('l\'adversaire n\'a aucun coup', (await api('hasMove', 'ai')) === false);
    check('mais toi si', (await api('hasMove', 'you')) === true);
    await api('advance');
    await page.waitForTimeout(200);
    var apresPasse = await snap();
    check('il passe, et c\'est encore à toi', apresPasse.turn === 'you', apresPasse.turn);
    check('le passe est annoncé', apresPasse.passed === 'ai', String(apresPasse.passed));

    /* ---------------------------------------------------------------- */
    t.section('Le plateau ne perd jamais un pion');
    /* Soixante parties jouées au hasard de bout en bout, en vérifiant après
       chaque coup qu'un pion a été ajouté, qu'aucun n'a disparu, et que la
       partie se termine. C'est le défaut invisible d'un jeu de retournement :
       un pion oublié dans une direction, ou compté deux fois. */
    var hasard = await page.evaluate(function () {
      var R = window.__neonReversi;
      var fautes = [], parties = 0, coupsTotal = 0, finales = [];

      for (var p = 0; p < 60; p++) {
        var plateau = new Array(64).fill(0);
        plateau[27] = 1; plateau[36] = 1; plateau[28] = 2; plateau[35] = 2;
        R.setBoard(plateau, 'you');
        var camp = 'you', passes = 0, coups = 0;

        while (passes < 2 && coups < 70) {
          var avant = R.snapshot();
          var options = R.legalFor(camp);
          if (!options.length) {
            passes++;
            camp = camp === 'you' ? 'ai' : 'you';
            continue;
          }
          passes = 0;
          var choix = options[Math.floor(Math.random() * options.length)];
          var attendus = R.flipsFor(choix, camp).length;
          R.force(choix, camp);
          coups++;
          var apres = R.snapshot();

          if (apres.board[choix] !== (camp === 'you' ? 1 : 2)) {
            fautes.push('partie ' + p + ' : la case jouée n\'a pas la bonne couleur');
          }
          if (apres.empties !== avant.empties - 1) {
            fautes.push('partie ' + p + ' : ' + (avant.empties - apres.empties) +
                        ' case(s) remplie(s) au lieu d\'une');
          }
          if (apres.you + apres.ai !== avant.you + avant.ai + 1) {
            fautes.push('partie ' + p + ' : le total des pions a bougé de ' +
                        (apres.you + apres.ai - avant.you - avant.ai));
          }
          var gagnes = camp === 'you' ? apres.you - avant.you : apres.ai - avant.ai;
          if (gagnes !== attendus + 1) {
            fautes.push('partie ' + p + ' : ' + gagnes + ' pions gagnés au lieu de ' +
                        (attendus + 1));
          }
          if (apres.you + apres.ai + apres.empties !== 64) {
            fautes.push('partie ' + p + ' : le plateau ne fait plus 64 cases');
          }
          if (fautes.length > 3) { break; }
          camp = camp === 'you' ? 'ai' : 'you';
        }
        if (coups >= 70) { fautes.push('partie ' + p + ' : elle ne s\'est jamais terminée'); }
        var fin = R.snapshot();
        finales.push(fin.you + fin.ai);
        parties++;
        coupsTotal += coups;
        if (fautes.length > 3) { break; }
      }
      return { fautes: fautes, parties: parties, coups: coupsTotal, finales: finales };
    });
    check('soixante parties au hasard : aucun pion perdu ni inventé',
          hasard.fautes.length === 0,
          hasard.fautes.join(' | ') || hasard.parties + ' parties, ' + hasard.coups + ' coups');
    check('chacune va jusqu\'au bout', hasard.parties === 60, hasard.parties);
    check('et le plateau finit rempli, ou bloqué avant',
          hasard.finales.every(function (n) { return n >= 40 && n <= 64; }),
          Math.min.apply(null, hasard.finales) + ' à ' + Math.max.apply(null, hasard.finales) + ' pions');

    /* ---------------------------------------------------------------- */
    t.section('L\'adversaire ne joue que des coups légaux');
    var legalite = await page.evaluate(function () {
      var R = window.__neonReversi;
      var fautes = 0, essais = 0;
      for (var p = 0; p < 15; p++) {
        var plateau = new Array(64).fill(0);
        plateau[27] = 1; plateau[36] = 1; plateau[28] = 2; plateau[35] = 2;
        R.setBoard(plateau, 'ai');
        for (var c = 0; c < 20; c++) {
          var options = R.legalFor('ai');
          if (!options.length) { break; }
          var choix = R.aiMove();
          essais++;
          if (options.indexOf(choix) === -1) { fautes++; break; }
          R.force(choix, 'ai');
          var reponses = R.legalFor('you');
          if (!reponses.length) { continue; }
          R.force(reponses[Math.floor(Math.random() * reponses.length)], 'you');
        }
      }
      return { fautes: fautes, essais: essais };
    });
    check('sur ' + legalite.essais + ' coups choisis, aucun n\'est illégal',
          legalite.fautes === 0, legalite.fautes + ' coup(s) illégal(aux)');

    /* ---------------------------------------------------------------- */
    t.section('La fin de partie est calculée, pas devinée');
    /* Le solveur de la suite est écrit ici, indépendamment du jeu : il explore
       toutes les fins possibles et rend le meilleur écart final atteignable.
       En difficile, le coup choisi par le jeu doit atteindre cet écart. */
    await page.goto(h.url('reversi'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);

    var exact = await page.evaluate(function () {
      var R = window.__neonReversi;
      var DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];

      function retournes(b, i, disc) {
        if (b[i] !== 0) { return []; }
        var foe = disc === 1 ? 2 : 1, out = [];
        for (var d = 0; d < DIRS.length; d++) {
          var pas = DIRS[d], ligne = [], at = i, col = i % 8;
          for (;;) {
            var n = at + pas;
            if (n < 0 || n > 63) { break; }
            var nc = n % 8;
            if (pas !== -8 && pas !== 8 && Math.abs(nc - col) !== 1) { break; }
            if (b[n] === foe) { ligne.push(n); at = n; col = nc; continue; }
            if (b[n] === disc && ligne.length) { out = out.concat(ligne); }
            break;
          }
        }
        return out;
      }
      function coups(b, disc) {
        var out = [];
        for (var i = 0; i < 64; i++) { if (b[i] === 0 && retournes(b, i, disc).length) { out.push(i); } }
        return out;
      }
      function compte(b, disc) {
        var n = 0;
        for (var i = 0; i < 64; i++) { if (b[i] === disc) { n++; } }
        return n;
      }
      /* Meilleur écart final pour `disc`, en jeu parfait des deux côtés.
         L'élagage alpha-bêta ne change pas le résultat, seulement le temps : la
         fenêtre reste complète à la racine, donc chaque valeur rendue là est
         exacte. */
      function resoudre(b, disc, passe, alpha, beta) {
        var options = coups(b, disc);
        if (!options.length) {
          if (passe) { return compte(b, disc) - compte(b, disc === 1 ? 2 : 1); }
          return -resoudre(b, disc === 1 ? 2 : 1, true, -beta, -alpha);
        }
        var meilleur = -Infinity;
        for (var k = 0; k < options.length; k++) {
          var i = options[k], flips = retournes(b, i, disc), j;
          b[i] = disc;
          for (j = 0; j < flips.length; j++) { b[flips[j]] = disc; }
          var v = -resoudre(b, disc === 1 ? 2 : 1, false, -beta, -alpha);
          b[i] = 0;
          for (j = 0; j < flips.length; j++) { b[flips[j]] = disc === 1 ? 2 : 1; }
          if (v > meilleur) { meilleur = v; }
          if (meilleur > alpha) { alpha = meilleur; }
          if (alpha >= beta) { break; }
        }
        return meilleur;
      }

      var resultats = [];
      var essais = 0;
      while (resultats.length < 12 && essais < 400) {
        essais++;
        // Une position atteinte au hasard, jusqu'à ce qu'il reste peu de vides.
        var plateau = new Array(64).fill(0);
        plateau[27] = 1; plateau[36] = 1; plateau[28] = 2; plateau[35] = 2;
        var camp = 1, passes = 0, garde = 0;
        while (passes < 2 && garde++ < 70) {
          var vides = compte(plateau, 0);
          if (vides <= 10 && camp === 2 && coups(plateau, 2).length > 1) { break; }
          var o = coups(plateau, camp);
          if (!o.length) { passes++; camp = camp === 1 ? 2 : 1; continue; }
          passes = 0;
          var m = o[Math.floor(Math.random() * o.length)];
          var f = retournes(plateau, m, camp);
          plateau[m] = camp;
          for (var q = 0; q < f.length; q++) { plateau[f[q]] = camp; }
          camp = camp === 1 ? 2 : 1;
        }
        var restant = compte(plateau, 0);
        if (restant > 10 || restant === 0) { continue; }
        var possibles = coups(plateau, 2);
        if (possibles.length < 2) { continue; }

        // Le meilleur écart atteignable, calculé ici.
        var ideal = -Infinity, par = {};
        for (var z = 0; z < possibles.length; z++) {
          var i2 = possibles[z], fl = retournes(plateau, i2, 2), w;
          plateau[i2] = 2;
          for (w = 0; w < fl.length; w++) { plateau[fl[w]] = 2; }
          var val = -resoudre(plateau, 1, false, -64, 64);
          plateau[i2] = 0;
          for (w = 0; w < fl.length; w++) { plateau[fl[w]] = 1; }
          par[i2] = val;
          if (val > ideal) { ideal = val; }
        }

        // Et celui que le jeu choisit.
        R.setBoard(plateau, 'ai');
        var choix = R.aiMove();
        resultats.push({ vides: restant, ideal: ideal, obtenu: par[choix],
                         choix: choix, options: possibles.length });
      }
      return resultats;
    });
    check('douze fins de partie construites', exact.length === 12, exact.length);
    var rates = exact.filter(function (r) { return r.obtenu !== r.ideal; });
    check('sur chacune, le coup choisi atteint le meilleur écart final possible',
          rates.length === 0,
          rates.length ? rates.map(function (r) {
            return r.vides + ' vides : ' + r.obtenu + ' au lieu de ' + r.ideal;
          }).join(' | ') : exact.map(function (r) { return r.vides; }).join(',') + ' cases vides');
    check('et les positions offraient un vrai choix',
          exact.every(function (r) { return r.options >= 2; }));

    /* ---------------------------------------------------------------- */
    t.section('Il joue mieux que le hasard');
    var force = await page.evaluate(function () {
      var R = window.__neonReversi;
      var victoires = 0, nuls = 0, defaites = 0;
      for (var p = 0; p < 20; p++) {
        var plateau = new Array(64).fill(0);
        plateau[27] = 1; plateau[36] = 1; plateau[28] = 2; plateau[35] = 2;
        R.setBoard(plateau, 'ai');
        var camp = 'ai', passes = 0, garde = 0;
        while (passes < 2 && garde++ < 70) {
          var options = R.legalFor(camp);
          if (!options.length) { passes++; camp = camp === 'ai' ? 'you' : 'ai'; continue; }
          passes = 0;
          if (camp === 'ai') {
            R.setTurn('ai');
            R.force(R.aiMove(), 'ai');
          } else {
            R.force(options[Math.floor(Math.random() * options.length)], 'you');
          }
          camp = camp === 'ai' ? 'you' : 'ai';
        }
        var fin = R.snapshot();
        if (fin.ai > fin.you) { victoires++; }
        else if (fin.ai === fin.you) { nuls++; }
        else { defaites++; }
      }
      return { victoires: victoires, nuls: nuls, defaites: defaites };
    });
    check('en difficile, il gagne au moins dix-huit parties sur vingt contre le hasard',
          force.victoires >= 18,
          force.victoires + ' victoires, ' + force.nuls + ' nuls, ' + force.defaites + ' défaites');

    /* ---------------------------------------------------------------- */
    t.section('Jouer pour de vrai');
    await page.goto(h.url('reversi'));
    await page.waitForTimeout(400);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);
    var ouverture = await snap();
    var boite = await page.locator('#board').boundingBox();
    var cible = await api('cellRatio', ouverture.legal[0]);
    await page.mouse.click(boite.x + cible.x * boite.width, boite.y + cible.y * boite.height);
    await page.waitForTimeout(1400);
    var joue = await snap();
    check('cliquer une case jouable pose un pion, et l\'adversaire répond',
          joue.moves === 2, joue.moves + ' coup(s)');
    check('le score a bougé', joue.score > 0, joue.score);

    // Une case interdite ne fait rien.
    var interdite = 0;
    while ((await snap()).legal.indexOf(interdite) >= 0 || (await snap()).board[interdite] !== 0) {
      interdite++;
    }
    var avantClic = (await snap()).moves;
    var pointNon = await api('cellRatio', interdite);
    await page.mouse.click(boite.x + pointNon.x * boite.width, boite.y + pointNon.y * boite.height);
    await page.waitForTimeout(300);
    check('cliquer une case interdite ne pose rien', (await snap()).moves === avantClic,
          (await snap()).moves);

    t.section('Le mode zen annule');
    await page.goto(h.url('reversi'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var avantZen = await snap();
    await api('play', avantZen.legal[0]);
    await page.waitForTimeout(1200);
    check('un coup a été joué, et la réponse aussi', (await snap()).moves >= 1);
    check('l\'annulation passe', (await api('undo')) === true);
    var apresUndo = await snap();
    check('le plateau revient à l\'ouverture',
          apresUndo.you === 2 && apresUndo.ai === 2 && apresUndo.empties === 60,
          apresUndo.you + ' / ' + apresUndo.ai + ', ' + apresUndo.empties + ' vides');
    check('et c\'est de nouveau à toi', apresUndo.turn === 'you', apresUndo.turn);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
