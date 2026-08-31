/* Neon Cells — manifeste. Neuvième jeu, et le premier jeu de cartes : une
   réussite FreeCell. Tout est visible dès la donne, donc rien n'est subi ;
   c'est aussi ce qui permet au jeu de ne servir que des donnes qu'il a lui-même
   prouvées solubles avant de les poser sur la table. */
window.Games = window.Games || {};

Games.cells = (function () {
  'use strict';

  /* Palettes : le rouge et le noir des enseignes, la face et la tranche des
     cartes, et le fond des emplacements vides. */
  var RAMPS = {
    neon: {
      red: '#ff5d8f', black: '#55b6ff', face: '#101a2c', edge: 'rgba(126, 231, 135, 0.55)',
      slot: 'rgba(126, 231, 135, 0.13)', home: '#7ee787', pick: '#ffd166'
    },
    classic: {
      red: '#e5484d', black: '#e8eefc', face: '#12161f', edge: 'rgba(232, 238, 252, 0.45)',
      slot: 'rgba(232, 238, 252, 0.12)', home: '#c9a227', pick: '#ffd166'
    },
    ocean: {
      red: '#ff9f45', black: '#8bdcf2', face: '#0c1b26', edge: 'rgba(92, 198, 230, 0.55)',
      slot: 'rgba(92, 198, 230, 0.14)', home: '#38f9c3', pick: '#ffe08a'
    },
    ember: {
      red: '#ffb45a', black: '#ffe6c4', face: '#1c1210', edge: 'rgba(255, 143, 94, 0.55)',
      slot: 'rgba(255, 143, 94, 0.14)', home: '#ff8f5e', pick: '#fff0bd'
    }
  };

  return {
    id: 'cells',
    name: 'Neon Cells',
    accent: 'Cells',
    tagline: 'Range les 52 cartes, rien n\'est caché.',
    icon: '🃏',
    color: '#7ee787',
    hint: 'Glisse une carte, ou tape-la pour l\'envoyer — {U} annule, {I} donne un indice',
    sideLabel: 'Réussites',
    legend: [
      { color: '#7ee787', label: 'Fondations : de l\'as au roi' },
      { color: '#ffd166', label: 'Colonnes : couleurs alternées, en descendant' },
      { color: '#55b6ff', label: 'Cellules : une carte chacune' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'easy',
    unrankedDifficulties: ['zen'],

    /* `cells` fixe le nombre de cellules libres : c'est tout l'écart de
       difficulté d'une réussite FreeCell. `bonus` récompense la contrainte. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    cells: 4, bonus: 1,
        hint: 'Quatre cellules libres : la réussite d\'origine.' },
      { id: 'normal', label: 'Normal',    cells: 3, bonus: 1.4,
        hint: 'Trois cellules libres : une case de manœuvre en moins.' },
      { id: 'hard',   label: 'Difficile', cells: 2, bonus: 2,
        hint: 'Deux cellules libres : chaque carte posée coûte cher.' },
      { id: 'zen',    label: 'Libre',     cells: 4, bonus: 1, forgiving: true,
        hint: 'Quatre cellules, sans classement ni chronomètre.' }
    ],

    settings: [
      { key: 'auto', type: 'toggle', label: 'Montée automatique', default: true,
        note: 'Une carte qui ne peut plus servir rejoint seule sa fondation' },
      { key: 'guide', type: 'toggle', label: 'Guider le dépôt', default: true,
        note: 'Éclaire les emplacements qui acceptent la carte tenue' }
    ],

    run: {
      counters: ['wins', 'cards', 'moves', 'undos', 'hints'],
      maxima: { streak: { start: 0, total: 'bestStreak' } }
    },

    stats: {
      tiles: [
        { label: 'Donnes réussies', from: 'wins' },
        { label: 'Cartes montées',  from: 'cards' },
        { label: 'Coups joués',     from: 'moves' },
        { label: 'Meilleure série', from: 'bestStreak' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstWin', name: 'Première réussite', desc: 'Terminer une donne',
        test: function (run) { return run.wins >= 1; } },
      { id: 'noUndo', name: 'Sans repentir', desc: 'Terminer une donne sans annuler',
        test: function (run) { return !!run.cleanWin; } },
      { id: 'noHint', name: 'En autonomie', desc: 'Terminer une donne sans demander d\'indice',
        test: function (run) { return !!run.soloWin; } },
      { id: 'quick', name: 'Main leste', desc: 'Terminer une donne en moins de trois minutes',
        test: function (run) { return !!run.quickWin; } },
      { id: 'tidy', name: 'Économe', desc: 'Terminer une donne en moins de cent coups',
        test: function (run) { return !!run.tidyWin; } },
      { id: 'oneCell', name: 'Une seule cellule', desc: 'Terminer une donne sans occuper deux cellules à la fois',
        test: function (run) { return !!run.oneCellWin; } },
      { id: 'streak3', name: 'Trois d\'affilée', desc: 'Enchaîner trois donnes réussies',
        test: function (run) { return run.streak >= 3; } },
      { id: 'hardWin', name: 'Deux cellules', desc: 'Terminer une donne en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.wins >= 1; } },
      { id: 'wins10', name: 'Habitué du tapis', desc: 'Réussir dix donnes en tout',
        test: function (run, all) { return all.wins >= 10; } },
      { id: 'wins50', name: 'Maître des cellules', desc: 'Réussir cinquante donnes en tout',
        test: function (run, all) { return all.wins >= 50; } },
      { id: 'cards1000', name: 'Mille cartes', desc: 'Monter mille cartes aux fondations en tout',
        test: function (run, all) { return all.cards >= 1000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.black,    head: RAMPS.neon.red,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.black, head: RAMPS.classic.red, needs: 'firstWin' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.black,   head: RAMPS.ocean.red,   needs: 'noUndo' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.black,   head: RAMPS.ember.red,   needs: 'quick' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'hardWin' }
    ]
  };
}());
