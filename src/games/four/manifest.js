/* Neon Four — manifeste. Cinquième jeu, et le premier à opposer un adversaire :
   l'IA joue par exploration minimax avec élagage alpha-bêta. */
window.Games = window.Games || {};

Games.four = (function () {
  'use strict';

  var PALETTES = {
    neon:    { you: '#38f9c3', ai: '#ff5d8f', board: 'rgba(85, 182, 255, 0.16)' },
    classic: { you: '#ffd166', ai: '#e5484d', board: 'rgba(74, 123, 255, 0.20)' },
    ocean:   { you: '#8bdcf2', ai: '#2490bd', board: 'rgba(92, 198, 230, 0.16)' },
    ember:   { you: '#ffe08a', ai: '#dd6a14', board: 'rgba(255, 143, 94, 0.16)' }
  };

  return {
    id: 'four',
    name: 'Neon Four',
    accent: 'Four',
    tagline: 'Aligne quatre jetons avant l\'adversaire.',
    icon: '🔴',
    color: '#ff5d8f',
    hint: 'Flèches pour viser, {Espace} pour lâcher le jeton — ou clique une colonne',
    sideLabel: 'Tour',
    legend: [
      { color: '#38f9c3', label: 'Tes jetons' },
      { color: '#ff5d8f', label: 'L\'adversaire' },
      { color: '#ffd166', label: 'Alignement gagnant' }
    ],

    palettes: PALETTES,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    depth: 2, blunder: 0.35, base: 300,
        hint: 'L\'adversaire regarde deux coups devant, et se trompe souvent.' },
      { id: 'normal', label: 'Normal',    depth: 4, blunder: 0.08, base: 700,
        hint: 'Quatre coups d\'avance : il voit venir les pièges simples.' },
      { id: 'hard',   label: 'Difficile', depth: 6, blunder: 0,    base: 1200,
        hint: 'Six coups d\'avance : il ne laisse rien passer.' },
      { id: 'zen',    label: 'Zen',       depth: 0, blunder: 1,    base: 0, forgiving: true,
        hint: 'L\'adversaire joue au hasard, et {U} annule ton dernier coup.' }
    ],

    rules: {
      goal: 'Aligne quatre jetons avant l\'adversaire.',
      how: [
        'Un jeton lâché dans une colonne tombe sur la première case libre.',
        'Quatre jetons alignés l\'emportent : horizontalement, verticalement ou en diagonale.',
        'La grille pleine sans alignement est un match nul.'
      ],
      scoring: [
        'Chaque jeton posé rapporte 10 points.',
        'La victoire ajoute une prime d\'autant plus grosse que la partie a été courte ; un nul en rapporte le tiers.'
      ],
      note: 'L\'adversaire explore vraiment l\'arbre des coups. Même en mode maladroit, il saisit toujours une victoire immédiate et pare toujours une défaite immédiate.'
    },
    settings: [
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
        } },
      { key: 'hints', type: 'toggle', label: 'Colonnes pleines grisées', default: true,
        note: 'Marque les colonnes où plus aucun jeton ne rentre' }
    ],

    run: {
      counters: ['wins', 'draws', 'moves'],
      maxima: {}
    },

    stats: {
      tiles: [
        { label: 'Victoires',      from: 'wins' },
        { label: 'Parties nulles', from: 'draws' },
        { label: 'Jetons joués',   from: 'moves' },
        { label: 'Temps de jeu',   from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés', from: 'score' },
        { label: 'Parties jouées', from: 'games' }
      ]
    },

    achievements: [
      { id: 'firstMove', name: 'Premier jeton', desc: 'Poser un jeton',
        test: function (run) { return run.moves >= 1; } },
      { id: 'firstWin', name: 'Quatre à la suite', desc: 'Gagner une partie',
        test: function (run) { return run.wins >= 1; } },
      { id: 'winNormal', name: 'Beau joueur', desc: 'Battre l\'adversaire en normal',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'normal'; } },
      { id: 'winHard', name: 'Stratège', desc: 'Battre l\'adversaire en difficile',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'hard'; } },
      { id: 'quickWin', name: 'Expéditif', desc: 'Gagner en douze jetons ou moins',
        test: function (run) { return run.wins >= 1 && run.moves <= 12; } },
      { id: 'longGame', name: 'Partie d\'échecs', desc: 'Jouer une partie de trente jetons ou plus',
        test: function (run) { return run.moves >= 30; } },
      { id: 'draw', name: 'Dos à dos', desc: 'Terminer sur une grille pleine',
        test: function (run) { return run.draws >= 1; } },
      { id: 'wins5', name: 'Habitué de la victoire', desc: 'Gagner cinq parties en tout',
        test: function (run, all) { return all.wins >= 5; } },
      { id: 'wins20', name: 'Redoutable', desc: 'Gagner vingt parties en tout',
        test: function (run, all) { return all.wins >= 20; } },
      { id: 'moves500', name: 'Jeton après jeton', desc: 'Poser 500 jetons en tout',
        test: function (run, all) { return all.moves >= 500; } },
      { id: 'zenWin', name: 'Sérénité', desc: 'Gagner une partie en mode zen',
        test: function (run) { return run.difficulty === 'zen' && run.wins >= 1; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        palette: PALETTES.neon,
        body: PALETTES.neon.you,    head: PALETTES.neon.ai,    needs: null },
      { id: 'classic', name: 'Classique',   palette: PALETTES.classic,
        body: PALETTES.classic.you, head: PALETTES.classic.ai, needs: 'firstWin' },
      { id: 'ocean',   name: 'Océan',       palette: PALETTES.ocean,
        body: PALETTES.ocean.you,   head: PALETTES.ocean.ai,   needs: 'winNormal' },
      { id: 'ember',   name: 'Braise',      palette: PALETTES.ember,
        body: PALETTES.ember.you,   head: PALETTES.ember.ai,   needs: 'quickWin' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#c084fc', needs: 'winHard' }
    ]
  };
}());
