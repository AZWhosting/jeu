'use strict';

var harness = require('../lib/harness');

/* Neon Meow : la règle du jeu, mais surtout la qualité des grilles tirées au
   sort — territoires connexes, solution unique, aucune déduction impossible. */

/* Vérifie qu'une région donnée est bien d'un seul tenant. */
function connected(region, n, id) {
  var cells = [];
  for (var i = 0; i < region.length; i++) { if (region[i] === id) { cells.push(i); } }
  if (!cells.length) { return false; }
  var seen = {};
  var stack = [cells[0]];
  seen[cells[0]] = true;
  var count = 0;
  while (stack.length) {
    var cell = stack.pop();
    count++;
    var x = cell % n, y = Math.floor(cell / n);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) { return; }
      var ni = ny * n + nx;
      if (region[ni] !== id || seen[ni]) { return; }
      seen[ni] = true;
      stack.push(ni);
    });
  }
  return count === cells.length;
}

module.exports = {
  name: 'Neon Meow — grilles générées, uniques et solubles',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var snap = function () { return page.evaluate(function () { return window.__neonMeow.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonMeow[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };

    t.section('Mise en place');
    await page.goto(h.url('meow'));
    await page.waitForTimeout(500);
    check('titre du jeu', (await page.textContent('#title')) === 'Neon Meow',
          await page.textContent('#title'));
    check('trois repères en légende', (await page.$$('.legend span')).length === 3);
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    var s = await snap();
    check('grille 6 × 6 en normal', s.size === 6, s.size);
    check('autant de territoires que de côtés', new Set(s.regions).size === 6,
          new Set(s.regions).size + ' territoires');
    check('la grille commence vide', s.cells.every(function (v) { return v === 0; }));

    t.section('Qualité des grilles tirées au sort');
    // Trente grilles par taille, vérifiées une à une dans le navigateur.
    for (var n = 5; n <= 7; n++) {
      var report = await page.evaluate(function (size) {
        var bad = { unique: 0, regions: 0, solution: 0, failed: 0 };
        var samples = [];
        for (var k = 0; k < 30; k++) {
          var grid = window.__neonMeow.generate(size);
          if (!grid) { bad.failed++; continue; }
          if (window.__neonMeow.countSolutions(size, grid.regions, 3) !== 1) { bad.unique++; }
          if (new Set(grid.regions).size !== size) { bad.regions++; }
          // La solution annoncée respecte-t-elle bien toutes les règles ?
          var cols = grid.solution.map(function (c) { return c % size; });
          var rows = grid.solution.map(function (c) { return Math.floor(c / size); });
          var okRows = new Set(rows).size === size;
          var okCols = new Set(cols).size === size;
          var okRegions = new Set(grid.solution.map(function (c) { return grid.regions[c]; })).size === size;
          var okTouch = true;
          for (var a = 0; a < grid.solution.length; a++) {
            for (var b = a + 1; b < grid.solution.length; b++) {
              if (Math.abs(cols[a] - cols[b]) <= 1 && Math.abs(rows[a] - rows[b]) <= 1) { okTouch = false; }
            }
          }
          if (!(okRows && okCols && okRegions && okTouch)) { bad.solution++; }
          if (k < 3) { samples.push({ regions: grid.regions, solution: grid.solution }); }
        }
        return { bad: bad, samples: samples };
      }, n);

      check(n + ' × ' + n + ' : trente grilles produites', report.bad.failed === 0,
            report.bad.failed + ' échec(s) de génération');
      check(n + ' × ' + n + ' : solution unique à chaque fois', report.bad.unique === 0,
            report.bad.unique + ' grille(s) ambiguë(s)');
      check(n + ' × ' + n + ' : un territoire par chat', report.bad.regions === 0,
            report.bad.regions + ' grille(s) mal découpée(s)');
      check(n + ' × ' + n + ' : la solution respecte les règles', report.bad.solution === 0,
            report.bad.solution + ' solution(s) fautive(s)');

      var broken = 0;
      report.samples.forEach(function (sample) {
        for (var r = 0; r < n; r++) { if (!connected(sample.regions, n, r)) { broken++; } }
      });
      check(n + ' × ' + n + ' : territoires d\'un seul tenant', broken === 0, broken + ' région(s) coupée(s)');
    }

    t.section('Poser, barrer, effacer');
    await page.goto(h.url('meow'));
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    await api('place', 0, 0, 1);
    s = await snap();
    check('un chat se pose', s.cells[0] === 1, s.cells[0]);
    check('le HUD compte les chats', (await page.textContent('#side')) === '1 / 6',
          await page.textContent('#side'));
    await api('place', 0, 0, 1);
    check('le même clic le retire', (await snap()).cells[0] === 0);
    await api('place', 1, 1, 2);
    check('la case se barre', (await snap()).cells[1 * 6 + 1] === 2);

    t.section('Les bagarres');
    await api('place', 0, 0, 1);
    await api('place', 2, 0, 1);      // même ligne
    s = await snap();
    check('deux chats sur la même ligne se disputent', s.clashes === 2, s.clashes);
    await api('place', 2, 0, 1);
    await api('place', 1, 1, 1);      // en diagonale
    s = await snap();
    check('deux chats en diagonale aussi', s.clashes === 2, s.clashes);
    await api('place', 1, 1, 1);
    check('la grille redevient paisible', (await snap()).clashes === 0);

    t.section('Coup de patte et résolution');
    await page.goto(h.url('meow'));
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    await page.keyboard.press('h');
    s = await snap();
    check('le coup de patte pose un chat juste', s.cats === 1 && s.clashes === 0, s.cats + ' chat');
    check('il est décompté', s.hints === 1, s.hints);

    await api('solveNow');
    await page.waitForTimeout(300);
    s = await snap();
    check('la grille se valide quand tout est juste', s.grids === 1, s.grids + ' grille(s)');
    check('les points sont crédités', s.score > 0, s.score);
    check('succès « Première portée »', s.unlocked.indexOf('firstGrid') !== -1, s.unlocked.join(','));
    await page.screenshot({ path: h.shot('meow') });
    await page.waitForTimeout(1200);
    check('une nouvelle grille est tirée', (await snap()).cats === 0);

    t.section('Mode zen');
    await page.goto(h.url('meow'));
    await page.click('[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    var before = (await snap()).score;
    await page.keyboard.press('h');
    check('le coup de patte est gratuit en zen', (await snap()).score === before,
          before + ' → ' + (await snap()).score);
    check('aucun record en zen',
          (await page.evaluate(function () { return window.Progress.bestFor('zen'); })) === 0);
    await page.screenshot({ path: h.shot('meow-zen') });

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
