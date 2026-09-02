/* Neon Crates — manifeste. Septième jeu : un pousse-caisses. Il n'y a ni
   gravité ni adversaire, mais des tableaux à résoudre, et l'annulation comme
   mécanique de plein droit.

   Notation des tableaux :  # mur   . cible   $ caisse   * caisse sur cible
                            @ joueur          + joueur sur cible */
window.Games = window.Games || {};

Games.crates = (function () {
  'use strict';

  var PACKS = {
    easy: [
      { par: 3, rows: [
        '#######',
        '#     #',
        '#  .  #',
        '#  $  #',
        '#  @  #',
        '#######'] },
      { par: 7, rows: [
        '#######',
        '#.    #',
        '# $   #',
        '#  @  #',
        '#     #',
        '#######'] },
      { par: 15, rows: [
        '########',
        '#   .  #',
        '# $$   #',
        '#  @ . #',
        '########'] },
      { par: 16, rows: [
        '########',
        '#      #',
        '# $ $  #',
        '#  @   #',
        '# .  . #',
        '########'] }
    ],
    normal: [
      { par: 16, rows: [
        '#########',
        '# .   . #',
        '#  ###  #',
        '# $   $ #',
        '#   @   #',
        '#########'] },
      { par: 18, rows: [
        '#########',
        '#   #   #',
        '# $ # . #',
        '#   $   #',
        '# . @   #',
        '#########'] },
      { par: 22, rows: [
        '########',
        '#  .   #',
        '# ## # #',
        '# $    #',
        '#  @   #',
        '########'] },
      { par: 28, rows: [
        '########',
        '#  #   #',
        '# $$   #',
        '#. .   #',
        '#   @  #',
        '########'] }
    ],
    hard: [
      { par: 19, rows: [
        '#########',
        '# .   . #',
        '#  ###  #',
        '# $   $ #',
        '#   @   #',
        '#  . $  #',
        '#########'] },
      { par: 27, rows: [
        '#########',
        '#   .   #',
        '# # # # #',
        '# $ $ . #',
        '#   @   #',
        '#########'] },
      { par: 35, rows: [
        '##########',
        '#  .  .  #',
        '# ##  ## #',
        '#  $  $  #',
        '#    @   #',
        '##########'] },
      { par: 40, rows: [
        '#########',
        '#  ..   #',
        '# ## ## #',
        '# $  $  #',
        '#   @   #',
        '#########'] }
    ]
  };

  // Le mode libre reprend tous les tableaux, du plus simple au plus retors.
  PACKS.zen = PACKS.easy.concat(PACKS.normal, PACKS.hard);

  var RAMPS = {
    neon:    { crate: '#ffd166', done: '#38f9c3', target: '#55b6ff', wall: 'rgba(120, 150, 200, 0.22)', player: '#c084fc' },
    classic: { crate: '#c9a227', done: '#7ec850', target: '#e8eefc', wall: 'rgba(180, 180, 180, 0.22)', player: '#ff8f5e' },
    ocean:   { crate: '#8bdcf2', done: '#38f9c3', target: '#5cc6e6', wall: 'rgba(92, 198, 230, 0.20)', player: '#ffd166' },
    ember:   { crate: '#ffc45a', done: '#ff8f5e', target: '#ffe08a', wall: 'rgba(255, 143, 94, 0.20)', player: '#fff0bd' }
  };

  return {
    id: 'crates',
    name: 'Neon Crates',
    accent: 'Crates',
    tagline: 'Pousse chaque caisse sur sa cible.',
    icon: '📦',
    color: '#ffd166',
    hint: 'Flèches pour pousser — {U} annule, {R} recommence le tableau',
    sideLabel: 'Tableau',
    legend: [
      { color: '#ffd166', label: 'Caisse' },
      { color: '#55b6ff', label: 'Cible' },
      { color: '#38f9c3', label: 'Caisse placée' }
    ],

    packs: PACKS,
    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    pack: 'easy',
        hint: 'Quatre tableaux d\'initiation, une ou deux caisses.' },
      { id: 'normal', label: 'Normal',    pack: 'normal',
        hint: 'Quatre tableaux avec des murs qui gênent.' },
      { id: 'hard',   label: 'Difficile', pack: 'hard',
        hint: 'Quatre tableaux serrés : une caisse dans un coin est perdue.' },
      { id: 'zen',    label: 'Libre',     pack: 'zen', forgiving: true,
        hint: 'Les douze tableaux à la suite, et {N} passe au suivant.' }
    ],

    rules: {
      goal: 'Pousse chaque caisse sur une cible.',
      how: [
        'Le pousseur avance aux flèches et pousse la caisse qu\'il rencontre.',
        'On ne pousse jamais deux caisses à la fois, ni une caisse contre un mur.',
        'Une caisse ne se tire pas : il faut se placer du bon côté avant.',
        'Annuler fait partie du jeu — le dernier pas se reprend autant de fois qu\'il le faut.'
      ],
      scoring: [
        'Un tableau résolu vaut 100 points.',
        'Chaque pas économisé sous le nombre conseillé en rapporte 10 de plus.'
      ],
      note: 'Les douze tableaux sont prouvés solubles, et le nombre de pas conseillé est celui de la meilleure solution. Une caisse coincée dans un coin est signalée : elle ne bougera plus.'
    },
    settings: [
      { key: 'deadlock', type: 'toggle', label: 'Signaler les caisses bloquées', default: true,
        note: 'Marque en rouge une caisse coincée dans un coin' },
      { key: 'grid', type: 'toggle', label: 'Quadrillage', default: false,
        note: 'Lignes de repère sur le sol' }
    ],

    run: {
      counters: ['levels', 'moves', 'pushes'],
      maxima: { maxLevel: { start: 1, total: 'bestLevel' } }
    },

    stats: {
      tiles: [
        { label: 'Tableaux résolus', from: 'levels' },
        { label: 'Pas effectués',    from: 'moves' },
        { label: 'Poussées',         from: 'pushes' },
        { label: 'Meilleur tableau', from: 'bestLevel' },
        { label: 'Temps de jeu',     from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',   from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstLevel', name: 'Premier tableau', desc: 'Résoudre un tableau',
        test: function (run) { return run.levels >= 1; } },
      { id: 'underPar', name: 'Économe', desc: 'Résoudre un tableau sous le nombre de pas conseillé',
        test: function (run) { return !!run.underPar; } },
      { id: 'noUndo', name: 'Du premier coup', desc: 'Résoudre un tableau sans annuler',
        test: function (run) { return !!run.cleanLevel; } },
      { id: 'packEasy', name: 'Série facile', desc: 'Terminer les quatre tableaux faciles',
        test: function (run) { return run.difficulty === 'easy' && run.levels >= 4; } },
      { id: 'packNormal', name: 'Série normale', desc: 'Terminer les quatre tableaux normaux',
        test: function (run) { return run.difficulty === 'normal' && run.levels >= 4; } },
      { id: 'packHard', name: 'Série difficile', desc: 'Terminer les quatre tableaux difficiles',
        test: function (run) { return run.difficulty === 'hard' && run.levels >= 4; } },
      { id: 'levels10', name: 'Déménageur', desc: 'Résoudre dix tableaux en tout',
        test: function (run, all) { return all.levels >= 10; } },
      { id: 'levels50', name: 'Chef d\'entrepôt', desc: 'Résoudre cinquante tableaux en tout',
        test: function (run, all) { return all.levels >= 50; } },
      { id: 'pushes500', name: 'Bras solides', desc: 'Pousser cinq cents fois en tout',
        test: function (run, all) { return all.pushes >= 500; } },
      { id: 'score2000', name: 'Deux mille', desc: 'Marquer 2 000 points en une partie',
        test: function (run) { return run.score >= 2000; } },
      { id: 'zenAll', name: 'Sérénité', desc: 'Résoudre huit tableaux en mode libre',
        test: function (run) { return run.difficulty === 'zen' && run.levels >= 8; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.crate,    head: RAMPS.neon.done,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.crate, head: RAMPS.classic.done, needs: 'firstLevel' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.crate,   head: RAMPS.ocean.done,   needs: 'packEasy' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.crate,   head: RAMPS.ember.done,   needs: 'underPar' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'packHard' }
    ]
  };
}());
