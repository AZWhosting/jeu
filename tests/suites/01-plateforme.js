'use strict';

var harness = require('../lib/harness');

module.exports = {
  name: 'Plateforme, hall et profil commun',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;


      console.log('\n[Hall]');
      await page.goto(h.hub());
      await page.waitForTimeout(300);
      const cards = await page.$$eval('.game-card', els => els.map(e => ({ name: e.querySelector('.game-name').textContent, href: e.getAttribute('href') })));
      check('les huit jeux sont listés', cards.length === 8, cards.map(c => c.name).join(' / '));
      check('les liens pointent vers la coquille', cards.every(c => /jeu\.html\?id=/.test(c.href)), cards.map(c => c.href).join(' '));
      const profile = await page.$$eval('#profile .tile-value', e => e.map(x => x.textContent));
      check('profil commun affiché', profile.length === 4, profile.join(' | '));
    check('l\'accroche compte les jeux elle-même',
          /^8 jeux/.test(await page.textContent('.hall-tagline')),
          await page.textContent('.hall-tagline'));
      await page.screenshot({ path: h.shot('p1-hall') });

      t.section('Le hall défile');
    // Le catalogue s'allonge à chaque jeu : sur un écran court, il faut
    // pouvoir atteindre la dernière carte.
    var court = await h.newPage({ viewport: { width: 390, height: 600 } });
    await court.goto(h.hub());
    await court.waitForTimeout(300);
    var mesure = await court.evaluate(function () {
      return { contenu: document.documentElement.scrollHeight,
               ecran: document.documentElement.clientHeight };
    });
    check('le contenu dépasse l\'écran', mesure.contenu > mesure.ecran,
          mesure.contenu + 'px pour ' + mesure.ecran + 'px');
    await court.mouse.wheel(0, 900);
    await court.waitForTimeout(250);
    check('la page défile', (await court.evaluate(function () { return window.scrollY; })) > 100,
          await court.evaluate(function () { return window.scrollY; }));
    check('la dernière carte devient visible',
          await court.$eval('.game-card:last-child', function (el) {
            var r = el.getBoundingClientRect();
            return r.top < window.innerHeight && r.bottom > 0;
          }));
    await court.close();

    var jeu = await h.newPage({ viewport: { width: 390, height: 600 } });
    await jeu.goto(h.url('snake'));
    await jeu.waitForTimeout(300);
    await jeu.mouse.wheel(0, 600);
    await jeu.waitForTimeout(200);
    check('une page de jeu, elle, ne défile pas',
          (await jeu.evaluate(function () { return window.scrollY; })) === 0);
    await jeu.close();

    console.log('\n[Snake via la coquille]');
      await page.click('.game-card:has-text("Snake")');
      await page.waitForTimeout(500);
      check('titre du jeu posé par le manifeste', (await page.textContent('#title')) === 'Neon Snake', await page.textContent('#title'));
      check('légende du Snake rendue', (await page.$$('.legend span')).length === 4);
      check('aide clavier avec touche stylée', (await page.$$('.hint kbd')).length === 1);
      const snakeState = await page.evaluate(() => window.__neonSnake.snapshot());
      check('le jeu est prêt', snakeState.state === 'menu' && snakeState.cols > 0, snakeState.cols + ' cases');
      await page.click('#playBtn');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(400);
      check('le Snake tourne', (await page.evaluate(() => window.__neonSnake.snapshot())).state === 'playing');
      await page.screenshot({ path: h.shot('p2-snake') });

      console.log('\n[2048 via la coquille]');
      await page.goto(h.url('2048'));
      await page.waitForTimeout(500);
      check('titre 2048', (await page.textContent('#title')) === 'Neon 2048', await page.textContent('#title'));
      check('pas de légende pour ce jeu', await page.isHidden('#legend'));
      const diffs = await page.$$eval('#difficulty .choice', e => e.map(x => x.textContent));
      check('difficultés du manifeste 2048', diffs.join(',') === 'Classique,Serré,Large,Zen', diffs.join(','));
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      let s = await page.evaluate(() => window.__neon2048.snapshot());
      check('deux tuiles au départ', s.tiles === 2, s.tiles + ' tuiles');
      check('grille 4 × 4 en classique', s.size === 4);

      // Un coup réel : on vise une fusion garantie.
      await page.evaluate(() => window.__neon2048.setGrid([2,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]));
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(400);
      s = await page.evaluate(() => window.__neon2048.snapshot());
      check('fusion : 2 + 2 = 4', s.grid[0] === 4, 'case 0 = ' + s.grid[0]);
      check('score crédité de la fusion', s.score === 4, s.score);
      check('meilleure tuile suivie', s.maxTile === 4, s.maxTile);
      check('succès « Première fusion » débloqué', s.unlocked.includes('firstMerge'), s.unlocked.join(','));
      check('une tuile est apparue', s.tiles === 2, s.tiles + ' tuiles');
      await page.screenshot({ path: h.shot('p3-2048') });

      console.log('\n[Le contrat commun]');
      await page.click('#statsBtn');
      await page.waitForTimeout(200);
      const tiles = await page.$$eval('.tile-label', e => e.map(x => x.textContent));
      check('les stats parlent le vocabulaire de 2048',
            tiles.includes('Coups joués') && tiles.includes('Fusions') && tiles.includes('Meilleure tuile'),
            tiles.join(', '));
      await page.click('.tab:has-text("Skins")');
      await page.waitForTimeout(150);
      const skins = await page.$$eval('.skin strong', e => e.map(x => x.textContent));
      check('palettes de 2048 proposées', skins.join(',') === 'Néon,Classique,Océan,Braise,Arc-en-ciel', skins.join(','));
      await page.click('.tab:has-text("Réglages")');
      await page.waitForTimeout(150);
      const fields = await page.$$eval('.field-label', e => e.map(x => x.textContent));
      check('réglages propres à 2048 + thème commun',
            fields.includes('Objectif') && fields.includes('Nouvelles tuiles') && fields.includes('Thème'),
            fields.join(', '));
      await page.screenshot({ path: h.shot('p4-2048-reglages') });

      console.log('\n[Cloisonnement des données]');
      const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('neon:') === 0).sort());
      check('chaque jeu écrit dans son espace', keys.some(k => k.indexOf('neon:2048:') === 0), keys.join(', '));
      check('aucun mélange avec le Snake', !keys.some(k => k.indexOf('neon:snake:totals') === 0 && false));

      // Le thème est partagé : changé dans 2048, il doit suivre dans le hall.
      await page.click('.sheet-body .choice:has-text("Crépuscule")');
      await page.waitForTimeout(150);
      await page.goto(h.hub());
      await page.waitForTimeout(300);
      check('thème partagé repris par le hall', await page.getAttribute('html', 'data-theme') === 'dusk',
            await page.getAttribute('html', 'data-theme'));


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
