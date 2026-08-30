'use strict';

var harness = require('../lib/harness');

/* Le skin arc-en-ciel emprunte un chemin de rendu à part : chaque tronçon du
   serpent y prend sa propre teinte. */
module.exports = {
  name: 'Snake — skins et rendu arc-en-ciel',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };

    await page.goto(h.url('snake'));
    await page.evaluate(function () {
      localStorage.setItem('neon:snake:achievements',
        JSON.stringify({ apples250: Date.now(), apples50: Date.now() }));
    });
    await page.reload();
    await page.click('.link[data-sheet="skins"]');
    await page.waitForTimeout(150);

    var locked = await page.$$eval('.skin', function (els) { return els.map(function (e) { return e.disabled; }); });
    check('les skins non mérités restent verrouillés', locked.filter(Boolean).length === 4,
          locked.filter(Boolean).length + ' verrouillés sur ' + locked.length);

    await page.click('.skin:has-text("Arc-en-ciel")');
    await page.click('#sheetClose');
    await page.click('[data-diff="easy"]');
    await page.click('#playBtn');

    var snap = function () { return page.evaluate(function () { return window.__neonSnake.snapshot(); }); };
    for (var i = 0; i < 90; i++) {
      var s = await snap();
      if (s.state !== 'playing' || s.length >= 10) { break; }
      var dx = s.food.x - s.head.x, dy = s.food.y - s.head.y;
      var m = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0]
        : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
      await page.keyboard.press(KEY[m[0] + ',' + m[1]]);
      await page.waitForTimeout(70);
    }

    var final = await snap();
    check('le skin arc-en-ciel est équipé', final.skin === 'rainbow', final.skin);
    check('la partie tourne avec ce rendu', final.state === 'playing', final.state);
    await page.screenshot({ path: h.shot('snake-arc-en-ciel') });

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
