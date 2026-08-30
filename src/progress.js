/* Neon Snake — persistance : réglages, statistiques, succès et skins.
   Aucun accès au DOM ici : uniquement des données et des règles. */
window.Progress = (function () {
  'use strict';

  var PREFIX = 'neon-snake:';
  var HISTORY_MAX = 30;

  function read(name, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + name);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function write(name, value) {
    try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); } catch (e) { /* navigation privée */ }
  }

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  var GRID_SIZES = { small: 15, medium: 21, large: 27 };

  var THEMES = {
    neon:  { label: 'Néon',       grid: 'rgba(120, 160, 220, 0.07)' },
    retro: { label: 'Rétro',      grid: 'rgba(110, 255, 150, 0.08)' },
    dusk:  { label: 'Crépuscule', grid: 'rgba(220, 150, 255, 0.08)' }
  };

  var SETTINGS_DEFAULTS = {
    grid: 'medium',
    speed: 'progressive',   // progressive | constant
    theme: 'neon',
    sound: true,
    effects: true,
    gridLines: true,
    skin: 'neon'
  };

  var settings = (function () {
    var stored = read('settings', null);
    var merged = {};
    Object.keys(SETTINGS_DEFAULTS).forEach(function (k) {
      merged[k] = (stored && stored[k] !== undefined) ? stored[k] : SETTINGS_DEFAULTS[k];
    });
    // Reprise de l'ancien réglage de son, stocké séparément avant les réglages.
    var legacySound = read('sound', null);
    if (stored === null && legacySound !== null) { merged.sound = legacySound; }
    return merged;
  }());

  function getSetting(name) { return settings[name]; }

  function setSetting(name, value) {
    settings[name] = value;
    write('settings', settings);
  }

  function gridSize() { return GRID_SIZES[settings.grid] || GRID_SIZES.medium; }
  function theme() { return THEMES[settings.theme] || THEMES.neon; }

  /* ------------------------------------------------------------------ */
  /* Skins                                                               */
  /* ------------------------------------------------------------------ */

  var SKINS = [
    { id: 'neon',    name: 'Néon',        body: '#2fd6ab', head: '#5cffd6', needs: null },
    { id: 'retro',   name: 'Rétro',       body: '#4ade5f', head: '#b6ff9c', needs: 'apples50' },
    { id: 'ice',     name: 'Glace',       body: '#4aa8ff', head: '#a8e0ff', needs: 'long25' },
    { id: 'orchid',  name: 'Orchidée',    body: '#c084fc', head: '#f0abfc', needs: 'combo5' },
    { id: 'ember',   name: 'Braise',      body: '#ff7a45', head: '#ffc46b', needs: 'score500' },
    { id: 'gold',    name: 'Or',          body: '#e0b13c', head: '#ffe08a', needs: 'score1000' },
    { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,   body: '#38f9c3', head: '#ffffff', needs: 'apples250' }
  ];

  function skinById(id) {
    for (var i = 0; i < SKINS.length; i++) { if (SKINS[i].id === id) { return SKINS[i]; } }
    return SKINS[0];
  }

  function isSkinUnlocked(skin) { return !skin.needs || !!unlocked()[skin.needs]; }

  function currentSkin() {
    var skin = skinById(settings.skin);
    return isSkinUnlocked(skin) ? skin : SKINS[0];
  }

  /* ------------------------------------------------------------------ */
  /* Succès                                                              */
  /* ------------------------------------------------------------------ */

  /* `run` = la partie en cours, `all` = les totaux (partie en cours incluse). */
  var ACHIEVEMENTS = [
    { id: 'firstBite', name: 'Premier repas',  desc: 'Manger une pomme',
      test: function (run) { return run.apples >= 1; } },
    { id: 'combo5',    name: 'Enchaîné',       desc: 'Atteindre un combo ×5',
      test: function (run) { return run.maxCombo >= 5; } },
    { id: 'long25',    name: 'Grand format',   desc: 'Atteindre 25 segments',
      test: function (run) { return run.maxLength >= 25; } },
    { id: 'score500',  name: 'Demi-millier',   desc: 'Marquer 500 points en une partie',
      test: function (run) { return run.score >= 500; } },
    { id: 'score1000', name: 'Millénaire',     desc: 'Marquer 1000 points en une partie',
      test: function (run) { return run.score >= 1000; } },
    { id: 'apples50',  name: 'Gourmand',       desc: 'Manger 50 pommes en tout',
      test: function (run, all) { return all.apples >= 50; } },
    { id: 'apples250', name: 'Insatiable',     desc: 'Manger 250 pommes en tout',
      test: function (run, all) { return all.apples >= 250; } },
    { id: 'ghost10',   name: 'Passe-muraille', desc: 'Ramasser 10 bonus fantôme',
      test: function (run, all) { return all.ghosts >= 10; } },
    { id: 'hard300',   name: 'Tête brûlée',    desc: 'Marquer 300 points en difficile',
      test: function (run) { return run.difficulty === 'hard' && run.score >= 300; } },
    { id: 'zen40',     name: 'Sérénité',       desc: 'Atteindre 40 segments en mode zen',
      test: function (run) { return run.difficulty === 'zen' && run.maxLength >= 40; } },
    { id: 'purist',    name: 'Puriste',        desc: 'Marquer 300 points sans ramasser un seul bonus',
      test: function (run) { return run.score >= 300 && run.powerups === 0; } },
    { id: 'games25',   name: 'Habitué',        desc: 'Jouer 25 parties',
      test: function (run, all) { return all.games >= 25; } }
  ];

  function unlocked() { return read('achievements', {}) || {}; }

  /* ------------------------------------------------------------------ */
  /* Statistiques                                                        */
  /* ------------------------------------------------------------------ */

  var TOTALS_DEFAULTS = {
    games: 0, apples: 0, powerups: 0, ghosts: 0, score: 0,
    bestLength: 0, bestCombo: 1, timeMs: 0,
    byDifficulty: {}, history: []
  };

  function totals() {
    var stored = read('totals', null) || {};
    var out = {};
    Object.keys(TOTALS_DEFAULTS).forEach(function (k) {
      var fallback = TOTALS_DEFAULTS[k];
      var value = stored[k];
      if (value === undefined || value === null) {
        value = (fallback && typeof fallback === 'object') ? (Array.isArray(fallback) ? [] : {}) : fallback;
      }
      out[k] = value;
    });
    return out;
  }

  /* Totaux projetés en incluant la partie en cours, pour évaluer les succès
     à chaud sans attendre la fin de la partie. */
  function projected(run) {
    var t = totals();
    return {
      games: t.games + 1,
      apples: t.apples + run.apples,
      powerups: t.powerups + run.powerups,
      ghosts: t.ghosts + run.ghosts,
      score: t.score + run.score,
      bestLength: Math.max(t.bestLength, run.maxLength),
      bestCombo: Math.max(t.bestCombo, run.maxCombo),
      timeMs: t.timeMs + run.durationMs
    };
  }

  function newRun(difficulty) {
    return {
      difficulty: difficulty, score: 0, apples: 0, powerups: 0, ghosts: 0,
      maxCombo: 1, maxLength: 3, durationMs: 0
    };
  }

  /* Débloque ce qui doit l'être et renvoie les nouveautés (succès + skins). */
  function evaluate(run, storedTotals) {
    var all = storedTotals || projected(run);
    var owned = unlocked();
    var fresh = [];

    ACHIEVEMENTS.forEach(function (a) {
      if (owned[a.id]) { return; }
      var ok = false;
      try { ok = a.test(run, all); } catch (e) { ok = false; }
      if (!ok) { return; }
      owned[a.id] = Date.now();
      fresh.push({ kind: 'achievement', id: a.id, name: a.name, desc: a.desc });
      SKINS.forEach(function (s) {
        if (s.needs === a.id) { fresh.push({ kind: 'skin', id: s.id, name: s.name, desc: 'Nouveau skin disponible' }); }
      });
    });

    if (fresh.length) { write('achievements', owned); }
    return fresh;
  }

  function bestFor(difficulty) { return read('best:' + difficulty, 0) || 0; }

  /* Clôture une partie : totaux, historique, record, puis succès. */
  function finishRun(run) {
    var t = totals();
    t.games += 1;
    t.apples += run.apples;
    t.powerups += run.powerups;
    t.ghosts += run.ghosts;
    t.score += run.score;
    t.timeMs += run.durationMs;
    t.bestLength = Math.max(t.bestLength, run.maxLength);
    t.bestCombo = Math.max(t.bestCombo, run.maxCombo);

    var per = t.byDifficulty[run.difficulty] || { games: 0, best: 0 };
    per.games += 1;

    var record = false;
    // Le mode zen n'a pas d'enjeu : il ne compte ni pour les records ni pour la courbe.
    if (run.difficulty !== 'zen') {
      record = run.score > bestFor(run.difficulty);
      if (record) { write('best:' + run.difficulty, run.score); }
      per.best = Math.max(per.best, run.score);
      t.history.push({ s: run.score, d: run.difficulty, t: Date.now() });
      if (t.history.length > HISTORY_MAX) { t.history = t.history.slice(-HISTORY_MAX); }
    }

    t.byDifficulty[run.difficulty] = per;
    write('totals', t);

    return { record: record, unlocked: evaluate(run, t) };
  }

  function resetAll() {
    ['settings', 'totals', 'achievements', 'difficulty', 'sound',
     'best:easy', 'best:normal', 'best:hard', 'best:zen'].forEach(function (k) {
      try { localStorage.removeItem(PREFIX + k); } catch (e) { /* ignore */ }
    });
    Object.keys(SETTINGS_DEFAULTS).forEach(function (k) { settings[k] = SETTINGS_DEFAULTS[k]; });
  }

  return {
    GRID_SIZES: GRID_SIZES,
    THEMES: THEMES,
    SKINS: SKINS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    getSetting: getSetting,
    setSetting: setSetting,
    gridSize: gridSize,
    theme: theme,
    skinById: skinById,
    isSkinUnlocked: isSkinUnlocked,
    currentSkin: currentSkin,
    unlocked: unlocked,
    totals: totals,
    newRun: newRun,
    evaluate: evaluate,
    finishRun: finishRun,
    bestFor: bestFor,
    resetAll: resetAll,
    read: read,
    write: write
  };
}());
