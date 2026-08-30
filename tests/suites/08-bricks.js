'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Neon Bricks — physique, bonus, niveaux',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const URL = h.url('bricks');

      const snap = () => page.evaluate(() => window.__neonBricks.snapshot());

      console.log('\n[Mise en place]');
      await page.goto(URL);
      await page.waitForTimeout(400);
      check('titre du jeu', (await page.textContent('#title')) === 'Neon Bricks', await page.textContent('#title'));
      check('légende des bonus', (await page.$$('.legend span')).length === 3);
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      let s = await snap();
      check('briques posées (5 rangées × 8)', s.bricks === 40, s.bricks + ' briques');
      check('balle collée à la raquette au départ', s.docked === true);
      check('trois vies en normal', s.lives === 3, s.lives);

      console.log('\n[Service et rebonds]');
      await page.keyboard.press(' ');
      await page.waitForTimeout(300);
      s = await snap();
      check('la balle est lancée vers le haut', !s.docked && s.ball.vy < 0, 'vy = ' + s.ball.vy.toFixed(2));
      await page.waitForTimeout(2200);
      let s2 = await snap();
      check('la balle avance', s2.ball.y !== s.ball.y);
      check('des briques tombent', s2.bricks < 40, (40 - s2.bricks) + ' cassées');
      check('le score suit', s2.score > 0, s2.score);

      // Rebond sur le mur gauche : on envoie la balle droit dessus.
      await page.evaluate(() => window.__neonBricks.setBall({ x: 0.05, y: 0.6, vx: -0.9, vy: 0 }));
      await page.waitForTimeout(300);
      s = await snap();
      check('rebond sur le mur gauche', s.ball.vx > 0, 'vx = ' + s.ball.vx.toFixed(2));

      // Rebond sur la raquette : angle dépendant du point d'impact.
      await page.evaluate(() => {
        window.__neonBricks.setPaddle(0.5);
        window.__neonBricks.setBall({ x: 0.5, y: 0.86, vx: 0, vy: 0.9 });
      });
      await page.waitForTimeout(300);
      s = await snap();
      check('rebond sur la raquette (centre : renvoi vertical)', s.ball.vy < 0 && Math.abs(s.ball.vx) < 0.2,
            'vx = ' + s.ball.vx.toFixed(2) + ', vy = ' + s.ball.vy.toFixed(2));

      await page.evaluate(() => {
        window.__neonBricks.setPaddle(0.5);
        window.__neonBricks.setBall({ x: 0.57, y: 0.86, vx: 0, vy: 0.9 });
      });
      await page.waitForTimeout(300);
      s = await snap();
      check('impact sur le bord droit : renvoi de biais', s.ball.vy < 0 && s.ball.vx > 0.3,
            'vx = ' + s.ball.vx.toFixed(2));
      await page.screenshot({ path: h.shot('b1-bricks') });

      console.log('\n[Raquette]');
      const before = (await snap()).paddle.x;
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(500);
      await page.keyboard.up('ArrowLeft');
      s = await snap();
      check('la raquette suit une touche maintenue', s.paddle.x < before - 0.1,
            before.toFixed(2) + ' → ' + s.paddle.x.toFixed(2));
      await page.mouse.move(400, 700);
      await page.waitForTimeout(150);
      s = await snap();
      check('la raquette suit le pointeur', s.paddle.x > 0.6, s.paddle.x.toFixed(2));

      console.log('\n[Bonus]');
      // Balle immobile en hauteur : aucune vie ne peut se perdre pendant ces mesures.
      await page.evaluate(() => {
        window.__neonBricks.setBall({ x: 0.5, y: 0.3, vx: 0, vy: 0 });
        window.__neonBricks.setPaddle(0.5);
        window.__neonBricks.dropAt('wide', 0.5, 0.85);
      });
      const width = (await snap()).paddle.w;
      await page.waitForTimeout(800);
      s = await snap();
      check('bonus « raquette large » attrapé', s.paddle.w > width * 1.4,
            width.toFixed(3) + ' → ' + s.paddle.w.toFixed(3));
      await page.evaluate(() => { window.__neonBricks.setPaddle(0.5); window.__neonBricks.dropAt('life', 0.5, 0.85); });
      const lives = (await snap()).lives;
      await page.waitForTimeout(800);
      check('bonus « vie en plus » attrapé', (await snap()).lives === lives + 1, (await snap()).lives + ' vies');

      console.log('\n[Niveau suivant]');
      await page.evaluate(() => window.__neonBricks.clearBricks(0));
      await page.waitForTimeout(400);
      s = await snap();
      check('niveau suivant enclenché', s.level === 2, 'niveau ' + s.level);
      check('nouvelles briques posées', s.bricks > 0, s.bricks + ' briques');
      check('prime de fin de niveau', s.score >= 100, s.score);
      check('succès « Deuxième service »', s.unlocked.includes('level2'), s.unlocked.join(','));

      console.log('\n[Perdre la balle]');
      for (let i = 0; i < 6; i++) {
        const cur = await snap();
        if (cur.state !== 'playing') break;
        await page.evaluate(() => window.__neonBricks.setBall({ x: 0.2, y: 0.99, vx: 0, vy: 1.2 }));
        await page.waitForTimeout(250);
      }
      s = await snap();
      check('la partie se termine à court de vies', s.state === 'over', s.state + ', ' + s.lives + ' vies');
      check('score enregistré', s.totals.games >= 1, s.totals.games + ' parties');
      check('briques comptées dans les totaux', s.totals.bricks > 0, s.totals.bricks);
      await page.screenshot({ path: h.shot('b2-bricks-perdu') });

      console.log('\n[Zen : la balle rebondit en bas]');
      await page.goto(URL);
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__neonBricks.setBall({ x: 0.3, y: 0.97, vx: 0, vy: 1.0 }));
      await page.waitForTimeout(400);
      s = await snap();
      check('la balle repart vers le haut', s.state === 'playing' && s.ball.vy < 0,
            s.state + ', vy = ' + s.ball.vy.toFixed(2));
      check('aucune vie perdue', s.lives === 3, s.lives + ' vies');
      check('le HUD affiche l\'infini', (await page.textContent('#side')) === '∞');


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
