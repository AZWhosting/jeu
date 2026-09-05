/* Neon Gems — manifeste. L'alignement en cascade : on échange deux gemmes
   voisines pour en aligner trois, ce qui les fait disparaître, ce qui fait
   tomber celles du dessus — et parfois repart tout seul. C'est la mécanique
   d'arcade-puzzle qui manquait à la plateforme : 2048 fusionne mais n'enchaîne
   pas, le Tetris fait tomber mais n'échange pas.

   Le jeu s'organise en paliers : un quota de points à atteindre dans un nombre
   de coups donné. Rater le quota arrête la partie ; l'atteindre en ouvre un
   plus haut, avec le même plateau et un budget de coups tout neuf. */
window.Games = window.Games || {};

Games.gems = (function () {
  'use strict';

  /* Sept couleurs par palette : le mode difficile les utilise toutes. Chaque
     gemme a aussi sa forme, pour que le plateau reste lisible quand les
     couleurs se ressemblent — ou qu'on les distingue mal. */
  var PALETTES = {
    neon:    ['#ff5d8f', '#38f9c3', '#ffd166', '#818cf8', '#8bdcf2', '#a3e635', '#fb923c'],
    classic: ['#e5484d', '#2fb872', '#f2c94c', '#5b7cfa', '#e8eefc', '#9b59b6', '#e07a3f'],
    ocean:   ['#5cc6e6', '#38f9c3', '#8bdcf2', '#2490bd', '#c9f2ff', '#7ee787', '#ff9f45'],
    ember:   ['#ff5d3a', '#ffb45a', '#ffe6c4', '#c1440e', '#ff8f5e', '#ffd166', '#f97316']
  };

  return {
    id: 'gems',
    name: 'Neon Gems',
    accent: 'Gems',
    tagline: 'Aligne trois gemmes, la cascade fait le reste.',
    icon: '💎',
    color: '#818cf8',
    hint: 'Glisse une gemme sur sa voisine — ou clique les deux',
    sideLabel: 'Palier',
    legend: [
      { color: '#818cf8', label: 'Trois gemmes alignées disparaissent' },
      { color: '#ffd166', label: 'Quatre ou plus laissent une gemme chargée' },
      { color: '#38f9c3', label: 'Une chargée emporte sa ligne et sa colonne' }
    ],

    palettes: PALETTES,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `colors` : combien de couleurs sur le plateau — moins il y en a, plus les
       alignements arrivent seuls. `budget` : les coups accordés par palier.
       `quota` : les points à faire au premier palier, `pente` ce qu'ajoute
       chacun des suivants. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    colors: 5, budget: 26, quota: 1000, pente: 700, bonus: 1,
        hint: 'Cinq couleurs et vingt-six coups : les alignements se présentent d\'eux-mêmes.' },
      { id: 'normal', label: 'Normal',    colors: 6, budget: 24, quota: 1000, pente: 600, bonus: 1.5,
        hint: 'Six couleurs, vingt-quatre coups : il faut déjà choisir ses échanges.' },
      { id: 'hard',   label: 'Difficile', colors: 7, budget: 22, quota: 1000, pente: 500, bonus: 2.2,
        hint: 'Sept couleurs, vingt-deux coups. Le quota monte moins vite — le plateau compense.' },
      { id: 'zen',    label: 'Détente',   colors: 6, budget: 60, quota: 0,    pente: 0,   bonus: 1,
        forgiving: true,
        hint: 'Soixante coups et aucun quota : on joue pour voir, et rien n\'est classé.' }
    ],

    rules: {
      goal: 'Atteindre le quota de points du palier avant d\'épuiser tes coups.',
      how: [
        'Échange deux gemmes voisines : l\'échange n\'est permis que s\'il aligne au moins trois gemmes identiques.',
        'Les gemmes alignées disparaissent, celles du dessus tombent, et de nouvelles arrivent par le haut.',
        'Si la chute réaligne quelque chose, la cascade repart — et chaque relance vaut plus cher.',
        'Un alignement de quatre gemmes ou plus laisse une gemme chargée : la faire disparaître emporte toute sa ligne et toute sa colonne.',
        'Quand plus aucun échange n\'est possible, le plateau se remélange tout seul, sans te coûter un coup.'
      ],
      scoring: [
        'Chaque gemme retirée vaut 10 points, multipliés par le rang de la cascade : ×1 au premier alignement, ×2 au deuxième, jusqu\'à ×5.',
        'Le palier franchi rapporte 200 points par palier atteint, multipliés par la prime de difficulté.',
        'Un coup qui n\'aligne rien est refusé : il ne coûte rien.'
      ],
      note: 'Le plateau servi n\'a jamais d\'alignement tout fait, et propose toujours au moins un échange possible : les deux sont vérifiés à chaque distribution, et refaits tant que ce n\'est pas le cas.'
    },

    settings: [
      { key: 'shapes', type: 'toggle', label: 'Formes distinctes', default: true,
        note: 'Une forme par couleur, pour lire le plateau sans compter sur la teinte' },
      { key: 'guide', type: 'toggle', label: 'Souffler un coup', default: false,
        note: 'Met en évidence un échange possible quand tu hésites plus de cinq secondes' }
    ],

    run: {
      counters: ['gems', 'moves', 'levels', 'chains', 'charged'],
      maxima: { best: { start: 1, total: 'bestLevel' } }
    },

    stats: {
      tiles: [
        { label: 'Gemmes alignées',  from: 'gems' },
        { label: 'Coups joués',      from: 'moves' },
        { label: 'Paliers franchis', from: 'levels' },
        { label: 'Meilleur palier',  from: 'bestLevel' },
        { label: 'Temps de jeu',     from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',   from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstMatch', name: 'Premier alignement', desc: 'Aligner trois gemmes',
        test: function (run) { return run.gems >= 3; } },
      { id: 'bigMatch', name: 'Cinq d\'un coup', desc: 'Aligner cinq gemmes d\'un seul échange',
        test: function (run) { return run.bestRun >= 5; } },
      { id: 'charged', name: 'Gemme chargée', desc: 'Créer une gemme chargée',
        test: function (run) { return run.charged >= 1; } },
      { id: 'blast', name: 'Ligne et colonne', desc: 'Faire exploser une gemme chargée',
        test: function (run) { return run.blasts >= 1; } },
      { id: 'chain3', name: 'Cascade', desc: 'Enchaîner trois alignements d\'un seul coup',
        test: function (run) { return run.bestChain >= 3; } },
      { id: 'chain5', name: 'Avalanche', desc: 'Enchaîner cinq alignements d\'un seul coup',
        test: function (run) { return run.bestChain >= 5; } },
      { id: 'level3', name: 'Troisième palier', desc: 'Atteindre le palier 3',
        test: function (run) { return run.best >= 3; } },
      { id: 'level6', name: 'Sixième palier', desc: 'Atteindre le palier 6',
        test: function (run) { return run.best >= 6; } },
      { id: 'hardLevel3', name: 'Sept couleurs', desc: 'Atteindre le palier 3 en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.best >= 3; } },
      { id: 'score5000', name: 'Cinq mille', desc: 'Marquer 5 000 points en une partie',
        test: function (run) { return run.score >= 5000; } },
      { id: 'gems1000', name: 'Mille gemmes', desc: 'Retirer mille gemmes en tout',
        test: function (run, all) { return all.gems >= 1000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        palette: PALETTES.neon,
        body: PALETTES.neon[3],    head: PALETTES.neon[0],    needs: null },
      { id: 'classic', name: 'Classique',   palette: PALETTES.classic,
        body: PALETTES.classic[3], head: PALETTES.classic[0], needs: 'firstMatch' },
      { id: 'ocean',   name: 'Océan',       palette: PALETTES.ocean,
        body: PALETTES.ocean[0],   head: PALETTES.ocean[1],   needs: 'charged' },
      { id: 'ember',   name: 'Braise',      palette: PALETTES.ember,
        body: PALETTES.ember[1],   head: PALETTES.ember[0],   needs: 'chain3' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'level3' }
    ]
  };
}());
