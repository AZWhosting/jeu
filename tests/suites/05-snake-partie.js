'use strict';

var harness = require('../lib/harness');

/* Une vraie partie, pilotée par un joueur automatique glouton : il vise la
   pomme au plus court. Sert de test de bout en bout du moteur. */
module.exports = {
  name: 'Snake — partie complète pilotée',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };

    await page.goto(h.url('snake'));
    await page.click('[data-diff="easy"]');
    await page.click('#playBtn');

    var snap = function () { return page.evaluate(function () { return window.__neonSnake.snapshot(); }); };
    var maxCombo = 1, sawPowerup = null;

    for (var i = 0; i < 220; i++) {
      var s = await snap();
      if (s.state !== 'playing') { break; }
      if (s.combo > maxCombo) { maxCombo = s.combo; }
      if (s.powerup && !sawPowerup) { sawPowerup = s.powerup.type; }
      if (!s.food) { await page.waitForTimeout(60); continue; }

      var target = (s.powerup && Math.abs(s.powerup.x - s.head.x) + Math.abs(s.powerup.y - s.head.y) < 5)
        ? s.powerup : s.food;
      var dx = target.x - s.head.x, dy = target.y - s.head.y;
      var move = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0]
        : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
      await page.keyboard.press(KEY[move[0] + ',' + move[1]]);
      await page.waitForTimeout(70);
    }

    var final = await snap();
    check('le serpent a marqué des points', final.score > 0, final.score + ' points');
    check('il a grandi', final.length > 3, final.length + ' segments');
    check('le combo est monté', maxCombo >= 2, '×' + maxCombo);
    check('le HUD affiche le même score', (await page.textContent('#score')) === String(final.score));
    await page.screenshot({ path: h.shot('snake-partie') });

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
