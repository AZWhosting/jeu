/* Neon Pixel — manifeste. Douzième jeu : un picross. Les chiffres en marge
   disent la longueur des blocs pleins de chaque ligne et de chaque colonne ;
   il n'y a rien à deviner, tout se déduit. Et à la fin, contrairement à tous
   les autres jeux de la plateforme, ce qui reste n'est ni un score ni un état
   mais une image. */
window.Games = window.Games || {};

Games.pixel = (function () {
  'use strict';

  var RAMPS = {
    neon:    { fill: '#38f9c3', cross: '#8b9ac0', grid: 'rgba(120, 150, 200, 0.16)',
               clue: '#c7d3ee', done: '#7ee787', bad: '#ff5d8f' },
    classic: { fill: '#e8eefc', cross: '#8b9ac0', grid: 'rgba(200, 200, 200, 0.16)',
               clue: '#d8dee9', done: '#7ec850', bad: '#e5484d' },
    ocean:   { fill: '#8bdcf2', cross: '#5c7fa0', grid: 'rgba(92, 198, 230, 0.18)',
               clue: '#bfe6f5', done: '#38f9c3', bad: '#ff8f5e' },
    ember:   { fill: '#ffc45a', cross: '#a08060', grid: 'rgba(255, 143, 94, 0.18)',
               clue: '#ffe6c4', done: '#ff8f5e', bad: '#ff5d8f' }
  };

  return {
    id: 'pixel',
    name: 'Neon Pixel',
    accent: 'Pixel',
    tagline: 'Les chiffres disent tout : le dessin se déduit.',
    icon: '🖼️',
    color: '#7ee787',
    hint: 'Clic pour remplir — {X} bascule en mode croix, {Z} annule',
    sideLabel: 'Dessin',
    legend: [
      { color: '#38f9c3', label: 'Case pleine' },
      { color: '#8b9ac0', label: 'Case barrée : on sait qu\'elle est vide' },
      { color: '#ff5d8f', label: 'Erreur : elle coûte une vie' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `grid` est le côté de la grille, `lives` le nombre d'erreurs tolérées. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    grid: 5,  lives: 5, bonus: 1,
        hint: 'Huit dessins de 5 × 5, et cinq erreurs permises.' },
      { id: 'normal', label: 'Normal',    grid: 10, lives: 4, bonus: 1.5,
        hint: 'Huit dessins de 10 × 10, quatre erreurs permises.' },
      { id: 'hard',   label: 'Difficile', grid: 15, lives: 3, bonus: 2.2,
        hint: 'Quatre dessins de 15 × 15, trois erreurs seulement.' },
      { id: 'zen',    label: 'Libre',     grid: 10, lives: 0, forgiving: true, bonus: 1,
        hint: 'Les mêmes dessins, sans compter les erreurs ni le score.' }
    ],

    rules: {
      goal: 'Retrouve le dessin caché derrière les chiffres.',
      how: [
        'Les chiffres en marge donnent la longueur des blocs pleins de chaque ligne et de chaque colonne, dans l\'ordre.',
        'Entre deux blocs, il y a toujours au moins une case vide.',
        'On remplit au glissé : la première case touchée décide si le trait pose ou retire.',
        'Barrer une case ne coûte rien — c\'est une note, pas une affirmation.'
      ],
      scoring: [
        'Chaque case justement remplie vaut 8 points.',
        'Un dessin achevé rapporte 150 points, plus un point par seconde gagnée sur quatre minutes.',
        'Remplir une case qui devait rester vide coûte 20 points et une vie.'
      ],
      note: 'Il n\'y a jamais à deviner : les vingt dessins sont prouvés solubles par la seule déduction ligne par ligne, ce qui garantit aussi qu\'aucun n\'a deux solutions.'
    },
    settings: [
      { key: 'autocross', type: 'toggle', label: 'Barrer les lignes finies', default: true,
        note: 'Une ligne dont tous les blocs sont posés se barre toute seule' },
      { key: 'numbers', type: 'toggle', label: 'Griser les indices satisfaits', default: true,
        note: 'Un chiffre déjà honoré s\'efface pour ne plus encombrer' }
    ],

    run: {
      counters: ['pictures', 'cells', 'errors'],
      maxima: { maxPicture: { start: 0, total: 'bestPicture' } }
    },

    stats: {
      tiles: [
        { label: 'Dessins achevés', from: 'pictures' },
        { label: 'Cases remplies',  from: 'cells' },
        { label: 'Erreurs',         from: 'errors' },
        { label: 'Meilleure série', from: 'bestPicture' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstPicture', name: 'Première image', desc: 'Achever un dessin',
        test: function (run) { return run.pictures >= 1; } },
      { id: 'flawless', name: 'Sans une erreur', desc: 'Achever un dessin sans se tromper une fois',
        test: function (run) { return !!run.cleanPicture; } },
      { id: 'quick', name: 'Coup d\'œil', desc: 'Achever un dessin en moins de deux minutes',
        test: function (run) { return !!run.quickPicture; } },
      { id: 'bigGrid', name: 'Quinze sur quinze', desc: 'Achever un dessin en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.pictures >= 1; } },
      { id: 'packEasy', name: 'Série facile', desc: 'Achever les huit dessins de 5 × 5',
        test: function (run) { return run.difficulty === 'easy' && run.pictures >= 8; } },
      { id: 'packNormal', name: 'Série normale', desc: 'Achever les huit dessins de 10 × 10',
        test: function (run) { return run.difficulty === 'normal' && run.pictures >= 8; } },
      { id: 'packHard', name: 'Série difficile', desc: 'Achever les quatre dessins de 15 × 15',
        test: function (run) { return run.difficulty === 'hard' && run.pictures >= 4; } },
      { id: 'streak3', name: 'Trois d\'affilée', desc: 'Achever trois dessins dans une partie',
        test: function (run) { return run.pictures >= 3; } },
      { id: 'pictures20', name: 'Galerie', desc: 'Achever vingt dessins en tout',
        test: function (run, all) { return all.pictures >= 20; } },
      { id: 'cells2000', name: 'Deux mille cases', desc: 'Remplir deux mille cases en tout',
        test: function (run, all) { return all.cells >= 2000; } },
      { id: 'score3000', name: 'Trois mille', desc: 'Marquer 3 000 points en une partie',
        test: function (run) { return run.score >= 3000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.fill,    head: RAMPS.neon.done,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.fill, head: RAMPS.classic.done, needs: 'firstPicture' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.fill,   head: RAMPS.ocean.done,   needs: 'flawless' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.fill,   head: RAMPS.ember.done,   needs: 'packEasy' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'bigGrid' }
    ]
  };
}());
