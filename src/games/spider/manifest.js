/* Neon Spider — manifeste. L'araignée : deux paquets, dix colonnes, et huit
   suites complètes à constituer du roi à l'as. C'est la troisième réussite de
   la plateforme, et la seule à jouer sur le nombre d'enseignes — d'une seule,
   où tout s'empile, à quatre, où chaque suite doit rester pure. */
window.Games = window.Games || {};

Games.spider = (function () {
  'use strict';

  var RAMPS = {
    neon: {
      red: '#ff5d8f', black: '#a78bfa', face: '#141026', edge: 'rgba(167, 139, 250, 0.55)',
      slot: 'rgba(167, 139, 250, 0.12)', back: 'rgba(96, 70, 170, 0.75)',
      home: '#a78bfa', pick: '#ffd166'
    },
    classic: {
      red: '#e5484d', black: '#e8eefc', face: '#12161f', edge: 'rgba(232, 238, 252, 0.45)',
      slot: 'rgba(232, 238, 252, 0.10)', back: 'rgba(120, 130, 150, 0.65)',
      home: '#c9a227', pick: '#ffd166'
    },
    ocean: {
      red: '#ff9f45', black: '#8bdcf2', face: '#0c1b26', edge: 'rgba(92, 198, 230, 0.55)',
      slot: 'rgba(92, 198, 230, 0.13)', back: 'rgba(40, 120, 150, 0.70)',
      home: '#38f9c3', pick: '#ffe08a'
    },
    ember: {
      red: '#ffb45a', black: '#ffe6c4', face: '#1c1210', edge: 'rgba(255, 143, 94, 0.55)',
      slot: 'rgba(255, 143, 94, 0.13)', back: 'rgba(150, 70, 45, 0.72)',
      home: '#ff8f5e', pick: '#fff0bd'
    }
  };

  return {
    id: 'spider',
    name: 'Neon Spider',
    accent: 'Spider',
    tagline: 'L\'araignée : huit suites à tisser, du roi à l\'as.',
    icon: '🕸️',
    color: '#a78bfa',
    hint: 'Glisse une suite — {P} distribue une rangée, {U} annule',
    sideLabel: 'Suites',
    legend: [
      { color: '#a78bfa', label: 'Une suite se déplace si elle est d\'une seule enseigne' },
      { color: '#ffd166', label: 'Une carte seule se pose sur n\'importe quel rang au-dessus' },
      { color: '#38f9c3', label: 'Du roi à l\'as : la suite s\'envole' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'easy',
    unrankedDifficulties: ['zen'],

    /* `suits` : combien d'enseignes composent les deux paquets. C'est tout
       l'écart de difficulté de l'araignée. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    suits: 1, bonus: 1,
        hint: 'Une seule enseigne : toute suite descendante est déplaçable.' },
      { id: 'normal', label: 'Normal',    suits: 2, bonus: 1.6,
        hint: 'Deux enseignes : une suite mêlée ne se déplace plus d\'un bloc.' },
      { id: 'hard',   label: 'Difficile', suits: 4, bonus: 2.5,
        hint: 'Les quatre enseignes : l\'araignée dans sa forme la plus retorse.' },
      { id: 'zen',    label: 'Libre',     suits: 1, bonus: 1, forgiving: true,
        hint: 'Une enseigne, annulation à volonté, et rien n\'est classé.' }
    ],

    rules: {
      goal: 'Constitue huit suites complètes, du roi à l\'as, pour les faire disparaître.',
      how: [
        'On empile en descendant, quelle que soit l\'enseigne : un 9 se pose sur n\'importe quel 10.',
        'Mais seule une suite d\'une même enseigne se déplace d\'un bloc — sinon, carte par carte.',
        'Une colonne vide accepte n\'importe quelle carte ou suite.',
        'Une suite complète du roi à l\'as, d\'une seule enseigne, s\'envole d\'elle-même.',
        'La pioche distribue une carte à chaque colonne d\'un coup — et refuse tant qu\'une colonne est vide.'
      ],
      scoring: [
        'Une suite envolée rapporte 150 points, multipliés par la prime de difficulté.',
        'La partie gagnée rapporte 400 points de plus, et un point par seconde gagnée sur cinq minutes.',
        'Chaque carte retournée en vaut 3.'
      ],
      note: 'Les cinquante cartes de la pioche tombent où elles veulent : une distribution peut casser un rangement patiemment construit. C\'est le jeu — mieux vaut vider une colonne avant de piocher.'
    },

    settings: [
      { key: 'guide', type: 'toggle', label: 'Guider le dépôt', default: true,
        note: 'Éclaire les colonnes qui acceptent la suite tenue' },
      { key: 'mixed', type: 'toggle', label: 'Signaler les suites mêlées', default: true,
        note: 'Grise une suite descendante que ses enseignes empêchent de bouger' }
    ],

    run: {
      counters: ['suites', 'moves', 'flips', 'deals'],
      maxima: { best: { start: 0, total: 'bestSuites' } }
    },

    stats: {
      tiles: [
        { label: 'Suites envolées',   from: 'suites' },
        { label: 'Coups joués',       from: 'moves' },
        { label: 'Cartes retournées', from: 'flips' },
        { label: 'Meilleure partie',  from: 'bestSuites' },
        { label: 'Temps de jeu',      from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',    from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstSuite', name: 'Première suite', desc: 'Faire s\'envoler une suite',
        test: function (run) { return run.suites >= 1; } },
      { id: 'fourSuites', name: 'À mi-toile', desc: 'Quatre suites dans une même partie',
        test: function (run) { return run.best >= 4; } },
      { id: 'firstWin', name: 'Toile achevée', desc: 'Terminer une partie : huit suites',
        test: function (run) { return run.best >= 8; } },
      { id: 'twoSuits', name: 'Deux enseignes', desc: 'Faire s\'envoler une suite en normal',
        test: function (run) { return run.difficulty === 'normal' && run.suites >= 1; } },
      { id: 'fourSuits', name: 'Quatre enseignes', desc: 'Faire s\'envoler une suite en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.suites >= 1; } },
      { id: 'noUndo', name: 'Sans repentir', desc: 'Faire s\'envoler une suite sans jamais annuler',
        test: function (run) { return !!run.cleanSuite; } },
      { id: 'noDeal', name: 'Avant la pioche', desc: 'Faire s\'envoler une suite sans avoir distribué',
        test: function (run) { return !!run.earlySuite; } },
      { id: 'emptied', name: 'Colonne vidée', desc: 'Vider entièrement une colonne',
        test: function (run) { return !!run.emptied; } },
      { id: 'suites20', name: 'Tisseuse', desc: 'Vingt suites envolées en tout',
        test: function (run, all) { return all.suites >= 20; } },
      { id: 'flips300', name: 'Retourneuse', desc: 'Trois cents cartes retournées en tout',
        test: function (run, all) { return all.flips >= 300; } },
      { id: 'score2000', name: 'Deux mille', desc: 'Marquer 2 000 points en une partie',
        test: function (run) { return run.score >= 2000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.black,    head: RAMPS.neon.red,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.black, head: RAMPS.classic.red, needs: 'firstSuite' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.black,   head: RAMPS.ocean.red,   needs: 'fourSuites' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.black,   head: RAMPS.ember.red,   needs: 'twoSuits' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'fourSuits' }
    ]
  };
}());
