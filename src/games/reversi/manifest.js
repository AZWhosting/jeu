/* Neon Reversi — manifeste. L'othello : huit cases sur huit, deux couleurs, et
   des pions qui changent de camp. C'est le second jeu de la plateforme à
   opposer un adversaire, et il demande à l'IA autre chose que le puissance 4 :
   là un alignement suffisait à trancher, ici il n'y a pas de coup gagnant à
   voir venir — seulement une position à évaluer. Coins, cases empoisonnées et
   mobilité font le gros du travail, et la fin de partie se résout exactement. */
window.Games = window.Games || {};

Games.reversi = (function () {
  'use strict';

  var PALETTES = {
    neon:    { you: '#34d399', ai: '#ff5d8f', board: 'rgba(52, 211, 153, 0.10)',
               line: 'rgba(52, 211, 153, 0.28)', hint: '#ffd166' },
    classic: { you: '#e8eefc', ai: '#1b2030', board: 'rgba(46, 138, 92, 0.30)',
               line: 'rgba(232, 238, 252, 0.22)', hint: '#ffd166' },
    ocean:   { you: '#8bdcf2', ai: '#2490bd', board: 'rgba(92, 198, 230, 0.12)',
               line: 'rgba(92, 198, 230, 0.30)', hint: '#38f9c3' },
    ember:   { you: '#ffe08a', ai: '#dd6a14', board: 'rgba(255, 143, 94, 0.12)',
               line: 'rgba(255, 143, 94, 0.30)', hint: '#fff0bd' }
  };

  return {
    id: 'reversi',
    name: 'Neon Reversi',
    accent: 'Reversi',
    tagline: 'L\'othello : encadre les pions adverses, ils passent dans ton camp.',
    icon: '⚪',
    color: '#34d399',
    hint: 'Flèches pour viser, {Espace} pour poser — ou clique une case',
    sideLabel: 'Pions',
    legend: [
      { color: '#34d399', label: 'Tes pions' },
      { color: '#ff5d8f', label: 'L\'adversaire' },
      { color: '#ffd166', label: 'Les cases où tu peux poser' }
    ],

    palettes: PALETTES,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `depth` : profondeur d'exploration. `exact` : à partir de combien de cases
       vides il ne cherche plus, il calcule la fin réelle. `blunder` : sa part
       de coups joués au hasard. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    depth: 1, exact: 0,  blunder: 0.4, base: 300,
        hint: 'Il ne regarde qu\'un coup devant, et joue souvent au hasard.' },
      { id: 'normal', label: 'Normal',    depth: 4, exact: 8,  blunder: 0.06, base: 700,
        hint: 'Quatre coups d\'avance, et les huit dernières cases calculées exactement.' },
      { id: 'hard',   label: 'Difficile', depth: 6, exact: 11, blunder: 0, base: 1300,
        hint: 'Six coups d\'avance, et une fin de partie qu\'il ne rate jamais.' },
      { id: 'zen',    label: 'Zen',       depth: 0, exact: 0,  blunder: 1, base: 0, forgiving: true,
        hint: 'L\'adversaire joue au hasard, et {U} annule ton dernier coup.' }
    ],

    rules: {
      goal: 'Avoir le plus de pions à ta couleur quand plus personne ne peut poser.',
      how: [
        'Un pion ne se pose que s\'il encadre au moins une ligne de pions adverses, entre lui et un des tiens.',
        'Toute ligne ainsi encadrée change de camp — en ligne droite, en colonne ou en diagonale.',
        'Poser sans rien retourner est interdit : les cases jouables sont marquées.',
        'Qui ne peut pas poser passe son tour, et l\'autre rejoue.',
        'La partie s\'arrête quand plus personne ne peut poser : le plus grand nombre de pions l\'emporte.'
      ],
      scoring: [
        'Chaque pion que tu poses rapporte 8 points, et chaque pion retourné 2 de plus.',
        'La victoire ajoute une prime de difficulté, augmentée de 6 points par pion d\'écart.',
        'Un match nul en rapporte le tiers.'
      ],
      note: 'Avoir le plus de pions au milieu de la partie ne veut presque rien dire : une position se juge aux coins, qui ne se retournent jamais, et au nombre de coups qu\'il reste à jouer. L\'adversaire, lui, la juge ainsi.'
    },

    settings: [
      { key: 'guide', type: 'toggle', label: 'Marquer les coups possibles', default: true,
        note: 'Pose un repère sur chaque case où tu peux jouer' },
      { key: 'count', type: 'toggle', label: 'Annoncer les retournements', default: true,
        note: 'Affiche combien de pions la case visée ferait changer de camp' },
      { key: 'first', type: 'choice', label: 'Qui commence', default: 'you',
        options: [
          { value: 'you', label: 'Toi' },
          { value: 'ai', label: 'L\'adversaire' },
          { value: 'alternate', label: 'En alternance' }
        ],
        hint: function (value) {
          return value === 'alternate'
            ? 'Le premier joueur change à chaque partie.'
            : value === 'you' ? 'Tu ouvres toujours la partie.' : 'L\'adversaire ouvre toujours.';
        } }
    ],

    run: {
      counters: ['wins', 'draws', 'moves', 'flips', 'corners'],
      maxima: { best: { start: 0, total: 'bestDiscs' } }
    },

    stats: {
      tiles: [
        { label: 'Victoires',        from: 'wins' },
        { label: 'Pions posés',      from: 'moves' },
        { label: 'Pions retournés',  from: 'flips' },
        { label: 'Meilleur total',   from: 'bestDiscs' },
        { label: 'Temps de jeu',     from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',   from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstMove', name: 'Premier pion', desc: 'Poser un pion',
        test: function (run) { return run.moves >= 1; } },
      { id: 'corner', name: 'Un coin', desc: 'Prendre un coin du plateau',
        test: function (run) { return run.corners >= 1; } },
      { id: 'firstWin', name: 'Majorité', desc: 'Gagner une partie',
        test: function (run) { return run.wins >= 1; } },
      { id: 'bigFlip', name: 'Grand retournement', desc: 'Retourner six pions d\'un seul coup',
        test: function (run) { return run.bestFlip >= 6; } },
      { id: 'allCorners', name: 'Les quatre coins', desc: 'Prendre les quatre coins dans une partie',
        test: function (run) { return run.corners >= 4; } },
      { id: 'winNormal', name: 'Beau joueur', desc: 'Battre l\'adversaire en normal',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'normal'; } },
      { id: 'winHard', name: 'Stratège', desc: 'Battre l\'adversaire en difficile',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'hard'; } },
      { id: 'crush', name: 'Quarante pions', desc: 'Finir une partie avec quarante pions ou plus',
        test: function (run) { return run.best >= 40; } },
      { id: 'comeback', name: 'Remontée', desc: 'Gagner après être descendu à cinq pions ou moins',
        test: function (run) { return run.wins >= 1 && !!run.wasLow; } },
      { id: 'draw', name: 'Trente-deux partout', desc: 'Terminer sur un match nul',
        test: function (run) { return run.draws >= 1; } },
      { id: 'wins10', name: 'Habitué du plateau', desc: 'Gagner dix parties en tout',
        test: function (run, all) { return all.wins >= 10; } },
      { id: 'flips1000', name: 'Mille retournements', desc: 'Retourner mille pions en tout',
        test: function (run, all) { return all.flips >= 1000; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        palette: PALETTES.neon,
        body: PALETTES.neon.you,    head: PALETTES.neon.ai,    needs: null },
      { id: 'classic', name: 'Tapis vert',  palette: PALETTES.classic,
        body: PALETTES.classic.you, head: PALETTES.classic.ai, needs: 'firstWin' },
      { id: 'ocean',   name: 'Océan',       palette: PALETTES.ocean,
        body: PALETTES.ocean.you,   head: PALETTES.ocean.ai,   needs: 'corner' },
      { id: 'ember',   name: 'Braise',      palette: PALETTES.ember,
        body: PALETTES.ember.you,   head: PALETTES.ember.ai,   needs: 'winNormal' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#c084fc', needs: 'winHard' }
    ]
  };
}());
