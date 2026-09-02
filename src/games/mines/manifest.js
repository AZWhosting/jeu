/* Neon Mines — manifeste. Quatrième jeu : ni boucle continue, ni animation
   permanente. Il apporte au socle une seconde action (poser un drapeau) et le
   clic sur une case précise. */
window.Games = window.Games || {};

Games.mines = (function () {
  'use strict';

  // Une couleur par nombre de mines voisines, de 1 à 8.
  var RAMPS = {
    neon:    ['#55b6ff', '#38f9c3', '#ff5d8f', '#a78bfa', '#ffd166', '#4aa8ff', '#f0abfc', '#e8eefc'],
    classic: ['#4a7bff', '#3fa34d', '#e5484d', '#2b3fa8', '#a1341f', '#1f8a8a', '#e8eefc', '#8b9ac0'],
    ocean:   ['#8bdcf2', '#5cc6e6', '#35abd4', '#2490bd', '#175d86', '#ffd166', '#ff8f5e', '#e8eefc'],
    ember:   ['#ffe08a', '#ffc45a', '#f7a832', '#f08b1c', '#dd6a14', '#bf4a15', '#ff5d8f', '#fff0bd']
  };

  return {
    id: 'mines',
    name: 'Neon Mines',
    accent: 'Mines',
    tagline: 'Découvre toutes les cases sûres, marque les mines.',
    icon: '💣',
    color: '#a78bfa',
    hint: 'Clic ou {Espace} pour découvrir — clic droit, appui long ou {F} pour marquer',
    sideLabel: 'Mines',
    legend: [
      { color: '#a78bfa', label: 'Clic : découvrir' },
      { color: '#ffd166', label: 'Clic droit : drapeau' },
      { color: '#55b6ff', label: 'Case révélée : déblayer autour' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    size: 9,  mines: 10,
        hint: 'Grille 9 × 9, dix mines.' },
      { id: 'normal', label: 'Normal',    size: 12, mines: 22,
        hint: 'Grille 12 × 12, vingt-deux mines.' },
      { id: 'hard',   label: 'Difficile', size: 16, mines: 45,
        hint: 'Grille 16 × 16, quarante-cinq mines : il faut déduire.' },
      { id: 'zen',    label: 'Zen',       size: 12, mines: 20, forgiving: true,
        hint: 'Une mine touchée est désamorcée : on ne perd jamais.' }
    ],

    rules: {
      goal: 'Découvre toutes les cases sans mine.',
      how: [
        'Un chiffre dit combien de mines touchent la case, en comptant les diagonales.',
        'Le clic droit — ou un appui long — plante un drapeau sur une case qu\'on croit minée.',
        'Recliquer sur un chiffre déjà découvert déblaie ses voisines, dès que les drapeaux posés autour correspondent.',
        'Une case vide ouvre en cascade tout son voisinage.'
      ],
      scoring: [
        'Chaque case révélée rapporte 10 points.',
        'La victoire ajoute une prime qui décroît avec le temps : les grilles vite déminées valent plus.'
      ],
      note: 'Le premier clic est toujours sûr : les mines ne sont posées qu\'après, jamais sous la case jouée ni ses voisines.'
    },
    settings: [
      { key: 'firstSafe', type: 'toggle', label: 'Premier clic sûr', default: true,
        note: 'Les mines sont posées après le premier clic, jamais dessous' },
      { key: 'autoFlag', type: 'toggle', label: 'Marquage automatique', default: false,
        note: 'Pose les drapeaux restants quand il ne reste que des mines' },
      { key: 'numbers', type: 'choice', label: 'Chiffres', default: 'colored',
        options: [
          { value: 'colored', label: 'Colorés' },
          { value: 'plain', label: 'Sobres' }
        ],
        hint: function (value) {
          return value === 'colored'
            ? 'Une couleur par chiffre, comme le démineur d\'origine.'
            : 'Tous les chiffres dans la couleur du texte.';
        } }
    ],

    run: {
      counters: ['cells', 'flags', 'wins'],
      maxima: { maxCells: { start: 0, total: 'bestCells' } }
    },

    stats: {
      tiles: [
        { label: 'Cases révélées', from: 'cells' },
        { label: 'Drapeaux posés', from: 'flags' },
        { label: 'Parties gagnées', from: 'wins' },
        { label: 'Temps de jeu',   from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés', from: 'score' },
        { label: 'Parties jouées', from: 'games' }
      ]
    },

    achievements: [
      { id: 'firstReveal', name: 'Premier coup', desc: 'Découvrir une case',
        test: function (run) { return run.cells >= 1; } },
      { id: 'firstWin', name: 'Terrain déminé', desc: 'Remporter une partie',
        test: function (run) { return run.wins >= 1; } },
      { id: 'winNormal', name: 'Sang-froid', desc: 'Gagner en difficulté normale',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'normal'; } },
      { id: 'winHard', name: 'Artificier', desc: 'Gagner en difficulté difficile',
        test: function (run) { return run.wins >= 1 && run.difficulty === 'hard'; } },
      { id: 'fast60', name: 'Rapide', desc: 'Gagner en moins d\'une minute',
        test: function (run) { return run.winTime > 0 && run.winTime <= 60; } },
      { id: 'fast30', name: 'Fulgurant', desc: 'Gagner en moins de trente secondes',
        test: function (run) { return run.winTime > 0 && run.winTime <= 30; } },
      { id: 'noFlags', name: 'De tête', desc: 'Gagner sans poser un seul drapeau',
        test: function (run) { return run.wins >= 1 && run.flags === 0; } },
      { id: 'bigSweep', name: 'Grand déblayage', desc: 'Révéler 150 cases en une partie',
        test: function (run) { return run.maxCells >= 150; } },
      { id: 'flags200', name: 'Cartographe', desc: 'Poser 200 drapeaux en tout',
        test: function (run, all) { return all.flags >= 200; } },
      { id: 'cells2000', name: 'Terrassier', desc: 'Révéler 2 000 cases en tout',
        test: function (run, all) { return all.cells >= 2000; } },
      { id: 'zenSweep', name: 'Sérénité', desc: 'Terminer une grille en mode zen',
        test: function (run) { return run.difficulty === 'zen' && run.wins >= 1; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        cover: '#1b2740', body: '#55b6ff', head: '#a78bfa', needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        cover: '#2b3245', body: '#4a7bff', head: '#3fa34d', needs: 'firstWin' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        cover: '#13324a', body: '#5cc6e6', head: '#8bdcf2', needs: 'winNormal' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        cover: '#33191a', body: '#ffc45a', head: '#f08b1c', needs: 'fast60' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        cover: '#241b3a', body: '#38f9c3', head: '#ff5d8f', needs: 'winHard' }
    ]
  };
}());
