/* Neon 2048 — manifeste. Deuxième jeu de la plateforme : il n'a ni boucle
   continue, ni obstacles, ni skin de personnage, et sert donc de banc d'essai
   au contrat défini par le socle. */
window.Games = window.Games || {};

Games['2048'] = (function () {
  'use strict';

  // Une teinte par puissance de deux, de 2 à 4096.
  var RAMPS = {
    // Chaque palier change franchement de teinte : deux tuiles voisines ne
    // doivent jamais se confondre.
    neon:    ['#2b4a63', '#2f6f8f', '#2f9a8f', '#38c39a', '#6ee06b', '#c9e04a',
              '#ffd166', '#ffb454', '#ff8f5e', '#ff5d8f', '#c084fc', '#8b7cf0'],
    classic: ['#eee4da', '#ede0c8', '#f2b179', '#f59563', '#f67c5f', '#f65e3b',
              '#edcf72', '#edcc61', '#edc850', '#edc53f', '#edc22e', '#3c3a32'],
    ocean:   ['#123a5c', '#14496f', '#175d86', '#1b74a0', '#2490bd', '#35abd4',
              '#5cc6e6', '#8bdcf2', '#b8ecf9', '#ffd166', '#ff8f5e', '#ff5d8f'],
    ember:   ['#4a1616', '#6b1d19', '#8c2a19', '#ad3a18', '#cf5216', '#e87418',
              '#f4941f', '#fbb03b', '#ffc75f', '#ffe08a', '#fff0bd', '#fffaf0']
  };

  return {
    id: '2048',
    name: 'Neon 2048',
    accent: '2048',
    tagline: 'Glisse, fusionne, vise la plus grande tuile.',
    icon: '🔢',
    color: '#ffd166',
    hint: 'Flèches / WASD / ZQSD pour glisser — {Espace} pour mettre en pause',
    sideLabel: 'Meilleure tuile',
    legend: [],                      // ce jeu n'a rien à légender

    ramps: RAMPS,
    defaultDifficulty: 'classic',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'classic', label: 'Classique', size: 4,
        hint: 'La grille 4 × 4 d\'origine.' },
      { id: 'tight',   label: 'Serré',     size: 3,
        hint: 'Grille 3 × 3 : chaque coup compte, et la place manque vite.' },
      { id: 'wide',    label: 'Large',     size: 5,
        hint: 'Grille 5 × 5 : de la place, des parties longues.' },
      { id: 'zen',     label: 'Zen',       size: 4, forgiving: true,
        hint: 'Sans issue, les plus petites tuiles s\'évaporent : on ne perd jamais.' }
    ],

    rules: {
      goal: 'Fais glisser les tuiles pour les fusionner et atteindre l\'objectif.',
      how: [
        'Une direction pousse toutes les tuiles à fond de ce côté.',
        'Deux tuiles identiques qui se rencontrent fusionnent en leur somme.',
        'Une tuile ne fusionne qu\'une fois par coup.',
        'Une nouvelle tuile apparaît après chaque coup qui a bougé quelque chose.'
      ],
      scoring: [
        'Chaque fusion rapporte la valeur de la tuile obtenue.',
        'La partie s\'arrête quand plus aucun coup ne change la grille.'
      ],
      note: 'Atteindre l\'objectif affiche la victoire, mais rien n\'oblige à s\'arrêter là. En mode zen, une grille sans issue voit ses plus petites tuiles s\'évaporer.'
    },
    settings: [
      { key: 'target', type: 'choice', label: 'Objectif', default: '2048',
        options: [
          { value: '1024', label: '1024' },
          { value: '2048', label: '2048' },
          { value: '4096', label: '4096' }
        ],
        hint: function (value) { return 'La partie est gagnée en atteignant la tuile ' + value + '.'; } },
      { key: 'spawn', type: 'choice', label: 'Nouvelles tuiles', default: 'classic',
        options: [
          { value: 'classic', label: 'Classique' },
          { value: 'gentle', label: 'Douces' }
        ],
        hint: function (value) {
          return value === 'classic'
            ? 'Une tuile sur dix apparaît en 4.'
            : 'Toutes les tuiles apparaissent en 2.';
        } }
    ],

    run: {
      counters: ['moves', 'merges'],
      maxima: { maxTile: { start: 0, total: 'bestTile' } }
    },

    stats: {
      tiles: [
        { label: 'Coups joués',     from: 'moves' },
        { label: 'Fusions',         from: 'merges' },
        { label: 'Meilleure tuile', from: 'bestTile' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' },
        { label: 'Parties jouées',  from: 'games' }
      ]
    },

    achievements: [
      { id: 'firstMerge', name: 'Première fusion', desc: 'Fusionner deux tuiles',
        test: function (run) { return run.merges >= 1; } },
      { id: 't128',  name: 'Ça chauffe',   desc: 'Atteindre la tuile 128',
        test: function (run) { return run.maxTile >= 128; } },
      { id: 't256',  name: 'Ça monte',     desc: 'Atteindre la tuile 256',
        test: function (run) { return run.maxTile >= 256; } },
      { id: 't512',  name: 'Bien lancé',   desc: 'Atteindre la tuile 512',
        test: function (run) { return run.maxTile >= 512; } },
      { id: 't1024', name: 'Presque',      desc: 'Atteindre la tuile 1024',
        test: function (run) { return run.maxTile >= 1024; } },
      { id: 't2048', name: 'Deux mille quarante-huit', desc: 'Atteindre la tuile 2048',
        test: function (run) { return run.maxTile >= 2048; } },
      { id: 'score5000',  name: 'Cinq mille', desc: 'Marquer 5 000 points en une partie',
        test: function (run) { return run.score >= 5000; } },
      { id: 'score20000', name: 'Vingt mille', desc: 'Marquer 20 000 points en une partie',
        test: function (run) { return run.score >= 20000; } },
      { id: 'merges1000', name: 'Fusionneur', desc: 'Réaliser 1 000 fusions en tout',
        test: function (run, all) { return all.merges >= 1000; } },
      { id: 'tight256', name: 'À l\'étroit', desc: 'Atteindre 256 sur la grille serrée',
        test: function (run) { return run.difficulty === 'tight' && run.maxTile >= 256; } },
      { id: 'efficient', name: 'Efficace', desc: 'Marquer 1 000 points en moins de 100 coups',
        test: function (run) { return run.score >= 1000 && run.moves <= 100; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon[2],    head: RAMPS.neon[9],    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic[2], head: RAMPS.classic[9], needs: 't256' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean[3],   head: RAMPS.ocean[8],   needs: 't512' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember[3],   head: RAMPS.ember[9],   needs: 'score5000' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 't2048' }
    ]
  };
}());
