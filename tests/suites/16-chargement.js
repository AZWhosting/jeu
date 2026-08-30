'use strict';

var harness = require('../lib/harness');

/* Deux façons d'ouvrir le jeu qui doivent marcher, et une qui doit échouer
   proprement : le fichier ouvert directement, et la page à moitié chargée. */
module.exports = {
  name: 'Ouverture en file:// et chargement partiel',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);

    t.section('Fichier ouvert directement (file://)');
    var direct = await h.newPage();
    await direct.goto(h.fileUrl('snake'));
    await direct.waitForTimeout(500);
    check('les styles sont appliqués',
          (await direct.$eval('.link', function (el) { return getComputedStyle(el).borderRadius; })) === '10px');
    await direct.click('.link[data-sheet="stats"]');
    await direct.waitForTimeout(200);
    check('les panneaux s\'ouvrent',
          await direct.evaluate(function () { return !document.getElementById('sheet').hidden; }));
    check('le jeu est prêt',
          (await direct.evaluate(function () { return window.__neonSnake.snapshot().state; })) === 'menu');
    await direct.close();

    t.section('Fichier du socle manquant');
    var broken = await h.newPage();
    var brokenErrors = [];
    broken.on('pageerror', function (e) { brokenErrors.push(e.message); });
    await broken.route('**/core/sheets.js*', function (route) { route.fulfill({ status: 404, body: '' }); });
    await broken.goto(h.url('snake'));
    await broken.waitForTimeout(400);
    var msg = await broken.textContent('#subtitle');
    check('un message nomme le fichier manquant', /Chargement incomplet.*core\/sheets\.js/.test(msg), msg);
    check('aucune exception non rattrapée', brokenErrors.length === 0, brokenErrors.join(' | ') || undefined);
    await broken.screenshot({ path: h.shot('chargement-incomplet') });
    await broken.close();

    // Les erreurs collectées plus haut incluent le 404 provoqué exprès.
    await h.browser.close();
    return t.fails;
  }
};
