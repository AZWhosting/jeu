'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Boutons du menu, versions et chargement partiel',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;


      /* 1. Chargement normal : style + action des quatre boutons */
      await page.goto(h.url('snake'));
      await page.waitForTimeout(300);

      const s = await page.$eval('.link', el => {
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        return { border: cs.borderStyle, radius: cs.borderRadius, w: Math.round(b.width), h: Math.round(b.height) };
      });
      check('boutons stylés (bordure + rayon)', s.border === 'solid' && s.radius === '10px', JSON.stringify(s));
      check('taille cliquable correcte', s.w > 60 && s.h > 34, s.w + '×' + s.h);
      check('icônes présentes', (await page.$$('.link-icon')).length === 4);

      for (const [tab, label] of [['achievements','Succès'],['skins','Skins'],['stats','Stats'],['settings','Réglages']]) {
        await page.click(`.link[data-sheet="${tab}"]`);
        await page.waitForTimeout(120);
        const open = await page.evaluate(() => !document.getElementById('sheet').hidden);
        const active = await page.$eval('.tab.is-active', e => e.textContent).catch(() => '—');
        check(`bouton « ${label} » ouvre son onglet`, open && active === label, active);
        await page.click('#sheetClose');
        await page.waitForTimeout(80);
      }
      await page.screenshot({ path: h.shot('v1-menu') });

      // Le jeu démarre toujours
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      check('le jeu démarre normalement', (await page.evaluate(() => window.__neonSnake.snapshot())).state === 'playing');
      check('aucune erreur JS', errors.length === 0, errors.join(' | '));
      await page.close();

      /* 2. Anti-cache : les assets sont bien versionnés */
      const p2 = await h.newPage();
      const urls = [];
      p2.on('request', r => { if (/\.(css|js)/.test(r.url())) urls.push(r.url().split('/').pop()); });
      await p2.goto(h.url('snake'));
      await p2.waitForTimeout(200);
      check('assets versionnés dans les URLs', urls.every(u => u.includes('?v=')), urls.join(', '));
      await p2.close();

      /* 3. Page à moitié chargée : message explicite au lieu d'une page morte */
      const ctx = await h.browser.newContext({ viewport: { width: 520, height: 940 } });
      const p3 = await ctx.newPage();
      await p3.route('**/core/sheets.js*', r => r.fulfill({ status: 404, body: '' }));
      await p3.goto(h.url('snake'));
      await p3.waitForTimeout(300);
      const msg = await p3.textContent('#subtitle');
      check('message explicite si un module manque', /Chargement incomplet.*core\/sheets\.js/.test(msg), msg);
      await p3.screenshot({ path: h.shot('v2-degrade') });


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
