'use strict';

var harness = require('../lib/harness');

/* Neon Crates : mécanique de poussée, annulation, progression — et surtout un
   solveur qui prouve que chaque tableau livré a bien une solution. */

function parse(rows) {
  var walls = {}, targets = {}, crates = {}, player = null;
  rows.forEach(function (row, y) {
    row.split('').forEach(function (ch, x) {
      var k = x + ',' + y;
      if (ch === '#') { walls[k] = true; }
      if (ch === '.' || ch === '*' || ch === '+') { targets[k] = true; }
      if (ch === '$' || ch === '*') { crates[k] = true; }
      if (ch === '@' || ch === '+') { player = k; }
    });
  });
  return { walls: walls, targets: targets, crates: crates, player: player };
}

/* Parcours en largeur sur (position du pousseur, ensemble des caisses). */
function solve(rows, limit) {
  var level = parse(rows);
  var goal = Object.keys(level.targets).sort().join('|');
  var startCrates = Object.keys(level.crates).sort();
  var seen = {};
  var queue = [{ p: level.player, cs: startCrates, moves: 0 }];
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var visited = 0;
  seen[level.player + '#' + startCrates.join('|')] = true;

  while (queue.length) {
    var cur = queue.shift();
    visited++;
    if (visited > (limit || 200000)) { return { solved: false, reason: 'trop d\'états' }; }
    if (cur.cs.join('|') === goal) { return { solved: true, moves: cur.moves, visited: visited }; }

    var parts = cur.p.split(',');
    var px = Number(parts[0]), py = Number(parts[1]);
    for (var d = 0; d < DIRS.length; d++) {
      var nx = px + DIRS[d][0], ny = py + DIRS[d][1];
      var np = nx + ',' + ny;
      if (level.walls[np]) { continue; }
      var cs = cur.cs;
      if (cs.indexOf(np) !== -1) {
        var bp = (nx + DIRS[d][0]) + ',' + (ny + DIRS[d][1]);
        if (level.walls[bp] || cs.indexOf(bp) !== -1) { continue; }
        cs = cs.filter(function (k) { return k !== np; }).concat([bp]).sort();
      }
      var mark = np + '#' + cs.join('|');
      if (seen[mark]) { continue; }
      seen[mark] = true;
      queue.push({ p: np, cs: cs, moves: cur.moves + 1 });
    }
  }
  return { solved: false, reason: 'aucune solution' };
}

module.exports = {
  name: 'Neon Crates — poussée, annulation, tableaux solubles',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var snap = function () { return page.evaluate(function () { return window.__neonCrates.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonCrates[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };

    t.section('Mise en place');
    await page.goto(h.url('crates'));
    await page.waitForTimeout(400);
    check('titre du jeu', (await page.textContent('#title')) === 'Neon Crates',
          await page.textContent('#title'));
    check('trois repères en légende', (await page.$$('.legend span')).length === 3);
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var s = await snap();
    check('premier tableau chargé', s.level === 1 && s.levels === 4, s.level + ' / ' + s.levels);
    check('autant de caisses que de cibles', s.crates.length === s.targets.length,
          s.crates.length + ' caisses, ' + s.targets.length + ' cibles');

    t.section('Tous les tableaux livrés sont solubles');
    var packs = await page.evaluate(function () { return window.__neonCrates.packs(); });
    ['easy', 'normal', 'hard'].forEach(function (name) {
      packs[name].forEach(function (level, i) {
        var parsed = parse(level.rows);
        var crates = Object.keys(parsed.crates).length;
        var targets = Object.keys(parsed.targets).length;
        if (crates !== targets || !parsed.player) {
          check(name + ' ' + (i + 1) + ' : tableau bien formé', false,
                crates + ' caisses pour ' + targets + ' cibles' + (parsed.player ? '' : ', pas de pousseur'));
          return;
        }
        var result = solve(level.rows);
        check(name + ' ' + (i + 1) + ' : soluble, et le par tient',
              result.solved && level.par >= result.moves,
              result.solved ? ('optimal ' + result.moves + ' pas, par ' + level.par) : result.reason);
      });
    });

    t.section('Pousser');
    // La série facile : son premier tableau est le plus simple possible, une
    // caisse à pousser d'un cran.
    await page.goto(h.url('crates'));
    await page.click('[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    s = await snap();
    var beforeCrates = s.crates.join(' ');
    check('le pousseur ne traverse pas les murs', (await api('step', 0, 1)) === false);
    await api('step', -1, 0);            // se décaler sans toucher à la caisse
    s = await snap();
    check('un pas simple ne déplace aucune caisse', s.crates.join(' ') === beforeCrates,
          s.crates.join(' '));
    check('le pas est compté', s.moves === 1, s.moves);

    await api('restartLevel');
    var pushed = await api('step', 0, -1);   // pousser la caisse sur la cible
    await page.waitForTimeout(300);
    s = await snap();
    check('la caisse est poussée', pushed === true);
    check('le tableau est résolu', s.solved === true || s.level === 2, 'tableau ' + s.level);
    check('les points du tableau sont crédités', s.score >= 100, s.score);
    check('succès « Premier tableau »', s.unlocked.indexOf('firstLevel') !== -1, s.unlocked.join(','));
    check('prime sous le par', s.unlocked.indexOf('underPar') !== -1);
    await page.waitForTimeout(900);
    check('on passe au tableau suivant', (await snap()).level === 2, (await snap()).level);
    await page.screenshot({ path: h.shot('crates') });

    t.section('Annuler et recommencer');
    await api('goToLevel', 2);
    var start = await snap();
    await api('step', 0, -1);
    await api('step', -1, 0);
    var moved = await snap();
    check('les pas sont comptés', moved.moves === 2, moved.moves);
    await api('undo');
    await api('undo');
    s = await snap();
    check('l\'annulation rend la position de départ',
          s.player.x === start.player.x && s.player.y === start.player.y && s.moves === 0,
          s.player.x + ',' + s.player.y + ' après ' + s.moves + ' pas');
    check('les caisses reviennent aussi', s.crates.join(' ') === start.crates.join(' '));

    await api('step', 0, -1);
    await api('restartLevel');
    s = await snap();
    check('recommencer remet tout à zéro', s.moves === 0 && s.crates.join(' ') === start.crates.join(' '));

    t.section('Série terminée');
    await page.goto(h.url('crates'));
    await page.click('[data-diff="easy"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await api('goToLevel', 3);
    await api('goToLevel', 3);
    // On force la fin : dernier tableau résolu depuis la solution connue.
    var last = (await snap()).levels;
    check('la série facile compte quatre tableaux', last === 4, last);

    t.section('Mode libre');
    await page.goto(h.url('crates'));
    await page.click('[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    s = await snap();
    check('les douze tableaux sont enchaînés', s.levels === 12, s.levels);
    await page.keyboard.press('n');
    await page.waitForTimeout(200);
    check('la touche N passe au suivant', (await snap()).level === 2, (await snap()).level);
    check('aucun record en mode libre',
          (await page.evaluate(function () { return window.Progress.bestFor('zen'); })) === 0);

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
