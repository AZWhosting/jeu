/* Neon Meow — manifeste. Huitième jeu : un casse-tête de déduction pure, à la
   manière de Meowdoku. Un chat par territoire, jamais deux sur la même ligne
   ni la même colonne, et jamais deux qui se touchent — pas même en diagonale.
   Les grilles sont tirées au sort puis vérifiées : une seule solution. */
window.Games = window.Games || {};

Games.meow = (function () {
  'use strict';

  // Teintes de territoires : assez sourdes pour que les chats ressortent.
  var REGIONS = {
    neon:    ['#1f4b57', '#2b3f6b', '#4a2f5e', '#5c2f45', '#5c4a24', '#27543f', '#3c3a5e', '#1f5450'],
    ginger:  ['#5c3a1e', '#6b4423', '#7a4f28', '#59321c', '#6e3d20', '#4d2d18', '#7d5730', '#43281a'],
    ocean:   ['#123a5c', '#14496f', '#175d86', '#1b74a0', '#10314d', '#1d5f7a', '#0f2a44', '#226b8c'],
    ember:   ['#4a2016', '#5c2a17', '#6e3618', '#7d4420', '#3d1a12', '#66301a', '#8a5228', '#472315']
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
