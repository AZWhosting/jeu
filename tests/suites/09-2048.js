'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Neon 2048 — fusions, victoire, zen',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const URL = h.url('2048');

      const snap = () => page.evaluate(() => window.__neon2048.snapshot());
      const setGrid = g => page.evaluate(v => window.__neon2048.setGrid(v), g);

      console.log('\n[Règles]');
      await page.goto(URL);
      await page.click('#playBtn');
      await page.waitForTimeout(200);

      // Une ligne de quatre : deux fusions en un seul coup.
      await setGrid([4,4,8,8, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(400);
      let s = await snap();
      check('deux fusions dans le même coup', s.grid[0] === 8 && s.grid[1] === 16, s.grid.slice(0, 4).join(','));
      check('score = somme des fusions (8 + 16)', s.score === 24, s.score);

      // Un coup sans effet ne doit rien changer ni faire apparaître de tuile.
      await setGrid([2,4,8,16, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
      const before = (await snap()).tiles;
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      s = await snap();
      check('coup impossible ignoré (aucune tuile ajoutée)', s.tiles === before, s.tiles + ' tuiles');

      // Trois identiques : une seule fusion, la plus proche du bord.
      await setGrid([2,2,2,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(400);
      s = await snap();
      check('trois tuiles : une seule fusion', s.grid[0] === 4 && s.grid[1] === 2, s.grid.slice(0, 4).join(','));

      console.log('\n[Victoire]');
      await page.evaluate(() => window.Progress.setSetting('target', '1024'));
      await setGrid([512,512,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(400);
      check('panneau de victoire', (await page.textContent('#title')) === 'Gagné !', await page.textContent('#title'));
      check('succès de la tuile 1024', (await snap()).unlocked.includes('t1024'));
      await page.screenshot({ path: h.shot('q1-2048-gagne') });
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      check('« Continuer » relance la partie en cours', (await snap()).state === 'playing');

      console.log('\n[Fin de partie]');
      await setGrid([2,4,2,4, 4,8,4,8, 2,4,2,4, 4,8,4,8]);   // aucune paire voisine
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(600);
      s = await snap();
      check('partie terminée quand la grille est bloquée', s.state === 'over', s.state);
      check('score enregistré dans les totaux', s.totals.games >= 1, s.totals.games + ' parties');
      check('coups et fusions comptés', s.totals.moves > 0 && s.totals.merges > 0,
            s.totals.moves + ' coups, ' + s.totals.merges + ' fusions');
      await page.screenshot({ path: h.shot('q2-2048-perdu') });

      console.log('\n[Mode zen : jamais perdu]');
      await page.goto(URL);
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await setGrid([2,4,2,4, 4,8,4,8, 2,4,2,4, 4,8,4,8]);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(600);
      s = await snap();
      check('la partie continue malgré la grille bloquée', s.state === 'playing', s.state);
      check('les plus petites tuiles se sont évaporées', s.grid.filter(v => v === 2).length === 0,
            s.grid.filter(v => v === 2).length + ' tuiles « 2 » restantes');
      check('des cases sont libérées', s.tiles < 16, s.tiles + ' tuiles');
      check('le zen ne produit pas de record', await page.evaluate(() => window.Progress.bestFor('zen')) === 0);
      await page.screenshot({ path: h.shot('q3-2048-zen') });


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
