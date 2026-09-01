'use strict';

var harness = require('../lib/harness');

/* Neon Pixel : les règles du picross, et surtout la qualité des dessins servis.
   La promesse du genre est qu'on n'a jamais à deviner — que la seule déduction
   ligne par ligne suffit. On la vérifie ici en resolvant nous-mêmes les vingt
   dessins du dépôt avec un solveur qui ne sait faire que ça. */

/* --- solveur de lignes ------------------------------------------------ */
// 0 inconnu, 1 plein, 2 vide
function runsOf(cells) {
  var out = [], run = 0;
  cells.forEach(function (c) {
    if (c === 1) { run++; } else if (run) { out.push(run); run = 0; }
  });
  if (run) { out.push(run); }
  return out;
}

/* Toutes les dispositions d'une ligne compatibles avec ce qu'on sait déjà. */
function placements(len, cl, known) {
  var found = [];
  var need = cl.reduce(function (a, b) { return a + b; }, 0) + Math.max(0, cl.length - 1);
  if (need > len) { return found; }

  function fits(line) {
    for (var i = 0; i < line.length; i++) {
      if (known[i] && line[i] !== known[i]) { return false; }
    }
    return true;
  }
  function rec(ci, acc) {
    if (ci === cl.length) {
      var line = acc.slice();
      while (line.length < len) { line.push(2); }
      if (fits(line)) { found.push(line); }
      return;
    }
    var reste = cl.slice(ci).reduce(function (a, b) { return a + b; }, 0) + (cl.length - ci - 1);
    for (var start = acc.length; start + reste <= len; start++) {
      var line = acc.slice();
      while (line.length < start) { line.push(2); }
      for (var k = 0; k < cl[ci]; k++) { line.push(1); }
      if (ci < cl.length - 1) { line.push(2); }
      if (!fits(line)) { continue; }
      rec(ci + 1, line);
    }
  }
  rec(0, []);
  return found;
}

/* Ce que la ligne permet de déduire à coup sûr : les cases sur lesquelles
   toutes les dispositions possibles s'accordent. */
function deduce(len, cl, known) {
  var all = placements(len, cl, known);
  if (!all.length) { return null; }
  var out = known.slice();
  for (var i = 0; i < len; i++) {
    var v = all[0][i], same = true;
    for (var p = 1; p < all.length; p++) { if (all[p][i] !== v) { same = false; break; } }
    if (same) { out[i] = v; }
  }
  return out;
}

/* Passes successives sur les lignes puis les colonnes, jusqu'à immobilité.
   Aucune supposition, aucun retour en arrière : c'est tout le propos. */
function lineSolve(rows) {
  var n = rows.length, m = rows[0].length;
  var grid = [], y, x, i;
  for (y = 0; y < n; y++) { grid.push(new Array(m).fill(0)); }

  var rowClues = rows.map(function (r) {
    return runsOf(r.split('').map(function (c) { return c === '#' ? 1 : 2; }));
  });
  var colClues = [];
  for (x = 0; x < m; x++) {
    var col = [];
    for (y = 0; y < n; y++) { col.push(rows[y].charAt(x) === '#' ? 1 : 2); }
    colClues.push(runsOf(col));
  }

  var passes = 0, moved = true;
  while (moved && passes < 200) {
    moved = false;
    passes++;
    for (y = 0; y < n; y++) {
      var next = deduce(m, rowClues[y], grid[y]);
      if (!next) { return { ok: false, raison: 'contradiction ligne ' + y }; }
      for (i = 0; i < m; i++) { if (next[i] !== grid[y][i]) { grid[y][i] = next[i]; moved = true; } }
    }
    for (x = 0; x < m; x++) {
      var state = [];
      for (y = 0; y < n; y++) { state.push(grid[y][x]); }
      var nextCol = deduce(n, colClues[x], state);
      if (!nextCol) { return { ok: false, raison: 'contradiction colonne ' + x }; }
      for (y = 0; y < n; y++) {
        if (nextCol[y] !== grid[y][x]) { grid[y][x] = nextCol[y]; moved = true; }
      }
    }
  }

  var inconnues = 0;
  for (y = 0; y < n; y++) {
    for (x = 0; x < m; x++) { if (!grid[y][x]) { inconnues++; } }
  }
  if (inconnues) { return { ok: false, raison: inconnues + ' case(s) indécidables' }; }
  for (y = 0; y < n; y++) {
    for (x = 0; x < m; x++) {
      if (grid[y][x] !== (rows[y].charAt(x) === '#' ? 1 : 2)) {
        return { ok: false, raison: 'divergence en ' + x + ',' + y };
      }
    }
  }
  return { ok: true, passes: passes };
}

