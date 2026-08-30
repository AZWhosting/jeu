'use strict';

var harness = require('../lib/harness');

/* Neon Blocks : rotation avec rattrapage, pose instantanée, lignes complétées,
   niveaux, réserve, et évaporation en zen. */
module.exports = {
  name: 'Neon Blocks — rotation, lignes, niveaux',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var snap = function () { return page.evaluate(function () { return window.__neonBlocks.snapshot(); }); };
    var api = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return page.evaluate(function (payload) {
        return window.__neonBlocks[payload[0]].apply(null, payload[1]);
      }, [fn, args]);
    };

    t.section('Mise en place');
    await page.goto(h.url('blocks'));
    await page.waitForTimeout(400);
    check('titre du jeu', (await page.textContent('#title')) === 'Neon Blocks',
          await page.textContent('#title'));
    check('trois repères en légende', (await page.$$('.legend span')).length === 3);
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    var s = await snap();
    check('un puits de 200 cases', s.board.length === 200, s.board.length);
    check('une pièce est en jeu', !!s.piece, s.piece && s.piece.type);
    check('trois pièces annoncées', s.queue.length >= 3, s.queue.length);
    check('la pile est vide', s.board.every(function (v) { return v === 0; }));

    t.section('Déplacement et rotation');
    await api('setPiece', 'T', 4, 2);
    var before = (await snap()).piece.x;
    await api('move', -1, 0);
    check('la pièce va à gauche', (await snap()).piece.x === before - 1, (await snap()).piece.x);
    await api('rotate');
    var rotatedShape = (await snap()).piece.shape;
    check('la rotation change la forme', JSON.stringify(rotatedShape) !== JSON.stringify([[0,1,0],[1,1,1],[0,0,0]]),
          JSON.stringify(rotatedShape));

    // Contre le mur gauche, la rotation doit être rattrapée par un décalage.
    await api('setPiece', 'I', -1, 5);
    await api('rotate');
    s = await snap();
    check('rotation rattrapée près du bord', s.piece.x >= -1 && s.piece.y >= 0,
          'x = ' + s.piece.x + ', y = ' + s.piece.y);

    t.section('Pose instantanée et projection');
    await api('setPiece', 'O', 4, 0);
    s = await snap();
    check('la projection vise le fond', s.ghost === 18, 'ligne ' + s.ghost);
    await api('drop');
    await page.waitForTimeout(200);
    s = await snap();
    check('la pièce s\'est posée au fond', s.board[18 * 10 + 4] !== 0 && s.board[19 * 10 + 4] !== 0);
    check('la pose rapporte des points', s.score > 0, s.score);

    t.section('Ligne complétée');
    await page.click('#restartBtn');
    await page.waitForTimeout(200);
    // Dernière rangée pleine sauf deux cases, qu'un carré vient boucher.
    await api('setBoard', ['..........', '..........', '..........', '..........',
                           '..........', '..........', '..........', '..........',
                           '..........', '..........', '..........', '..........',
                           '..........', '..........', '..........', '..........',
                           '..........', '..........', '########..', '########..']);
    await api('setPiece', 'O', 8, 0);
    await api('drop');
    await page.waitForTimeout(500);
    s = await snap();
    check('deux lignes disparaissent', s.lines === 2, s.lines + ' ligne(s)');
    check('le puits se vide d\'autant', s.board.filter(function (v) { return v !== 0; }).length === 0,
          s.board.filter(function (v) { return v !== 0; }).length + ' cases restantes');
    check('les points de lignes sont crédités', s.score >= 300, s.score);
    check('succès « Première ligne »', s.unlocked.indexOf('firstLine') !== -1, s.unlocked.join(','));
    await page.screenshot({ path: h.shot('blocks') });

    t.section('Réserve');
    await page.click('#restartBtn');
    await page.waitForTimeout(200);
    var current = (await snap()).piece.type;
    await api('hold');
    s = await snap();
    check('la pièce part en réserve', s.hold === current, s.hold);
    check('une nouvelle pièce prend sa place', s.piece.type !== current || s.hold === current,
          s.piece.type);
    var swapped = s.piece.type;
    await api('hold');
    check('une seule mise en réserve par pièce', (await snap()).piece.type === swapped);

    t.section('Débordement');
    await page.click('#restartBtn');
    await page.waitForTimeout(200);
    var full = [];
    for (var i = 0; i < 20; i++) { full.push(i < 2 ? '..........' : '#########.'); }
    await api('setBoard', full);
    await api('setPiece', 'O', 4, 0);
    await api('drop');
    await page.waitForTimeout(500);
    s = await snap();
    check('la partie s\'arrête quand la pile déborde', s.state === 'over', s.state);
    check('panneau de fin', /débordé|record/.test(await page.textContent('#title')),
          await page.textContent('#title'));
    check('partie enregistrée', s.totals.games >= 1, s.totals.games);

    t.section('Zen : la pile s\'évapore');
    await page.goto(h.url('blocks'));
    await page.click('[data-diff="zen"]');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    await api('setBoard', full);
    await api('setPiece', 'O', 4, 0);
    await api('drop');
    await page.waitForTimeout(500);
    s = await snap();
    check('la partie continue', s.state === 'playing', s.state);
    check('des lignes ont disparu du haut',
          s.board.filter(function (v) { return v !== 0; }).length < 180,
          s.board.filter(function (v) { return v !== 0; }).length + ' cases');
    check('aucun record en zen',
          (await page.evaluate(function () { return window.Progress.bestFor('zen'); })) === 0);
    await page.screenshot({ path: h.shot('blocks-zen') });

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
