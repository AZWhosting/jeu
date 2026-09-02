/* Neon Meow — manifeste. Huitième jeu : un casse-tête de déduction pure, à la
   manière de Meowdoku. Un chat par territoire, jamais deux sur la même ligne
   ni la même colonne, et jamais deux qui se touchent — pas même en diagonale.
   Les grilles sont tirées au sort puis vérifiées : une seule solution. */
window.Games = window.Games || {};

Games.meow = (function () {
  'use strict';

  // Teintes de territoires : assez sourdes pour que les chats ressortent.
  // Huit teintes de territoires, réparties sur le cercle chromatique pour que
  // deux territoires voisins ne se confondent jamais. Assez sombres pour que
  // les chats ressortent.
  var REGIONS = {
    neon:    ['#1f5057', '#25386e', '#4a2a70', '#6b2560', '#6e2a3d', '#7a441f', '#5f5a1f', '#1f5c3d'],
    // Familles d'une seule teinte : c'est l'échelle de clarté qui les sépare.
    ginger:  ['#3a2113', '#5a3218', '#7a441f', '#9a5626', '#b3672f', '#4a2915', '#8a4d22', '#c47a3f'],
    ocean:   ['#0e2a44', '#123a5c', '#175384', '#1d6aa4', '#2482c4', '#0b2038', '#1a4f72', '#3f9bd6'],
    ember:   ['#3a1710', '#5a2216', '#7a2f1b', '#9a3d21', '#b34c27', '#4a1c13', '#8a3a20', '#c96b34']
  };

  var CATS = {
    neon:    { fur: '#38f9c3', ink: '#06121a', cross: '#8b9ac0', clash: '#ff5d8f' },
    ginger:  { fur: '#ff9f45', ink: '#2a1408', cross: '#c9a27a', clash: '#ff5d8f' },
    ocean:   { fur: '#8bdcf2', ink: '#08202e', cross: '#7fa8bd', clash: '#ff5d8f' },
    ember:   { fur: '#ffd166', ink: '#2a1408', cross: '#c2a06a', clash: '#ff5d8f' }
  };

  return {
    id: 'meow',
    name: 'Neon Meow',
    accent: 'Meow',
    tagline: 'Un chat par territoire, et pas de bagarre.',
    icon: '🐱',
    color: '#ff9f45',
    hint: 'Clic pour poser un chat, clic droit pour barrer — {H} donne un coup de patte',
    sideLabel: 'Chats',
    legend: [
      { color: '#38f9c3', label: 'Chat posé' },
      { color: '#8b9ac0', label: 'Case barrée' },
      { color: '#ff5d8f', label: 'Chats en bagarre' }
    ],

    regions: REGIONS,
    cats: CATS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    size: 5, base: 120,
        hint: 'Grilles de 5 × 5 : de quoi prendre le pli.' },
      { id: 'normal', label: 'Normal',    size: 6, base: 200,
        hint: 'Grilles de 6 × 6 : il faut vraiment déduire.' },
      { id: 'hard',   label: 'Difficile', size: 7, base: 320,
        hint: 'Grilles de 7 × 7 : les territoires deviennent retors.' },
      { id: 'zen',    label: 'Zen',       size: 6, base: 0, forgiving: true,
        hint: 'Sans chronomètre, et les coups de patte sont gratuits.' }
    ],

    rules: {
      goal: 'Installe un chat par territoire, sans qu\'aucun ne se gêne.',
      how: [
        'Un chat par territoire coloré, ni plus ni moins.',
        'Jamais deux chats sur la même ligne ni la même colonne.',
        'Jamais deux chats qui se touchent, pas même en diagonale.',
        'Un clic pose un chat ; un clic droit — ou un appui long — barre une case dont on a déduit qu\'elle est vide.'
      ],
      scoring: [
        'Chaque chat bien posé rapporte des points, et la grille achevée une prime qui décroît avec le temps.',
        'Un coup de patte place un chat juste, contre cinquante points.'
      ],
      note: 'Les grilles sont tirées au sort, jamais préécrites, et chacune n\'a qu\'une seule solution : tout se déduit, rien ne se devine.'
    },
    settings: [
      { key: 'clash', type: 'toggle', label: 'Signaler les bagarres', default: true,
        note: 'Colore en rose deux chats qui ne peuvent pas cohabiter' },
      { key: 'autocross', type: 'toggle', label: 'Barrer automatiquement', default: false,
        note: 'Barre les cases interdites dès qu\'un chat est posé' }
    ],

    run: {
      counters: ['grids', 'cats', 'hints'],
      maxima: { maxSize: { start: 0, total: 'bestSize' } }
    },

    stats: {
      tiles: [
        { label: 'Grilles résolues', from: 'grids' },
        { label: 'Chats posés',      from: 'cats' },
        { label: 'Coups de patte',   from: 'hints' },
        { label: 'Plus grande grille', from: 'bestSize' },
        { label: 'Temps de jeu',     from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',   from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstCat', name: 'Premier chat', desc: 'Poser un chat sur la grille',
        test: function (run) { return run.cats >= 1; } },
      { id: 'firstGrid', name: 'Première portée', desc: 'Résoudre une grille',
        test: function (run) { return run.grids >= 1; } },
      { id: 'noHint', name: 'Sans coup de patte', desc: 'Résoudre une grille sans aucune aide',
        test: function (run) { return !!run.cleanGrid; } },
      { id: 'fast60', name: 'Chat véloce', desc: 'Résoudre une grille en moins d\'une minute',
        test: function (run) { return run.fastest > 0 && run.fastest <= 60; } },
      { id: 'fast30', name: 'Chat de gouttière', desc: 'Résoudre une grille en moins de trente secondes',
        test: function (run) { return run.fastest > 0 && run.fastest <= 30; } },
      { id: 'grids3', name: 'Trois d\'affilée', desc: 'Résoudre trois grilles dans la même partie',
        test: function (run) { return run.grids >= 3; } },
      { id: 'bigGrid', name: 'Grande maisonnée', desc: 'Résoudre une grille de 7 × 7',
        test: function (run) { return run.maxSize >= 7; } },
      { id: 'grids10', name: 'Éleveur', desc: 'Résoudre dix grilles en tout',
        test: function (run, all) { return all.grids >= 10; } },
      { id: 'grids50', name: 'Refuge complet', desc: 'Résoudre cinquante grilles en tout',
        test: function (run, all) { return all.grids >= 50; } },
      { id: 'cats200', name: 'Deux cents chats', desc: 'Poser deux cents chats en tout',
        test: function (run, all) { return all.cats >= 200; } },
      { id: 'zenGrids', name: 'Sérénité', desc: 'Résoudre trois grilles en mode zen',
        test: function (run) { return run.difficulty === 'zen' && run.grids >= 3; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',   name: 'Néon',        regions: REGIONS.neon,   cat: CATS.neon,
        body: CATS.neon.fur,   head: '#2b3f6b', needs: null },
      { id: 'ginger', name: 'Roux',        regions: REGIONS.ginger, cat: CATS.ginger,
        body: CATS.ginger.fur, head: '#6b4423', needs: 'firstGrid' },
      { id: 'ocean',  name: 'Océan',       regions: REGIONS.ocean,  cat: CATS.ocean,
        body: CATS.ocean.fur,  head: '#175d86', needs: 'noHint' },
      { id: 'ember',  name: 'Braise',      regions: REGIONS.ember,  cat: CATS.ember,
        body: CATS.ember.fur,  head: '#6e3618', needs: 'fast60' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true, regions: REGIONS.neon, cat: CATS.neon,
        body: '#38f9c3', head: '#ff5d8f', needs: 'bigGrid' }
    ]
  };
}());
