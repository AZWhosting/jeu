'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Neon Mines — cascade, drapeaux, premier clic sûr',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const URL = h.url('mines');

      const snap = () => page.evaluate(() => window.__neonMines.snapshot());
      const api = (fn, ...args) => page.evaluate(([f, a]) => window.__neonMines[f](...a), [fn, args]);

      console.log('\n[Mise en place]');
      await page.goto(URL);
      await page.waitForTimeout(400);
      check('titre du jeu', (await page.textContent('#title')) === 'Neon Mines', await page.textContent('#title'));
      check('trois repères en légende', (await page.$$('.legend span')).length === 3);
      check('aide clavier avec deux touches', (await page.$$('.hint kbd')).length === 2);
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      let s = await snap();
      check('grille 12 × 12 en normal', s.size === 12, s.size);
      check('22 mines annoncées', s.mines === 22, s.mines);
      check('mines pas encore posées', s.placed === false);
      check('le HUD affiche les mines restantes', (await page.textContent('#side')) === '22');

      console.log('\n[Premier clic sûr]');
      // Cent parties : la première case jouée ne doit jamais cacher de mine.
      const unsafe = await page.evaluate(() => {
        let bad = 0;
        for (let i = 0; i < 100; i++) {
          window.Sheets.close();
          document.getElementById('restartBtn').click();
          window.__neonMines.reveal(5, 5);
          if (window.__neonMines.mineAt(5, 5)) bad++;
        }
        return bad;
      });
      check('aucune mine sous le premier clic (100 essais)', unsafe === 0, unsafe + ' échecs');

      console.log('\n[Cascade et chiffres]');
      await page.click('#restartBtn');
      await api('plant', [[0, 0]]);            // une seule mine, dans un coin
      await api('reveal', 11, 11);
      await page.waitForTimeout(200);
      s = await snap();
      check('la cascade ouvre tout le plateau sauf le voisinage', s.revealed >= 140, s.revealed + ' cases');
      const near = await page.evaluate(() => [window.__neonMines.nearAt(1, 1), window.__neonMines.nearAt(3, 3)]);
      check('le chiffre voisin de la mine vaut 1', near[0] === 1, near[0]);
      check('une case éloignée vaut 0', near[1] === 0, near[1]);

      console.log('\n[Drapeau]');
      await page.click('#restartBtn');
      await api('plant', [[2, 2], [3, 3]]);
      await api('flag', 2, 2);
      s = await snap();
      check('drapeau posé', await page.evaluate(() => window.__neonMines.flaggedAt(2, 2)));
      check('compteur de mines restantes décrémenté', (await page.textContent('#side')) === '1',
            await page.textContent('#side'));
      await api('reveal', 2, 2);
      check('une case marquée ne se découvre pas', !(await page.evaluate(() => window.__neonMines.revealedAt(2, 2))));
      await api('flag', 2, 2);
      check('drapeau retiré', !(await page.evaluate(() => window.__neonMines.flaggedAt(2, 2))));

      console.log('\n[Touche F et curseur]');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      // Le curseur part du centre (6,6) : une flèche à droite puis une en bas → (7,7).
      const cur = (await snap()).cursor;
      check('les flèches déplacent le curseur', cur.x === 7 && cur.y === 7, cur.x + ',' + cur.y);
      await page.keyboard.press('f');
      check('la touche F pose un drapeau', await page.evaluate(() => window.__neonMines.flaggedAt(7, 7)));

      console.log('\n[Explosion]');
      await page.click('#restartBtn');
      await api('plant', [[4, 4]]);
      await api('reveal', 4, 4);
      await page.waitForTimeout(300);
      s = await snap();
      check('la partie s\'arrête sur une mine', s.state === 'over', s.state);
      check('panneau « Mine ! »', (await page.textContent('#title')) === 'Mine !', await page.textContent('#title'));
      await page.screenshot({ path: h.shot('m1-mines-perdu') });

      console.log('\n[Victoire]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await api('plant', [[0, 0], [11, 11]]);
      await api('reveal', 5, 5);
      await page.waitForTimeout(300);
      s = await snap();
      check('toutes les cases sûres révélées', s.revealed === s.safe, s.revealed + ' / ' + s.safe);
      check('partie gagnée', s.state === 'won', s.state);
      check('prime de victoire ajoutée', s.score > s.revealed * 10, s.score + ' points');
      check('succès de victoire débloqués', s.unlocked.includes('firstWin') && s.unlocked.includes('winNormal'),
            s.unlocked.join(','));
      check('victoire comptée dans les totaux', s.totals.wins >= 1, s.totals.wins + ' victoire(s)');
      await page.screenshot({ path: h.shot('m2-mines-gagne') });

      console.log('\n[Déblayage autour d\'un chiffre]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await api('plant', [[0, 0], [5, 5]]);
      await api('reveal', 4, 4);          // chiffre 1, voisin de la mine (5,5)
      await api('flag', 5, 5);
      const before = (await snap()).revealed;
      await api('reveal', 4, 4);          // second clic : déblaie les voisines
      await page.waitForTimeout(200);
      s = await snap();
      check('le second clic déblaie autour du chiffre', s.revealed > before, before + ' → ' + s.revealed);

      console.log('\n[Zen : la mine est désamorcée]');
      await page.goto(URL);
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await api('plant', [[3, 3]]);
      await api('reveal', 3, 3);
      await page.waitForTimeout(300);
      s = await snap();
      check('la partie continue', s.state === 'playing', s.state);
      check('la mine est marquée comme trouvée', await page.evaluate(() => window.__neonMines.flaggedAt(3, 3)));
      check('aucun record en zen', await page.evaluate(() => window.Progress.bestFor('zen')) === 0);
      await page.screenshot({ path: h.shot('m3-mines-zen') });


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
