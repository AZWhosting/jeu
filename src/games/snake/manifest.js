/* Neon Snake — manifeste : tout ce que le socle a besoin de savoir du jeu.
   Difficultés, réglages propres, vocabulaire des statistiques, succès, skins. */
window.Games = window.Games || {};

Games.snake = (function () {
  'use strict';

  var GRID_SIZES = { small: 15, medium: 21, large: 27 };

  return {
    id: 'snake',
    name: 'Neon Snake',
    accent: 'Snake',                 // partie du nom mise en couleur
    tagline: 'Mange, grandis, évite ta propre queue.',
    icon: '🐍',
    color: '#38f9c3',
    hint: 'Flèches / WASD / ZQSD — {Espace} pour mettre en pause',
    sideLabel: 'Combo',
    legend: [
      { color: '#ff5d8f', label: 'Pomme +10' },
      { color: '#ffd166', label: 'Or +50' },
      { color: '#55b6ff', label: 'Ralenti' },
      { color: '#a78bfa', label: 'Fantôme' }
    ],

    gridSizes: GRID_SIZES,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],   // sans enjeu : ni record, ni courbe

    difficulties: [
      { id: 'easy',   label: 'Facile',    baseTick: 150, minTick: 90,  wrap: true,  obstacles: 0,
        hint: 'Les murs se traversent, vitesse douce.' },
      { id: 'normal', label: 'Normal',    baseTick: 125, minTick: 68,  wrap: false, obstacles: 0,
        hint: 'Murs mortels, vitesse progressive.' },
      { id: 'hard',   label: 'Difficile', baseTick: 100, minTick: 52,  wrap: false, obstacles: 7,
        hint: 'Murs mortels, obstacles et rythme soutenu.' },
      { id: 'zen',    label: 'Zen',       baseTick: 165, minTick: 135, wrap: true,  obstacles: 0,
        immortal: true, countedCombo: true,
        hint: 'Rien ne tue, et le combo monte à chaque pomme.' }
    ],

    /* Les règles, telles que le panneau « i » les affiche. */
    rules: {
      goal: 'Mange les pommes pour grandir, sans te mordre la queue.',
      how: [
        'Le serpent avance tout seul : les flèches ne font que le tourner.',
        'Chaque pomme ramassée l\'allonge d\'une case — et l\'espace se réduit d\'autant.',
        'Se mordre soi-même est mortel ; les murs le sont selon la difficulté.',
        'Les bonus ont chacun leur effet : l\'or vaut cinq pommes mais s\'évapore, le ralenti calme le jeu, le fantôme laisse tout traverser.'
      ],
      scoring: [
        'Une pomme vaut 10 points, une pièce d\'or 50.',
        'Enchaîner deux prises à moins de 2,6 s fait monter le combo, jusqu\'à ×5, qui multiplie chaque prise.',
        'Le combo retombe à ×1 dès qu\'on traîne.'
      ],
      note: 'En mode zen rien ne tue, et le combo n\'a plus de chronomètre : il monte d\'un cran par pomme et ne redescend jamais.'
    },
    settings: [
      { key: 'grid', type: 'choice', label: 'Taille de la grille', default: 'medium',
        options: [
          { value: 'small', label: 'Petite' },
          { value: 'medium', label: 'Moyenne' },
          { value: 'large', label: 'Grande' }
        ],
        hint: function (value) {
          var n = GRID_SIZES[value];
          return n + ' × ' + n + ' cases — s\'applique à la prochaine partie.';
        } },
      { key: 'speed', type: 'choice', label: 'Vitesse', default: 'progressive',
        options: [
          { value: 'progressive', label: 'Progressive' },
          { value: 'constant', label: 'Constante' }
        ],
        hint: function (value) {
          return value === 'progressive'
            ? 'Le serpent accélère à mesure qu\'il grandit.'
            : 'Le rythme reste identique du début à la fin.';
        } },
      { key: 'gridLines', type: 'toggle', label: 'Quadrillage', default: true,
        note: 'Lignes de repère sur le plateau' }
    ],

    // Champs de la partie agrégés dans les totaux.
    run: {
      counters: ['apples', 'powerups', 'ghosts'],
      maxima: {
        maxLength: { start: 3, total: 'bestLength' },
        maxCombo:  { start: 1, total: 'bestCombo' }
      }
    },

    stats: {
      tiles: [
        { label: 'Pommes mangées', from: 'apples' },
        { label: 'Bonus ramassés', from: 'powerups' },
        { label: 'Longueur max',   from: 'bestLength' },
        { label: 'Meilleur combo', from: 'bestCombo', prefix: '×' },
        { label: 'Temps de jeu',   from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés', from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstBite', name: 'Premier repas',  desc: 'Manger une pomme',
        test: function (run) { return run.apples >= 1; } },
      { id: 'combo5',    name: 'Enchaîné',       desc: 'Atteindre un combo ×5',
        test: function (run) { return run.maxCombo >= 5; } },
      { id: 'long25',    name: 'Grand format',   desc: 'Atteindre 25 segments',
        test: function (run) { return run.maxLength >= 25; } },
      { id: 'score500',  name: 'Demi-millier',   desc: 'Marquer 500 points en une partie',
        test: function (run) { return run.score >= 500; } },
      { id: 'score1000', name: 'Millénaire',     desc: 'Marquer 1000 points en une partie',
        test: function (run) { return run.score >= 1000; } },
      { id: 'apples50',  name: 'Gourmand',       desc: 'Manger 50 pommes en tout',
        test: function (run, all) { return all.apples >= 50; } },
      { id: 'apples250', name: 'Insatiable',     desc: 'Manger 250 pommes en tout',
        test: function (run, all) { return all.apples >= 250; } },
      { id: 'ghost10',   name: 'Passe-muraille', desc: 'Ramasser 10 bonus fantôme',
        test: function (run, all) { return all.ghosts >= 10; } },
      { id: 'hard300',   name: 'Tête brûlée',    desc: 'Marquer 300 points en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.score >= 300; } },
      { id: 'zen40',     name: 'Sérénité',       desc: 'Atteindre 40 segments en mode zen',
        test: function (run) { return run.difficulty === 'zen' && run.maxLength >= 40; } },
      { id: 'purist',    name: 'Puriste',        desc: 'Marquer 300 points sans ramasser un seul bonus',
        test: function (run) { return run.score >= 300 && run.powerups === 0; } },
      { id: 'games25',   name: 'Habitué',        desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        body: '#2fd6ab', head: '#5cffd6', needs: null },
      { id: 'retro',   name: 'Rétro',       body: '#4ade5f', head: '#b6ff9c', needs: 'apples50' },
      { id: 'ice',     name: 'Glace',       body: '#4aa8ff', head: '#a8e0ff', needs: 'long25' },
      { id: 'orchid',  name: 'Orchidée',    body: '#c084fc', head: '#f0abfc', needs: 'combo5' },
      { id: 'ember',   name: 'Braise',      body: '#ff7a45', head: '#ffc46b', needs: 'score500' },
      { id: 'gold',    name: 'Or',          body: '#e0b13c', head: '#ffe08a', needs: 'score1000' },
      { id: 'rainbow', name: 'Arc-en-ciel', body: '#38f9c3', head: '#ffffff', rainbow: true, needs: 'apples250' }
    ]
  };
}());
