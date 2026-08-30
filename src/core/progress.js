/* Socle — progression d'un jeu : réglages, statistiques, succès et skins.
   Rien ici ne connaît un jeu en particulier : tout vient de son manifeste. */
window.Core = window.Core || {};

Core.createProgress = function (manifest) {
  'use strict';

  var S = Core.Storage;
  var APP = 'app';                  // espace des réglages partagés entre les jeux
  var GAME = manifest.id;
  var HISTORY_MAX = 30;

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  // Partagés par tous les jeux de la plateforme.
  var APP_DEFAULTS = { theme: 'neon', sound: true, effects: true };

  var THEMES = {
    neon:  { label: 'Néon',       grid: 'rgba(120, 160, 220, 0.07)' },
    retro: { label: 'Rétro',      grid: 'rgba(110, 255, 150, 0.08)' },
    dusk:  { label: 'Crépuscule', grid: 'rgba(220, 150, 255, 0.08)' }
  };

  var gameDefaults = { skin: (manifest.skins && manifest.skins[0] ? manifest.skins[0].id : null),
                       difficulty: manifest.defaultDifficulty };
  (manifest.settings || []).forEach(function (def) { gameDefaults[def.key] = def.default; });

  function loadSettings(space, defaults) {
    var stored = S.read(space, 'settings', null) || {};
    var merged = {};
    Object.keys(defaults).forEach(function (k) {
      merged[k] = stored[k] === undefined ? defaults[k] : stored[k];
    });
    return merged;
  }

  var appSettings = loadSettings(APP, APP_DEFAULTS);
  var gameSettings = loadSettings(GAME, gameDefaults);

  function isShared(key) { return Object.prototype.hasOwnProperty.call(APP_DEFAULTS, key); }

  function getSetting(key) { return isShared(key) ? appSettings[key] : gameSettings[key]; }

  function setSetting(key, value) {
    if (isShared(key)) { appSettings[key] = value; S.write(APP, 'settings', appSettings); }
    else { gameSettings[key] = value; S.write(GAME, 'settings', gameSettings); }
  }

  function theme() { return THEMES[appSettings.theme] || THEMES.neon; }

  /* ------------------------------------------------------------------ */
  /* Difficultés                                                         */
  /* ------------------------------------------------------------------ */

  function difficulties() { return manifest.difficulties || []; }

  function difficultyById(id) {
    var list = difficulties();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return list[0];
  }

  function difficulty() { return difficultyById(gameSettings.difficulty).id; }

  /* Une difficulté hors classement (le mode zen, par exemple) ne produit ni
     record ni point sur la courbe : sans enjeu, un score ne signifie rien. */
  function ranked(id) { return (manifest.unrankedDifficulties || []).indexOf(id) === -1; }

  /* ------------------------------------------------------------------ */
  /* Skins                                                               */
  /* ------------------------------------------------------------------ */

  function skins() { return manifest.skins || []; }

  function skinById(id) {
    var list = skins();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return list[0];
  }

  function isSkinUnlocked(skin) { return !skin.needs || !!unlocked()[skin.needs]; }

  function currentSkin() {
    var skin = skinById(gameSettings.skin);
    return (skin && isSkinUnlocked(skin)) ? skin : skins()[0];
  }

  /* ------------------------------------------------------------------ */
  /* Succès                                                              */
  /* ------------------------------------------------------------------ */

  function achievements() { return manifest.achievements || []; }

  function unlocked() { return S.read(GAME, 'achievements', {}) || {}; }

  /* ------------------------------------------------------------------ */
  /* Statistiques                                                        */
  /* ------------------------------------------------------------------ */

  var counters = (manifest.run && manifest.run.counters) || [];
  var maxima = (manifest.run && manifest.run.maxima) || {};

  function emptyTotals() {
    var t = { games: 0, score: 0, timeMs: 0, byDifficulty: {}, history: [] };
    counters.forEach(function (c) { t[c] = 0; });
    Object.keys(maxima).forEach(function (field) { t[maxima[field].total] = maxima[field].start || 0; });
    return t;
  }

  function totals() {
    var stored = S.read(GAME, 'totals', null) || {};
    var out = emptyTotals();
    Object.keys(out).forEach(function (k) {
      if (stored[k] !== undefined && stored[k] !== null) { out[k] = stored[k]; }
    });
    return out;
  }

  function newRun(difficultyId) {
    var run = { difficulty: difficultyId || difficulty(), score: 0, durationMs: 0 };
    counters.forEach(function (c) { run[c] = 0; });
    Object.keys(maxima).forEach(function (field) { run[field] = maxima[field].start || 0; });
    return run;
  }

  /* Totaux projetés en incluant la partie en cours : les succès peuvent ainsi
     être évalués à chaud, sans attendre la fin de la partie. */
  function projected(run) {
    var t = totals();
    var all = { games: t.games + 1, score: t.score + run.score, timeMs: t.timeMs + run.durationMs };
    counters.forEach(function (c) { all[c] = t[c] + run[c]; });
    Object.keys(maxima).forEach(function (field) {
      var name = maxima[field].total;
      all[name] = Math.max(t[name], run[field]);
    });
    return all;
  }

  /* Débloque ce qui doit l'être et renvoie les nouveautés (succès puis skins). */
  function evaluate(run, storedTotals) {
    var all = storedTotals || projected(run);
    var owned = unlocked();
    var fresh = [];

    achievements().forEach(function (a) {
      if (owned[a.id]) { return; }
      var ok = false;
      try { ok = a.test(run, all); } catch (e) { ok = false; }
      if (!ok) { return; }
      owned[a.id] = Date.now();
      fresh.push({ kind: 'achievement', id: a.id, name: a.name, desc: a.desc });
      skins().forEach(function (s) {
        if (s.needs === a.id) { fresh.push({ kind: 'skin', id: s.id, name: s.name, desc: 'Nouveau skin disponible' }); }
      });
    });

    if (fresh.length) { S.write(GAME, 'achievements', owned); }
    return fresh;
  }

  function bestFor(difficultyId) { return S.read(GAME, 'best:' + difficultyId, 0) || 0; }

  function bestOverall() {
    return difficulties().reduce(function (max, d) {
      return ranked(d.id) ? Math.max(max, bestFor(d.id)) : max;
    }, 0);
  }

  /* Clôture une partie : totaux, historique, record, puis succès. */
  function finishRun(run) {
    var t = totals();
    t.games += 1;
    t.score += run.score;
    t.timeMs += run.durationMs;
    counters.forEach(function (c) { t[c] += run[c]; });
    Object.keys(maxima).forEach(function (field) {
      var name = maxima[field].total;
      t[name] = Math.max(t[name], run[field]);
    });

    var per = t.byDifficulty[run.difficulty] || { games: 0, best: 0 };
    per.games += 1;

    var record = false;
    if (ranked(run.difficulty)) {
      record = run.score > bestFor(run.difficulty);
      if (record) { S.write(GAME, 'best:' + run.difficulty, run.score); }
      per.best = Math.max(per.best, run.score);
      t.history.push({ s: run.score, d: run.difficulty, t: Date.now() });
      if (t.history.length > HISTORY_MAX) { t.history = t.history.slice(-HISTORY_MAX); }
    }

    t.byDifficulty[run.difficulty] = per;
    S.write(GAME, 'totals', t);

    return { record: record, unlocked: evaluate(run, t) };
  }

  function reset() {
    S.clear(GAME);
    S.clear(APP);
    appSettings = loadSettings(APP, APP_DEFAULTS);
    gameSettings = loadSettings(GAME, gameDefaults);
  }

  return {
    manifest: manifest,
    THEMES: THEMES,
    getSetting: getSetting,
    setSetting: setSetting,
    theme: theme,
    difficulties: difficulties,
    difficulty: difficulty,
    difficultyById: difficultyById,
    ranked: ranked,
    skins: skins,
    skinById: skinById,
    isSkinUnlocked: isSkinUnlocked,
    currentSkin: currentSkin,
    achievements: achievements,
    unlocked: unlocked,
    totals: totals,
    newRun: newRun,
    evaluate: evaluate,
    finishRun: finishRun,
    bestFor: bestFor,
    bestOverall: bestOverall,
    reset: reset
  };
};
