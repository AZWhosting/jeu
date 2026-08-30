'use strict';

var harness = require('../lib/harness');

/* Après la mort, une touche pressée dans la foulée ne doit pas relancer la
   partie : sinon un appui tardif fait perdre l'écran de fin. */
module.exports = {
  name: 'Snake — délai de grâce après la mort',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var snap = function () { return page.evaluate(function () { return window.__neonSnake.snapshot(); }); };

    await page.goto(h.url('snake'));
    await page.click('#playBtn');
    await page.keyboard.press('ArrowUp');          // droit dans le mur du haut

    for (var i = 0; i < 60; i++) {
      if ((await snap()).state === 'over') { break; }
      await page.waitForTimeout(50);
    }
    check('la partie se termine contre le mur', (await snap()).state === 'over');

    await page.keyboard.press('ArrowRight');
    check('une touche immédiate est ignorée', (await snap()).state === 'over');

    await page.waitForTimeout(900);
    await page.keyboard.press('ArrowRight');
    check('une touche après le délai relance la partie', (await snap()).state === 'playing');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
