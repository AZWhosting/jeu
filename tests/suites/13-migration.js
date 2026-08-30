'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: "Reprise des données de l'ancien schéma",
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;

      await page.goto(h.url('snake'));

      // On rejoue l'ancien schéma de stockage, tel qu'un joueur l'a sur son disque.
      await page.evaluate(() => {
        localStorage.clear();
        const set = (k, v) => localStorage.setItem('neon-snake:' + k, JSON.stringify(v));
        set('settings', { grid: 'large', speed: 'constant', theme: 'retro', sound: false,
                          effects: true, gridLines: false, skin: 'retro' });
        set('totals', { games: 12, apples: 88, powerups: 9, ghosts: 3, score: 2400,
                        bestLength: 21, bestCombo: 4, timeMs: 900000,
                        byDifficulty: { normal: { games: 12, best: 430 } },
                        history: [{ s: 430, d: 'normal', t: Date.now() }] });
        set('achievements', { firstBite: 1, combo5: 2, apples50: 3 });
        set('difficulty', 'hard');
        set('best:normal', 430);
        set('best:hard', 210);
      });
      await page.reload();
      await page.waitForTimeout(400);

      const after = await page.evaluate(() => {
        const out = {};
        Object.keys(localStorage).forEach(k => { out[k] = localStorage.getItem(k); });
        return out;
      });
      const oldLeft = Object.keys(after).filter(k => k.indexOf('neon-snake:') === 0);
      check('anciennes clés supprimées après reprise', oldLeft.length === 0, oldLeft.join(','));

      const app = JSON.parse(after['neon:app:settings'] || '{}');
      const game = JSON.parse(after['neon:snake:settings'] || '{}');
      check('réglages partagés repris', app.theme === 'retro' && app.sound === false && app.effects === true,
            JSON.stringify(app));
      check('réglages du jeu repris', game.grid === 'large' && game.speed === 'constant' &&
            game.gridLines === false && game.skin === 'retro' && game.difficulty === 'hard',
            JSON.stringify(game));

      const totals = JSON.parse(after['neon:snake:totals'] || '{}');
      check('statistiques reprises', totals.games === 12 && totals.apples === 88 && totals.bestLength === 21,
            totals.games + ' parties, ' + totals.apples + ' pommes');
      check('records repris', after['neon:snake:best:normal'] === '430' && after['neon:snake:best:hard'] === '210');
      check('succès repris', Object.keys(JSON.parse(after['neon:snake:achievements'] || '{}')).length === 3);

      // Et le jeu applique bien ce qu'il vient de reprendre.
      const s = await page.evaluate(() => window.__neonSnake.snapshot());
      check('difficulté et grille appliquées', s.difficulty === 'hard' && s.cols === 27,
            s.difficulty + ', ' + s.cols + ' cases');
      check('skin appliqué', s.skin === 'retro', s.skin);
      check('thème appliqué', await page.getAttribute('html', 'data-theme') === 'retro');

      // Une seconde visite ne doit rien réécrire ni rien dupliquer.
      await page.reload();
      await page.waitForTimeout(300);
      const again = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('neon-snake:') === 0).length);
      check('reprise non rejouée au chargement suivant', again === 0);


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
