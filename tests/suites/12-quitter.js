'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Enregistrer et quitter',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    async function playSnake(page) {
      const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
      for (let i = 0; i < 60; i++) {
        const s = await page.evaluate(() => window.__neonSnake.snapshot());
        if (s.state !== 'playing' || s.score >= 30) return s;
        const dx = s.food.x - s.head.x, dy = s.food.y - s.head.y;
        const m = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0] : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
        await page.keyboard.press(KEY[m[0] + ',' + m[1]]);
        await page.waitForTimeout(70);
      }
      return page.evaluate(() => window.__neonSnake.snapshot());
    }


      console.log('\n[Bouton de la barre d\'outils]');
      await page.goto(h.url('snake'));
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('[data-diff="easy"]');
      await page.click('#playBtn');
      const s = await playSnake(page);
      check('une partie est toujours en cours, avec du score', s.state === 'playing' && s.score > 0,
            s.state + ', ' + s.score + ' points');
      check('rien n\'est encore enregistré', s.totals.games === 0, s.totals.games + ' parties');

      await page.click('#quitBtn');
      await page.waitForTimeout(600);
      check('retour au hall', /index\.html$/.test(page.url()), page.url().split('/').pop());
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('neon:snake:totals') || '{}'));
      check('la partie interrompue est enregistrée', stored.games === 1, stored.games + ' partie(s)');
      check('son score compte dans les totaux', stored.score >= s.score, stored.score + ' points cumulés');
      check('le hall affiche la partie', (await page.textContent('.game-card:has-text("Snake") .game-meta')).indexOf('1 parties') >= 0,
            await page.textContent('.game-card:has-text("Snake") .game-meta'));
      await page.screenshot({ path: h.shot('r1-hall-apres-quitter') });

      console.log('\n[Bouton du panneau de pause]');
      await page.goto(h.url('2048'));
      await page.click('#playBtn');
      // Deux coups garantis : une grille placée à la main, puis deux glissements.
      await page.evaluate(() => window.__neon2048.setGrid([2,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]));
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__neon2048.setGrid([4,0,0,0, 4,0,0,0, 0,0,0,0, 0,0,0,0]));
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);
      await page.click('#pauseBtn');
      await page.waitForTimeout(200);
      check('le panneau de pause propose la sortie', await page.isVisible('#quitPanelBtn'));
      check('libellé explicite', (await page.textContent('#quitPanelBtn')) === 'Enregistrer et quitter',
            await page.textContent('#quitPanelBtn'));
      await page.screenshot({ path: h.shot('r2-pause') });
      await page.click('#quitPanelBtn');
      await page.waitForTimeout(600);
      const t2048 = await page.evaluate(() => JSON.parse(localStorage.getItem('neon:2048:totals') || '{}'));
      check('la partie de 2048 est enregistrée', t2048.games === 1, t2048.games + ' partie(s)');
      check('les coups sont comptés', t2048.moves >= 2, t2048.moves + ' coups');

      console.log('\n[La flèche de retour enregistre aussi]');
      await page.goto(h.url('bricks'));
      await page.click('#playBtn');
      await page.keyboard.press(' ');
      await page.waitForTimeout(1500);
      await page.click('.back');
      await page.waitForTimeout(600);
      const tb = await page.evaluate(() => JSON.parse(localStorage.getItem('neon:bricks:totals') || '{}'));
      check('la partie de casse-briques est enregistrée', tb.games === 1, tb.games + ' partie(s)');
      check('retour au hall', /index\.html$/.test(page.url()));

      console.log('\n[Une partie vide ne pollue pas les statistiques]');
      await page.evaluate(() => localStorage.clear());
      await page.goto(h.url('snake'));
      await page.click('#playBtn');
      await page.waitForTimeout(150);
      await page.click('#quitBtn');
      await page.waitForTimeout(500);
      const empty = await page.evaluate(() => JSON.parse(localStorage.getItem('neon:snake:totals') || 'null'));
      check('aucune partie fantôme enregistrée', !empty || !empty.games, JSON.stringify(empty));

      console.log('\n[Le hall liste les trois jeux]');
      const names = await page.$$eval('.game-name', e => e.map(x => x.textContent));
      check('sept jeux', names.length === 7, names.join(' / '));


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