module.exports = {
  name: 'Neon Pixel — dessins déductibles et règles du picross',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;

    var snap = function () { return page.evaluate(function () { return window.__neonPixel.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonPixel[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };
    var set = function (key, value) {
      return page.evaluate(function (p) { window.Progress.setSetting(p[0], p[1]); }, [key, value]);
    };

    /* ---------------------------------------------------------------- */
    t.section('Mise en place');
    await page.goto(h.url('pixel'));
    await page.waitForTimeout(400);
    check('le jeu se présente', /Neon Pixel/.test(await page.title()), await page.title());

    /* ---------------------------------------------------------------- */
    t.section('Chaque dessin se déduit, sans jamais deviner');
    var packs = await api('packs');
    var total = 0, mauvais = [], plusDur = 0;
    Object.keys(packs).forEach(function (n) {
      packs[n].forEach(function (pic) {
        total++;
        var forme = pic.rows.length !== Number(n) ||
                    pic.rows.some(function (r) { return r.length !== Number(n) || /[^#.]/.test(r); });
        if (forme) { mauvais.push(pic.name + ' : mal formé'); return; }
        var r = lineSolve(pic.rows);
        if (!r.ok) { mauvais.push(pic.name + ' (' + n + '×' + n + ') : ' + r.raison); }
        else { plusDur = Math.max(plusDur, r.passes); }
      });
    });
    check('les ' + total + ' dessins sont bien formés et se résolvent par déduction seule',
          mauvais.length === 0 && total === 20,
          mauvais.join(' | ') || total + ' dessins, ' + plusDur + ' passes au plus');
    // Un dessin déductible n'a qu'une solution : la déduction ne choisit jamais.
    check('leur solution est donc unique', mauvais.length === 0);

    // Et le solveur sait dire non : une diagonale glisse librement.
    var diagonale = lineSolve(['#.', '.#']);
    check('le solveur refuse un motif ambigu', diagonale.ok === false, diagonale.raison);

    /* ---------------------------------------------------------------- */
    t.section('Les indices décrivent bien le dessin');
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(250);
    var s = await snap();
    var dessin = packs[String(s.n)][s.index];
    var attenduLignes = dessin.rows.map(function (r) {
      var runs = runsOf(r.split('').map(function (c) { return c === '#' ? 1 : 2; }));
      return runs.length ? runs : [0];
    });
    var attenduColonnes = [];
    for (var x = 0; x < s.n; x++) {
      var col = [];
      for (var y = 0; y < s.n; y++) { col.push(dessin.rows[y].charAt(x) === '#' ? 1 : 2); }
      var runs = runsOf(col);
      attenduColonnes.push(runs.length ? runs : [0]);
    }
    check('les indices des lignes correspondent',
          JSON.stringify(s.rowClues) === JSON.stringify(attenduLignes),
          JSON.stringify(s.rowClues[0]) + ' contre ' + JSON.stringify(attenduLignes[0]));
    check('ceux des colonnes aussi',
          JSON.stringify(s.colClues) === JSON.stringify(attenduColonnes));
    check('le compte de cases à remplir est juste',
          s.needed === dessin.rows.join('').split('#').length - 1, s.needed);

    /* ---------------------------------------------------------------- */
    t.section('Remplir juste, remplir faux');
    await set('autocross', false);
    await api('goTo', 0);
    var depart = await snap();
    var pleine = null, vide = null;
    for (var i = 0; i < depart.target.length; i++) {
      if (depart.target[i] && !pleine) { pleine = { x: i % depart.n, y: Math.floor(i / depart.n) }; }
      if (!depart.target[i] && !vide) { vide = { x: i % depart.n, y: Math.floor(i / depart.n) }; }
    }
    check('remplir une case du dessin est accepté', await api('fill', pleine.x, pleine.y) === true);
    var apres = await snap();
    check('elle compte et rapporte', apres.filled === 1 && apres.score > 0,
          apres.filled + ' case, ' + apres.score + ' points');

    var avantFaute = await snap();
    check('remplir une case hors du dessin est refusé',
          await api('fill', vide.x, vide.y) === false);
    var faute = await snap();
    check('la case reste vide', faute.cells[vide.y * faute.n + vide.x] === 0);
    check('la faute est comptée', faute.errors === 1, faute.errors);
    check('elle coûte une vie', faute.lives === avantFaute.lives - 1,
          avantFaute.lives + ' → ' + faute.lives);
    check('et des points', faute.score < avantFaute.score,
          avantFaute.score + ' → ' + faute.score);

    check('barrer une case ne coûte rien', await api('cross', vide.x, vide.y) === true);
    var barre = await snap();
    check('la croix est posée', barre.cells[vide.y * barre.n + vide.x] === 2);
    check('sans faute ni vie perdue', barre.errors === faute.errors && barre.lives === faute.lives);
    check('l\'annulation retire la croix', await api('undo') === true);
    check('la case est redevenue neutre',
          (await snap()).cells[vide.y * barre.n + vide.x] === 0);

    /* ---------------------------------------------------------------- */
    t.section('Le trait au glissé');
    await api('goTo', 0);
    var g = await api('geometry');
    var box = await page.evaluate(function () {
      var r = document.getElementById('board').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    var pt = function (cx, cy) {
      return { x: box.x + g.x0 + (cx + 0.5) * g.cell, y: box.y + g.y0 + (cy + 0.5) * g.cell };
    };
    // La ligne 2 du chat est pleine d'un bout à l'autre.
    var avantTrait = await snap();
    var a = pt(0, 2), b = pt(9, 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    var trait = await snap();
    var ligne2 = [];
    for (var c = 0; c < trait.n; c++) { ligne2.push(trait.cells[2 * trait.n + c]); }
    check('un trait remplit toute la ligne', ligne2.every(function (v) { return v === 1; }),
          ligne2.join(''));
    check('sans une seule faute', trait.errors === avantTrait.errors,
          avantTrait.errors + ' → ' + trait.errors);
    // Les fautes de la partie se cumulent, celles du dessin repartent de zéro.
    check('le compteur du dessin est reparti à zéro', avantTrait.slips === 0,
          'dessin ' + avantTrait.slips + ', partie ' + avantTrait.errors);

    // Repartir d'une case déjà pleine, dans le même mode, efface le trait.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    var efface = await snap();
    var ligne2bis = [];
    for (var d = 0; d < efface.n; d++) { ligne2bis.push(efface.cells[2 * efface.n + d]); }
    check('repasser sur des cases pleines les vide',
          ligne2bis.every(function (v) { return v === 0; }), ligne2bis.join(''));

    t.section('Barrer les lignes finies');
    await set('autocross', true);
    await api('goTo', 1);              // la Clé : des lignes courtes
    var cle = await snap();
    var but = [];
    for (var e = 0; e < cle.n; e++) { if (cle.target[e]) { but.push(e); } }
    for (var f = 0; f < but.length; f++) { await api('fill', but[f], 0); }
    var croisee = await snap();
    var reste = 0;
    for (var k = 0; k < croisee.n; k++) { if (croisee.cells[k] === 0) { reste++; } }
    check('la ligne complétée se barre toute seule', reste === 0,
          reste + ' case(s) encore neutres sur la première ligne');

    /* ---------------------------------------------------------------- */
    t.section('Achever un dessin, puis la galerie');
    await api('goTo', 0);
    var avantFin = await snap();
    await api('solve');
    await page.waitForTimeout(200);
    var fini = await snap();
    check('le dessin est reconnu achevé', fini.solved === true);
    check('il rapporte bien plus que les cases', fini.score > avantFin.score + fini.needed * 8,
          avantFin.score + ' → ' + fini.score);
    check('le succès de la première image tombe',
          fini.unlocked.indexOf('firstPicture') !== -1, fini.unlocked.join(', '));
    await page.screenshot({ path: h.shot('pixel-acheve') });
    await page.waitForTimeout(1900);
    var suivant = await snap();
    check('le dessin suivant est servi', suivant.index === 1 && !suivant.solved,
          'dessin ' + (suivant.index + 1) + ' / ' + suivant.pictures);

    /* ---------------------------------------------------------------- */
    t.section('Les vies s\'épuisent');
    await page.goto(h.url('pixel'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="normal"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var vies = (await snap()).lives;
    var creuses = await page.evaluate(function () {
      var s = window.__neonPixel.snapshot(), out = [];
      for (var i = 0; i < s.target.length && out.length < 8; i++) {
        if (!s.target[i]) { out.push({ x: i % s.n, y: Math.floor(i / s.n) }); }
      }
      return out;
    });
    for (var v = 0; v < vies; v++) { await api('fill', creuses[v].x, creuses[v].y); }
    var mort = await snap();
    check('quatre fautes épuisent les quatre vies', mort.state === 'over', mort.state);
    check('le panneau nomme le dessin',
          /Chat/.test(await page.textContent('#subtitle')), await page.textContent('#subtitle'));

    t.section('En mode libre, les fautes ne tuent pas');
    await page.goto(h.url('pixel'));
    await page.waitForTimeout(300);
    await page.click('.choice[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var douces = await page.evaluate(function () {
      var s = window.__neonPixel.snapshot(), out = [];
      for (var i = 0; i < s.target.length && out.length < 6; i++) {
        if (!s.target[i]) { out.push({ x: i % s.n, y: Math.floor(i / s.n) }); }
      }
      return out;
    });
    for (var w = 0; w < douces.length; w++) { await api('fill', douces[w].x, douces[w].y); }
    var libre = await snap();
    check('six fautes et la partie continue', libre.state === 'playing', libre.state);
    check('elles sont tout de même comptées', libre.errors === 6, libre.errors);
    check('le mode libre ne produit pas de record',
          await page.evaluate(function () { return window.Progress.bestFor('zen'); }) === 0);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
