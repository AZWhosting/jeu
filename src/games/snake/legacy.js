/* Neon Snake — reprise des données enregistrées avant la plateforme.
   L'ancien schéma (neon-snake:*) est transféré une fois vers le nouveau
   (neon:app:* pour les réglages partagés, neon:snake:* pour le reste), puis
   effacé. Ce fichier pourra disparaître une fois les joueurs migrés. */
(function () {
  'use strict';

  var OLD = 'neon-snake:';
  var S = Core.Storage;

  function old(name) {
    try {
      var raw = localStorage.getItem(OLD + name);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (e) { return undefined; }
  }

  function drop(name) {
    try { localStorage.removeItem(OLD + name); } catch (e) { /* ignore */ }
  }

  var settings = old('settings');
  var totals = old('totals');
  var achievements = old('achievements');
  var difficulty = old('difficulty');
  var sound = old('sound');
  var bests = ['easy', 'normal', 'hard', 'zen'].map(function (d) { return { d: d, value: old('best:' + d) }; });

  var hasSomething = settings !== undefined || totals !== undefined || achievements !== undefined ||
                     difficulty !== undefined || sound !== undefined ||
                     bests.some(function (b) { return b.value !== undefined; });
  if (!hasSomething) { return; }

  var app = S.read('app', 'settings', {}) || {};
  var game = S.read('snake', 'settings', {}) || {};

  if (settings) {
    ['theme', 'sound', 'effects'].forEach(function (k) {
      if (settings[k] !== undefined && app[k] === undefined) { app[k] = settings[k]; }
    });
    ['grid', 'speed', 'gridLines', 'skin'].forEach(function (k) {
      if (settings[k] !== undefined && game[k] === undefined) { game[k] = settings[k]; }
    });
  }
  if (sound !== undefined && app.sound === undefined) { app.sound = sound; }
  if (difficulty !== undefined && game.difficulty === undefined) { game.difficulty = difficulty; }

  S.write('app', 'settings', app);
  S.write('snake', 'settings', game);
  if (totals !== undefined && S.read('snake', 'totals', null) === null) { S.write('snake', 'totals', totals); }
  if (achievements !== undefined && S.read('snake', 'achievements', null) === null) {
    S.write('snake', 'achievements', achievements);
  }
  bests.forEach(function (b) {
    if (b.value !== undefined && S.read('snake', 'best:' + b.d, null) === null) {
      S.write('snake', 'best:' + b.d, b.value);
    }
  });

  ['settings', 'totals', 'achievements', 'difficulty', 'sound',
   'best:easy', 'best:normal', 'best:hard', 'best:zen'].forEach(drop);
}());
