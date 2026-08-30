'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Snake — compteur de combo en zen',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };

      const snap = () => page.evaluate(() => window.__neonSnake.snapshot());
      await page.goto(h.url('snake'));
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      check('en zen, le compteur est visible dès ×1', await page.isVisible('#sideBox'),
            await page.textContent('#side'));

      // 5 pommes, en traînant volontairement entre chacune
      let last = (await snap()).score, eaten = 0;
      const t0 = Date.now();
      while (eaten < 5 && Date.now() - t0 < 90000) {
        const s = await snap();
        if (s.score !== last) { last = s.score; eaten++; console.log('   prise ' + eaten + ' → ' + (await page.textContent('#side'))); await page.waitForTimeout(3500); }
        const dx = s.food.x - s.head.x, dy = s.food.y - s.head.y;
        const m = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0] : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
        await page.keyboard.press(KEY[m[0] + ',' + m[1]]);
        await page.waitForTimeout(50);
      }
      check('×5 atteint à la cinquième prise', (await page.textContent('#side')) === '×5', await page.textContent('#side'));
      await page.screenshot({ path: h.shot('z1-zen-x5') });

      await page.goto(h.url('snake'));
      await page.click('[data-diff="normal"]');
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      check('hors zen, le compteur reste masqué tant qu\'il vaut ×1', !(await page.isVisible('#sideBox')));

    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
