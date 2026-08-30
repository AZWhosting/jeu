'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Neon Four — règles et adversaire',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const URL = h.url('four');
    // . = vide, Y = toi, A = adversaire ; six lignes de sept colonnes, de haut en bas.
    const G = rows => rows.join('').split('').map(ch => ch === 'Y' ? 1 : ch === 'A' ? 2 : 0);

      const snap = () => page.evaluate(() => window.__neonFour.snapshot());
      const api = (fn, ...args) => page.evaluate(([f, a]) => window.__neonFour[f](...a), [fn, args]);
      const settle = async (ms = 900) => { await page.waitForTimeout(ms); };

      console.log('\n[Mise en place]');
      await page.goto(URL);
      await page.waitForTimeout(400);
      check('titre du jeu', (await page.textContent('#title')) === 'Neon Four', await page.textContent('#title'));
      check('légende à trois repères', (await page.$$('.legend span')).length === 3);
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      let s = await snap();
      check('grille vide de 42 cases', s.grid.length === 42 && s.grid.every(v => v === 0), s.grid.length);
      check('c\'est à toi de jouer', s.turn === 'you', s.turn);

      console.log('\n[Un coup, puis la réponse de l\'adversaire]');
      await api('play', 3);
      await settle(1400);
      s = await snap();
      const mine = s.grid.filter(v => v === 1).length;
      const theirs = s.grid.filter(v => v === 2).length;
      check('ton jeton est tombé au fond de la colonne', s.grid[5 * 7 + 3] === 1, 'case bas-centre = ' + s.grid[5 * 7 + 3]);
      check('l\'adversaire a répondu', theirs === 1, theirs + ' jeton adverse');
      check('un jeton chacun', mine === 1, mine + ' jeton à toi');
      check('la main revient à toi', s.turn === 'you' && !s.busy, s.turn);
      await page.screenshot({ path: h.shot('f1-four') });

      console.log('\n[L\'IA saisit une victoire immédiate]');
      await page.click('#restartBtn');
      await page.waitForTimeout(200);
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '.......',
        '.......',
        'AAA.YYY']));
      let col = await api('aiColumn');
      check('elle complète son alignement', col === 3, 'colonne ' + col);

      console.log('\n[L\'IA pare une défaite immédiate]');
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '.......',
        '.......',
        'YYY.A..']));
      col = await api('aiColumn');
      check('elle bouche la colonne dangereuse', col === 3, 'colonne ' + col);

      console.log('\n[Alignements gagnants]');
      // Horizontal : trois jetons posés, le quatrième gagne.
      await page.click('#restartBtn');
      await page.waitForTimeout(200);
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '.......',
        'AAA....',
        'YYY....']));
      await api('setTurn', 'you');
      await api('play', 3);
      await settle(1200);
      s = await snap();
      check('quatre alignés horizontalement : partie gagnée', s.state === 'over' && s.winning && s.winning.length === 4,
            s.state + ', ' + (s.winning ? s.winning.length : 0) + ' cases');
      const wonTitle = await page.textContent('#title');
      check('panneau de victoire', /Gagné|Nouveau record/.test(wonTitle), wonTitle);
      check('victoire comptée', s.totals.wins >= 1, s.totals.wins);
      check('prime de victoire ajoutée', s.score > 4 * 10, s.score + ' points');
      check('succès de victoire', s.unlocked.includes('firstWin') && s.unlocked.includes('winNormal'),
            s.unlocked.join(','));
      await page.screenshot({ path: h.shot('f2-four-gagne') });

      // Diagonale
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      // Diagonale montante : tes jetons en (0,5), (1,4) et (2,3) ; lâcher en
      // colonne 3 atterrit en (3,2) et complète l'alignement.
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '..YA...',
        '.YAA...',
        'YAAA...']));
      await api('setTurn', 'you');
      await api('play', 3);
      await settle(1200);
      s = await snap();
      check('diagonale détectée', s.state === 'over' && !!s.winning, s.state);

      console.log('\n[Défaite]');
      const winsBefore = (await snap()).totals.wins;
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '.......',
        'YY.....',
        'AAA.YY.']));
      await api('setTurn', 'ai');
      await page.evaluate(() => window.__neonFour.snapshot());
      await settle(1600);
      s = await snap();
      check('l\'adversaire conclut', s.state === 'over', s.state);
      check('panneau « Perdu »', (await page.textContent('#title')) === 'Perdu', await page.textContent('#title'));
      check('aucune victoire ajoutée', s.totals.wins === winsBefore,
            winsBefore + ' avant, ' + s.totals.wins + ' après');

      console.log('\n[Zen : annuler son coup]');
      await page.goto(URL);
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await api('play', 0);
      await settle(1400);
      const before = (await snap()).grid.filter(v => v !== 0).length;
      await page.keyboard.press('u');
      await page.waitForTimeout(300);
      s = await snap();
      check('la touche U retire les jetons du dernier échange', s.grid.filter(v => v !== 0).length < before,
            before + ' → ' + s.grid.filter(v => v !== 0).length);
      check('la main est à toi', s.turn === 'you', s.turn);
      check('aucun record en zen', await page.evaluate(() => window.Progress.bestFor('zen')) === 0);

      console.log('\n[Force de l\'IA en difficile]');
      await page.goto(URL);
      await page.click('[data-diff="hard"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      // Double menace : deux façons de gagner, l'IA doit en prendre une.
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '.......',
        '..A....',
        '.YAAY..']));
      const t0 = Date.now();
      col = await api('aiColumn');
      const ms = Date.now() - t0;
      check('elle décide en moins d\'une seconde', ms < 1000, ms + ' ms');
      check('elle joue un coup légal', col >= 0 && col < 7, 'colonne ' + col);

      // Sur plateau vide, l'ouverture de référence au puissance 4 est le centre.
      await page.click('#restartBtn');
      await page.waitForTimeout(200);
      await api('setGrid', new Array(42).fill(0));
      const opening = await api('aiColumn');
      check('elle ouvre au centre sur plateau vide', opening === 3, 'colonne ' + opening);

      // Menace verticale : trois de tes jetons empilés, elle doit coiffer.
      await api('setGrid', G([
        '.......',
        '.......',
        '.......',
        '..Y....',
        '..Y.A..',
        '..Y.A..']));
      const blockCol = await api('aiColumn');
      check('elle coiffe une menace verticale', blockCol === 2, 'colonne ' + blockCol);


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
