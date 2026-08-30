'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Snake — règles du combo',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;
    const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };

      const snap = () => page.evaluate(() => window.__neonSnake.snapshot());

      /* Observe la partie en continu et note chaque ramassage : le combo obtenu
         et le temps écoulé depuis le ramassage précédent. `drive` décide si l'on
         pilote vers la pomme ou si l'on laisse le serpent errer. */
      async function observe({ pickups, driveAfterMs = 0 }) {
        const events = [];
        let lastScore = (await snap()).score;
        let lastAt = Date.now();
        const started = Date.now();

        while (events.length < pickups && Date.now() - started < 90000) {
          const s = await snap();
          if (s.state !== 'playing') break;
          if (s.score !== lastScore) {
            const now = Date.now();
            events.push({ combo: s.combo, gap: now - lastAt, score: s.score });
            lastScore = s.score;
            lastAt = now;
          }
          // On ne pilote qu'après le délai voulu : avant, le serpent erre seul.
          if (Date.now() - lastAt >= driveAfterMs && s.food) {
            const dx = s.food.x - s.head.x, dy = s.food.y - s.head.y;
            const m = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0] : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
            await page.keyboard.press(KEY[m[0] + ',' + m[1]]);
          }
          await page.waitForTimeout(50);
        }
        return events;
      }

      /* --- Zen : compteur pur, même avec de longues pauses --- */
      console.log('\n[Zen] on laisse volontairement passer 4 s avant de viser la pomme');
      await page.goto(h.url('snake'));
      await page.click('[data-diff="zen"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      const zenEvents = await observe({ pickups: 7, driveAfterMs: 4000 });
      zenEvents.forEach((e, i) => console.log(`   ramassage ${i + 1} : combo ×${e.combo} après ${(e.gap / 1000).toFixed(1)} s`));

      const combos = zenEvents.map(e => e.combo);
      const attendu = combos.map((_, i) => Math.min(5, i + 1));
      check('le combo suit le nombre de ramassages (1,2,3,4,5,5…)',
            JSON.stringify(combos) === JSON.stringify(attendu), combos.join(','));
      const longGaps = zenEvents.slice(1).filter(e => e.gap > 2600).length;
      check('au moins une pause dépasse largement les 2,6 s', longGaps >= 2, longGaps + ' pauses longues');
      check('le HUD affiche ×5', (await page.textContent('#side')) === '×5');
      check('succès « Enchaîné » débloqué', (await snap()).unlocked.includes('combo5'));
      await page.screenshot({ path: h.shot('c1-zen-combo') });

      /* --- Hors zen : la fenêtre de 2,6 s s'applique toujours --- */
      console.log('\n[Facile] même protocole, la contrainte de temps doit rester');
      await page.goto(h.url('snake'));
      await page.click('[data-diff="easy"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      const easyEvents = await observe({ pickups: 6, driveAfterMs: 4000 });
      easyEvents.forEach((e, i) => console.log(`   ramassage ${i + 1} : combo ×${e.combo} après ${(e.gap / 1000).toFixed(1)} s`));
      const slowOnes = easyEvents.slice(1).filter(e => e.gap > 2600);
      check('des ramassages tardifs ont bien eu lieu', slowOnes.length >= 1, slowOnes.length);
      check('un ramassage tardif remet le combo à ×1',
            slowOnes.every(e => e.combo === 1), slowOnes.map(e => '×' + e.combo).join(','));
      /* --- Hors zen : un enchaînement rapide doit bien faire monter le combo --- */
      console.log('\n[Facile] enchaînement rapide, sans pause');
      await page.goto(h.url('snake'));
      await page.click('[data-diff="easy"]');
      await page.click('#playBtn');
      await page.waitForTimeout(200);
      const fastEvents = await observe({ pickups: 5, driveAfterMs: 0 });
      fastEvents.forEach((e, i) => console.log(`   ramassage ${i + 1} : combo ×${e.combo} après ${(e.gap / 1000).toFixed(1)} s`));
      const chained = fastEvents.slice(1).filter(e => e.gap < 2600);
      check('des enchaînements rapides ont eu lieu', chained.length >= 1, chained.length);
      check('ils font monter le combo au-delà de ×1', chained.every(e => e.combo >= 2),
            chained.map(e => '×' + e.combo).join(','));


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
