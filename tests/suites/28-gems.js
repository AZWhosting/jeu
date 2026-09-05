'use strict';

var harness = require('../lib/harness');

/* Neon Gems : l'alignement en cascade. Ce qui se vérifie mal à l'œil ici, ce
   n'est pas la règle — trois gemmes identiques, tout le monde voit — mais les
   deux garanties silencieuses sur lesquelles repose le jeu.

   La première : un plateau servi ne doit contenir aucun alignement tout fait,
   sinon la partie commence en marquant des points sans que le joueur ait rien
   fait. La seconde : il doit toujours rester au moins un échange possible,
   sinon la grille est morte et le joueur cherche indéfiniment. La suite les
   éprouve sur des dizaines de plateaux neufs, puis pendant des parties
   entières, en vérifiant après chaque coup.

   Le reste — la chute, la cascade, la gemme chargée — se teste sur des plateaux
   posés à la main, où l'on sait exactement ce qui doit disparaître. */

module.exports = {
  name: 'Neon Gems — plateaux vivants, chute, cascade et gemmes chargées',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonGems.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonGems[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var at = function (x, y) { return y * 8 + x; };

    /* Un fond sans le moindre alignement : la couleur suit (x + 2y) mod 4, qui
       ne donne jamais trois cases identiques de suite, ni en ligne ni en
       colonne. On y pose ensuite ce qu'on veut éprouver. */
    var fond = function () {
      var out = [];
      for (var y = 0; y < 8; y++) {
        for (var x = 0; x < 8; x++) { out.push((x + 2 * y) % 4); }
      }
      return out;
    };
    var poser = function (cells, marks) {
      return page.evaluate(function (b) {
        window.__neonGems.setBoard(b.cells, b.marks || null);
      }, { cells: cells, marks: marks });
    };

    /* ---------------------------------------------------------------- */
    t.section('Le plateau servi est vivant');
    await page.goto(h.url('gems'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Gems/.test(await page.title()), await page.title());
    await page.click('.choice[data-diff="hard"]');      // sept couleurs : le cas le plus tendu
    await page.click('#playBtn');
    await page.waitForTimeout(250);

    var depart = await snap();
    check('sept couleurs en difficile', depart.colors === 7, depart.colors);
    check('soixante-quatre gemmes posées', depart.grid.length === 64 &&
          depart.grid.every(function (c) { return c >= 0 && c < 7; }),
          depart.grid.filter(function (c) { return c < 0 || c > 6; }).length + ' hors bornes');

    var distributions = await page.evaluate(function () {
      var G = window.__neonGems;
      var fautes = [], couleurs = {};
      for (var d = 0; d < 40; d++) {
        document.getElementById('restartBtn').click();
        var s = G.snapshot();
        if (s.runs.length) { fautes.push('donne ' + d + ' : ' + s.runs.length + ' alignement(s) tout faits'); }
        if (!s.move) { fautes.push('donne ' + d + ' : aucun échange possible'); }
        s.grid.forEach(function (c) { couleurs[c] = true; });
        if (fautes.length > 3) { break; }
      }
      return { fautes: fautes, couleurs: Object.keys(couleurs).length };
    });
    check('quarante plateaux neufs : aucun alignement tout fait, et toujours un coup',
          distributions.fautes.length === 0, distributions.fautes.join(' | ') || '40 donnes');
    check('les sept couleurs sont bien servies', distributions.couleurs === 7,
          distributions.couleurs);

    /* ---------------------------------------------------------------- */
    t.section('Ce qui compte comme alignement');
    var b = fond();
    b[at(2, 4)] = 6; b[at(3, 4)] = 6; b[at(4, 4)] = 6;
    await poser(b);
    var runs = await api('findRuns');
    check('trois gemmes en ligne font un alignement',
          runs.length === 1 && runs[0].length === 3, JSON.stringify(runs));

    b = fond();
    b[at(5, 2)] = 6; b[at(5, 3)] = 6; b[at(5, 4)] = 6;
    await poser(b);
    runs = await api('findRuns');
    check('trois gemmes en colonne aussi',
          runs.length === 1 && runs[0].length === 3, JSON.stringify(runs));

    b = fond();
    b[at(2, 4)] = 6; b[at(3, 4)] = 6;
    await poser(b);
    check('deux, non', (await api('findRuns')).length === 0);
    check('et une diagonale non plus',
          await page.evaluate(function () {
            var c = [];
            for (var y = 0; y < 8; y++) { for (var x = 0; x < 8; x++) { c.push((x + 2 * y) % 4); } }
            c[0] = 6; c[9] = 6; c[18] = 6;
            window.__neonGems.setBoard(c);
            return window.__neonGems.findRuns().length;
          }) === 0);

    // L'échange n'est permis que s'il aligne quelque chose.
    b = fond();
    b[at(1, 4)] = 6; b[at(2, 4)] = 6; b[at(4, 4)] = 6; b[at(4, 3)] = 5;
    b[at(3, 3)] = 6;                     // à descendre en (3,4) pour compléter
    await poser(b);
    check('un échange qui aligne trois gemmes est permis',
          (await api('swapWorks', at(3, 3), at(3, 4))) === true);
    check('un échange qui n\'aligne rien est refusé',
          (await api('swapWorks', at(0, 0), at(1, 0))) === false);
    check('et deux gemmes qui ne se touchent pas ne s\'échangent pas',
          (await api('swapWorks', at(0, 0), at(4, 4))) === false);

    var avantRefus = await snap();
    check('un échange refusé ne consomme rien',
          (await api('swapNow', at(0, 0), at(1, 0))) === 0);
    var apresRefus = await snap();
    check('ni coup, ni point', apresRefus.moves === avantRefus.moves &&
          apresRefus.score === avantRefus.score,
          apresRefus.moves + ' coups, ' + apresRefus.score + ' points');

    /* ---------------------------------------------------------------- */
    t.section('La chute');
    /* Colonne 0 : trois gemmes identiques en bas, deux repères au-dessus. Après
       le retrait, les repères doivent s'être posés tout en bas, dans l'ordre. */
    b = fond();
    b[at(0, 5)] = 6; b[at(0, 6)] = 6; b[at(0, 7)] = 6;
    b[at(0, 3)] = 5; b[at(0, 4)] = 4;
    await poser(b);
    check('l\'alignement du bas est bien vu', (await api('findRuns')).length === 1);
    await api('stepCascade');
    var tombe = await snap();
    check('les gemmes du dessus sont descendues de trois rangs, dans l\'ordre',
          tombe.grid[at(0, 7)] === 4 && tombe.grid[at(0, 6)] === 5,
          'bas ' + tombe.grid[at(0, 7)] + ', au-dessus ' + tombe.grid[at(0, 6)]);
    check('et le haut de la colonne a été regarni',
          tombe.grid.every(function (c) { return c >= 0; }),
          tombe.grid.filter(function (c) { return c < 0; }).length + ' case(s) vide(s)');

    /* ---------------------------------------------------------------- */
    t.section('La cascade paie plus cher');
    /* Le piège de ce test est d'aligner par avance ce qui doit ne s'aligner
       qu'après la chute : la position de départ ne doit contenir qu'un seul
       alignement. Ici, une colonne de trois en bas à gauche ; quand elle part,
       la gemme posée juste au-dessus tombe de trois rangs et rejoint deux
       autres, déjà en place sur la dernière rangée. */
    var cascade = await page.evaluate(function () {
      var G = window.__neonGems;
      var c = [];
      for (var y = 0; y < 8; y++) { for (var x = 0; x < 8; x++) { c.push((x + 2 * y) % 4); } }
      c[5 * 8] = 6; c[6 * 8] = 6; c[7 * 8] = 6;   // colonne de trois, en bas à gauche
      c[4 * 8] = 5;                                // tombera en (0,7)
      c[7 * 8 + 1] = 5; c[7 * 8 + 2] = 5;          // l'y attendent déjà
      G.setBoard(c);
      var avant = G.snapshot();
      var maillons = 0;
      while (G.stepCascade()) { maillons++; if (maillons > 10) { break; } }
      var apres = G.snapshot();
      return { maillons: maillons, gemmes: apres.gems - avant.gems,
               points: apres.score - avant.score, meilleure: apres.bestChain,
               depart: avant.runs.length };
    });
    check('la position de départ ne contient qu\'un seul alignement',
          cascade.depart === 1, cascade.depart + ' alignement(s)');
    check('la chute relance l\'alignement : au moins deux maillons',
          cascade.maillons >= 2, cascade.maillons + ' maillon(s)');
    check('et la plus longue cascade est retenue', cascade.meilleure >= 2, cascade.meilleure);
    check('le deuxième maillon vaut double : plus de 10 points par gemme',
          cascade.points > cascade.gemmes * 10,
          cascade.points + ' points pour ' + cascade.gemmes + ' gemmes');

    /* ---------------------------------------------------------------- */
    t.section('La gemme chargée');
    b = fond();
    b[at(2, 4)] = 6; b[at(3, 4)] = 6; b[at(4, 4)] = 6; b[at(5, 4)] = 6;
    await poser(b);
    check('un alignement de quatre est bien vu',
          (await api('findRuns'))[0].length === 4);
    var avantCharge = await snap();
    await api('stepCascade');
    var chargee = await snap();
    var marquees = chargee.charged.map(function (v, i) { return v ? i : -1; })
                                 .filter(function (i) { return i >= 0; });
    check('il laisse exactement une gemme chargée', marquees.length === 1,
          marquees.length + ' : ' + marquees.join(','));
    check('elle est restée sur la ligne de l\'alignement',
          marquees.length === 1 && Math.floor(marquees[0] / 8) === 4,
          marquees.length ? 'rangée ' + Math.floor(marquees[0] / 8) : '—');
    check('et trois gemmes seulement sont parties',
          chargee.gems - avantCharge.gems === 3, chargee.gems - avantCharge.gems);
    check('le compteur de gemmes chargées a bougé',
          chargee.chargedMade === avantCharge.chargedMade + 1, chargee.chargedMade);

    // Une chargée prise dans un alignement emporte sa ligne et sa colonne.
    var explosion = await page.evaluate(function () {
      var G = window.__neonGems;
      var c = [], m = [];
      for (var y = 0; y < 8; y++) { for (var x = 0; x < 8; x++) { c.push((x + 2 * y) % 4); m.push(false); } }
      c[3 * 8 + 2] = 6; c[3 * 8 + 3] = 6; c[3 * 8 + 4] = 6;   // alignement de trois
      m[3 * 8 + 3] = true;                                     // dont la gemme du milieu est chargée
      G.setBoard(c, m);
      var avant = G.snapshot();
      G.stepCascade();
      var apres = G.snapshot();
      return { gemmes: apres.gems - avant.gems, explosions: apres.blasts - avant.blasts,
               alignements: avant.runs.length };
    });
    check('la position de départ ne contient qu\'un alignement',
          explosion.alignements === 1, explosion.alignements);
    check('la chargée emporte sa ligne et sa colonne : quinze gemmes',
          explosion.gemmes === 15, explosion.gemmes + ' gemmes');
    check('et l\'explosion est comptée', explosion.explosions === 1, explosion.explosions);

    /* ---------------------------------------------------------------- */
    t.section('Un plateau mort se remélange');
    /* Une grille sans le moindre échange possible : quatre couleurs en damier
       décalé d'une ligne sur deux, où aucun voisin échangé n'aligne rien. */
    var mort = await page.evaluate(function () {
      var G = window.__neonGems;
      /* Une grille morte ne se rencontre pas au hasard : on en fabrique une.
         On part d'un tirage quelconque, et tant qu'il reste un alignement ou un
         échange possible, on repeint une des cases fautives. Chaque retouche
         rapproche du but, et la grille finit par n'offrir plus rien. */
      var c = [];
      for (var i = 0; i < 64; i++) { c.push(Math.floor(Math.random() * 7)); }
      function repeindre(cell) {
        c[cell] = (c[cell] + 1 + Math.floor(Math.random() * 6)) % 7;
      }
      var trouvee = null;
      for (var essai = 0; essai < 3000 && !trouvee; essai++) {
        G.setBoard(c);
        var runs = G.findRuns();
        if (runs.length) { repeindre(runs[0][Math.floor(Math.random() * runs[0].length)]); continue; }
        var echange = G.anySwap();
        if (!echange) { trouvee = c.slice(); break; }
        repeindre(echange[Math.floor(Math.random() * 2)]);
      }
      if (!trouvee) { return { trouvee: false }; }
      G.setBoard(trouvee);
      var avant = G.snapshot();
      G.reshuffle();
      var apres = G.snapshot();
      return { trouvee: true, avantMort: !avant.move,
               apresVivant: !!apres.move, apresPropre: apres.runs.length === 0,
               memesGemmes: apres.grid.slice().sort().join(',') === trouvee.slice().sort().join(','),
               coups: apres.moves - avant.moves, melanges: apres.shuffles };
    });
    check('une grille morte a bien été construite', mort.trouvee === true);
    check('elle n\'offrait aucun échange', mort.avantMort === true);
    check('après remélange, un échange existe', mort.apresVivant === true);
    check('et le plateau ne contient aucun alignement tout fait', mort.apresPropre === true);
    check('ce sont les mêmes gemmes, seulement redistribuées', mort.memesGemmes === true);
    check('le remélange ne coûte pas un coup', mort.coups === 0, mort.coups);

    /* ---------------------------------------------------------------- */
    t.section('Les paliers');
    await page.goto(h.url('gems'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var palier = await page.evaluate(function () {
      var G = window.__neonGems;
      var c = [];
      for (var y = 0; y < 8; y++) { for (var x = 0; x < 8; x++) { c.push((x + 2 * y) % 4); } }
      c[4 * 8 + 1] = 6; c[4 * 8 + 2] = 6; c[3 * 8 + 3] = 6;    // à descendre pour aligner
      G.setBoard(c);
      G.setLevel(1, 10, 5);                 // quota minuscule, cinq coups
      var avant = G.snapshot();
      G.swapNow(3 * 8 + 3, 4 * 8 + 3);
      var apres = G.snapshot();
      return { avantNiveau: avant.level, apresNiveau: apres.level,
               budget: apres.movesLeft, quota: apres.need, score: apres.score - avant.score,
               remis: apres.levelScore };
    });
    check('dépasser le quota fait passer au palier suivant',
          palier.apresNiveau === palier.avantNiveau + 1,
          palier.avantNiveau + ' → ' + palier.apresNiveau);
    check('le budget de coups repart à neuf', palier.budget === 24, palier.budget);
    check('le quota du nouveau palier est plus haut', palier.quota > 10, palier.quota);
    check('la prime de palier est comptée', palier.score > 100, palier.score + ' points');

    var epuise = await page.evaluate(function () {
      var G = window.__neonGems;
      var c = [];
      for (var y = 0; y < 8; y++) { for (var x = 0; x < 8; x++) { c.push((x + 2 * y) % 4); } }
      c[4 * 8 + 1] = 6; c[4 * 8 + 2] = 6; c[3 * 8 + 3] = 6;
      G.setBoard(c);
      G.setLevel(1, 999999, 1);             // quota inatteignable, un seul coup
      G.swapNow(3 * 8 + 3, 4 * 8 + 3);
      return G.snapshot().state;
    });
    check('le dernier coup joué sans atteindre le quota termine la partie',
          epuise === 'over', epuise);

    /* ---------------------------------------------------------------- */
    t.section('Cent parties, plateau toujours jouable');
    /* Le vrai filet : des parties entières jouées au hasard, en vérifiant après
       chaque coup qu'aucune case n'est vide, qu'aucune couleur ne sort des
       bornes, et qu'un échange reste toujours possible. */
    await page.goto(h.url('gems'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="hard"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var parties = await page.evaluate(function () {
      var G = window.__neonGems;
      function coups() {
        var out = [];
        for (var y = 0; y < 8; y++) {
          for (var x = 0; x < 8; x++) {
            var i = y * 8 + x;
            if (x < 7 && G.swapWorks(i, i + 1)) { out.push([i, i + 1]); }
            if (y < 7 && G.swapWorks(i, i + 8)) { out.push([i, i + 8]); }
          }
        }
        return out;
      }
      var fautes = [], jouees = 0, coupsTotal = 0, paliers = [];
      for (var p = 0; p < 100 && fautes.length < 4; p++) {
        document.getElementById('restartBtn').click();
        var garde = 0, dernierNiveau = 1;
        while (G.snapshot().state === 'playing' && garde++ < 400) {
          var o = coups();
          if (!o.length) { fautes.push('partie ' + p + ' : plateau bloqué'); break; }
          var m = o[Math.floor(Math.random() * o.length)];
          G.swapNow(m[0], m[1]);
          coupsTotal++;
          var s = G.snapshot();
          if (s.grid.some(function (c) { return c < 0 || c >= s.colors; })) {
            fautes.push('partie ' + p + ' : une case vide ou hors couleurs');
          }
          if (!s.move) { fautes.push('partie ' + p + ' : plus aucun échange possible'); }
          if (s.level < dernierNiveau) { fautes.push('partie ' + p + ' : le palier a reculé'); }
          dernierNiveau = s.level;
          if (fautes.length >= 4) { break; }
        }
        if (garde >= 400) { fautes.push('partie ' + p + ' : elle ne s\'est jamais terminée'); }
        paliers.push(G.snapshot().level);
        jouees++;
      }
      return { fautes: fautes, jouees: jouees, coups: coupsTotal, paliers: paliers };
    });
    check('cent parties jouées jusqu\'au bout : le plateau reste toujours jouable',
          parties.fautes.length === 0,
          parties.fautes.join(' | ') || parties.jouees + ' parties, ' + parties.coups + ' coups');
    check('chacune se termine', parties.jouees === 100, parties.jouees);
    check('et les paliers atteints s\'étalent vraiment',
          Math.max.apply(null, parties.paliers) > Math.min.apply(null, parties.paliers),
          'de ' + Math.min.apply(null, parties.paliers) + ' à ' + Math.max.apply(null, parties.paliers));

    /* ---------------------------------------------------------------- */
    t.section('Jouer pour de vrai');
    await page.goto(h.url('gems'));
    await page.waitForTimeout(400);
    await page.click('.choice[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);
    var possible = (await snap()).move;
    check('le plateau propose un échange', !!possible, JSON.stringify(possible));
    var boite = await page.locator('#board').boundingBox();
    var depuis = await api('cellRatio', possible[0]);
    var vers = await api('cellRatio', possible[1]);
    await page.mouse.move(boite.x + depuis.x * boite.width, boite.y + depuis.y * boite.height);
    await page.mouse.down();
    await page.mouse.move(boite.x + vers.x * boite.width, boite.y + vers.y * boite.height, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1400);
    var joue = await snap();
    check('glisser une gemme sur sa voisine joue le coup', joue.moves === 1, joue.moves);
    check('des gemmes ont disparu', joue.gems >= 3, joue.gems);
    check('et le score a bougé', joue.score > 0, joue.score);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
