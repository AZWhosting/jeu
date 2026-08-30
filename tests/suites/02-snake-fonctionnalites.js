'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Snake — zen, succès, réglages, skins, stats',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var errors = h.errors;
    const URL = h.url('snake');
    const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };


      async function newPage(vp) {
        return h.newPage(vp ? { viewport: vp } : undefined);
      }
      const snap = page => page.evaluate(() => window.__neonSnake.snapshot());

      // Pilote glouton : mange jusqu'à atteindre une condition
      async function play(page, { maxSteps = 200, until = () => false, delay = 70 } = {}) {
        for (let i = 0; i < maxSteps; i++) {
          const s = await snap(page);
          if (s.state !== 'playing' || until(s)) return s;
          const target = s.food || s.head;
          const dx = target.x - s.head.x, dy = target.y - s.head.y;
          const move = (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ? [Math.sign(dx), 0] : (dy !== 0 ? [0, Math.sign(dy)] : [1, 0]);
          await page.keyboard.press(KEY[move[0] + ',' + move[1]]);
          await page.waitForTimeout(delay);
        }
        return snap(page);
      }

      /* ---------- 1. Mode zen : rien ne tue ---------- */
      console.log('\n[1] Mode zen');
      let page = await newPage();
      await page.goto(URL);
      await page.click('[data-diff="zen"]');
      check('libellé HUD passe à « Longueur »', (await page.textContent('#bestLabel')) === 'Longueur');
      await page.click('#playBtn');
      await page.waitForTimeout(200);

      // Foncer dans le mur du haut pendant longtemps : doit traverser, pas mourir
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(4000);
      let s = await snap(page);
      check('survit à la traversée répétée des murs', s.state === 'playing', s.state);

      // Se mordre la queue : grandir puis tourner en rond serré
      await play(page, { maxSteps: 150, until: t => t.length >= 10, delay: 60 });
      // Boucle de deux cases : le serpent se traverse forcément une fois assez long.
      let overlapped = false;
      for (let i = 0; i < 24 && !overlapped; i++) {
        await page.keyboard.press(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][i % 4]);
        await page.waitForTimeout(180);
        const t2 = await snap(page);
        if (t2.state !== 'playing') break;
        if (new Set(t2.cells).size < t2.cells.length) overlapped = true;
      }
      s = await snap(page);
      check('le serpent se traverse réellement lui-même', overlapped);
      check('survit à la morsure de sa propre queue', s.state === 'playing', 'longueur ' + s.length);
      check('la longueur s\'affiche dans le HUD', (await page.textContent('#best')) === String(s.length));
      await page.screenshot({ path: h.shot('f1-zen') });

      /* ---------- 2. Succès en direct + toast ---------- */
      console.log('\n[2] Succès');
      check('« Premier repas » débloqué en cours de partie', s.unlocked.includes('firstBite'), s.unlocked.join(','));
      const toastSeen = await page.evaluate(() => document.querySelectorAll('.toast').length >= 0);
      await page.click('#pauseBtn');
      await page.click('.link[data-sheet="achievements"]');
      await page.waitForTimeout(150);
      const cards = await page.$$eval('.card', els => els.filter(e => e.classList.contains('is-on')).length);
      check('panneau succès : au moins une carte débloquée', cards >= 1, cards + ' cartes');
      await page.screenshot({ path: h.shot('f2-succes') });

      /* ---------- 3. Zen exclu des records et de la courbe ---------- */
      await page.click('#sheetClose');
      await page.click('#restartBtn');           // clôture la partie zen en cours
      await page.waitForTimeout(200);
      const totaux = (await snap(page)).totals;
      check('la partie zen compte dans les totaux', totaux.games >= 1, totaux.games + ' parties');
      check('la partie zen reste hors de la courbe des scores', (totaux.history || []).length === 0, JSON.stringify(totaux.history));
      check('aucun record enregistré en zen', await page.evaluate(() => window.Progress.bestFor('zen')) === 0);
      await page.close();

      /* ---------- 4. Réglages ---------- */
      console.log('\n[3] Réglages');
      page = await newPage();
      await page.goto(URL);
      await page.click('.link[data-sheet="settings"]');
      await page.waitForTimeout(120);
      check('grille moyenne au départ', (await snap(page)).cols === 21);
      await page.click('.sheet-body .choice:has-text("Petite")');
      await page.waitForTimeout(150);
      check('grille « Petite » appliquée immédiatement hors partie', (await snap(page)).cols === 15, (await snap(page)).cols);
      await page.click('.sheet-body .choice:has-text("Crépuscule")');
      check('thème appliqué au document', await page.getAttribute('html', 'data-theme') === 'dusk');
      await page.click('.sheet-body .choice:has-text("Constante")');
      await page.$$eval('.switch', els => els.forEach(e => e.click()));   // bascule les 3 interrupteurs
      await page.waitForTimeout(100);
      const stored = await page.evaluate(() => ({
        app: JSON.parse(localStorage.getItem('neon:app:settings') || '{}'),
        game: JSON.parse(localStorage.getItem('neon:snake:settings') || '{}')
      }));
      check('réglages du jeu persistés dans son espace',
            stored.game.grid === 'small' && stored.game.speed === 'constant' && stored.game.gridLines === false,
            JSON.stringify(stored.game));
      check('réglages partagés persistés dans l\'espace commun',
            stored.app.theme === 'dusk' && stored.app.sound === false && stored.app.effects === false,
            JSON.stringify(stored.app));
      await page.screenshot({ path: h.shot('f3-reglages') });

      // Le bouton son de la barre d'outils suit le réglage
      await page.click('#sheetClose');
      check('bouton son synchronisé', await page.getAttribute('#soundBtn', 'aria-pressed') === 'false');

      // Vitesse constante : la grille reste à 15 en partie
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      check('la partie démarre sur la petite grille', (await snap(page)).cols === 15);
      await page.screenshot({ path: h.shot('f4-theme-dusk') });
      await page.close();

      /* ---------- 5. Skins ---------- */
      console.log('\n[4] Skins');
      page = await newPage();
      await page.goto(URL);
      await page.evaluate(() => {
        localStorage.setItem('neon:snake:achievements', JSON.stringify({ apples50: Date.now(), combo5: Date.now() }));
      });
      await page.reload();
      await page.click('.link[data-sheet="skins"]');
      await page.waitForTimeout(150);
      const locked = await page.$$eval('.skin', els => els.map(e => e.disabled));
      check('skins verrouillés tant que le succès manque', locked.filter(Boolean).length === 4, locked.filter(Boolean).length + ' verrouillés sur ' + locked.length);
      await page.click('.skin:has-text("Rétro")');
      await page.waitForTimeout(100);
      check('skin sélectionné et persisté', (await snap(page)).skin === 'retro', (await snap(page)).skin);
      await page.screenshot({ path: h.shot('f5-skins') });
      await page.click('#sheetClose');
      await page.click('#playBtn');
      await page.waitForTimeout(400);
      await page.screenshot({ path: h.shot('f6-skin-retro') });
      await page.close();

      /* ---------- 6. Statistiques et courbe ---------- */
      console.log('\n[5] Statistiques');
      page = await newPage();
      await page.goto(URL);
      await page.evaluate(() => {
        const now = Date.now();
        const hist = [120, 340, 90, 610, 250, 480, 700, 150, 520, 380]
          .map((s, i) => ({ s, d: i % 2 ? 'normal' : 'hard', t: now - (10 - i) * 86400000 }));
        localStorage.setItem('neon:snake:totals', JSON.stringify({
          games: 34, apples: 268, powerups: 41, ghosts: 12, score: 8640,
          bestLength: 29, bestCombo: 5, timeMs: 3 * 3600000 + 12 * 60000,
          byDifficulty: { easy: { games: 8, best: 410 }, normal: { games: 18, best: 700 }, hard: { games: 6, best: 610 }, zen: { games: 2, best: 0 } },
          history: hist
        }));
        localStorage.setItem('neon:snake:best:normal', '700');
        localStorage.setItem('neon:snake:best:hard', '610');
        localStorage.setItem('neon:snake:best:easy', '410');
      });
      await page.reload();
      await page.click('#statsBtn');
      await page.waitForTimeout(200);
      check('score record affiché en héros', (await page.textContent('.hero-value')) === '700', await page.textContent('.hero-value'));
      check('temps de jeu formaté', (await page.$$eval('.tile-value', e => e.map(x => x.textContent))).includes('3 h 12 min'));
      const bars = await page.$$eval('.spark-bar', e => e.length);
      check('courbe : une barre par partie', bars === 10, bars + ' barres');
      const labels = await page.$$eval('.spark-label', e => e.map(x => x.textContent));
      check('étiquettes directes limitées au record et à la dernière', labels.length === 2, labels.join(' / '));
      const aria = await page.getAttribute('.spark', 'aria-label');
      check('courbe décrite pour les lecteurs d\'écran', /meilleur score 700/.test(aria), aria);
      await page.screenshot({ path: h.shot('f7-stats') });

      /* ---------- 7. Réinitialisation ---------- */
      console.log('\n[6] Réinitialisation');
      await page.click('.tab:has-text("Réglages")');
      await page.waitForTimeout(120);
      await page.click('.danger-btn');
      const armed = await page.textContent('.danger-btn');
      check('première pression : demande confirmation', /Confirmer/.test(armed), armed);
      await page.click('.danger-btn');
      await page.waitForTimeout(600);
      const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('neon:') === 0));
      check('données effacées après confirmation', left.length === 0, left.join(','));
      await page.close();


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
