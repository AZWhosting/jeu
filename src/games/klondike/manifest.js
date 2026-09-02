/* Neon Klondike — manifeste. La réussite que tout le monde appelle « le
   solitaire » : sept colonnes dont l'essentiel est caché, une pioche, et
   quatre fondations à monter de l'as au roi.

   Elle prend le contre-pied de Neon Cells, où tout est visible et où aucune
   donne insoluble n'est servie. Ici une partie du jeu est cachée, et toutes
   les donnes ne se gagnent pas — c'est la nature même du Klondike, et le jeu
   le dit plutôt que de le laisser découvrir. */
window.Games = window.Games || {};

Games.klondike = (function () {
  'use strict';

  var RAMPS = {
    neon: {
      red: '#ff5d8f', black: '#55b6ff', face: '#101a2c', edge: 'rgba(96, 165, 250, 0.55)',
      slot: 'rgba(96, 165, 250, 0.12)', back: 'rgba(56, 96, 170, 0.75)',
      home: '#60a5fa', pick: '#ffd166'
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
    id: 'klondike',
    name: 'Neon Klondike',
    accent: 'Klondike',
    tagline: 'Le solitaire : sept colonnes, une pioche, quatre fondations.',
    icon: '🂡',
    color: '#60a5fa',
    hint: 'Glisse une carte, tape-la pour l\'envoyer — {P} pioche, {U} annule',
    sideLabel: 'Fondations',
    legend: [
      { color: '#60a5fa', label: 'Colonnes : couleurs alternées, en descendant' },
      { color: '#ffd166', label: 'Seul un roi entre dans une colonne vide' },
      { color: '#38f9c3', label: 'Fondations : de l\'as au roi, par enseigne' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'easy',
    unrankedDifficulties: ['zen'],

    /* `pull` : combien de cartes la pioche retourne d'un coup.
       `redeals` : combien de fois on peut retourner la défausse (0 = sans limite). */
    difficulties: [
      { id: 'easy',   label: 'Facile',    pull: 1, redeals: 0, bonus: 1,
        hint: 'La pioche donne une carte, et se retourne autant qu\'on veut.' },
      { id: 'normal', label: 'Normal',    pull: 3, redeals: 0, bonus: 1.5,
        hint: 'La pioche donne trois cartes : deux sur trois restent hors d\'atteinte.' },
      { id: 'hard',   label: 'Difficile', pull: 3, redeals: 2, bonus: 2.2,
        hint: 'Trois cartes, et seulement deux retournements de la pioche.' },
      { id: 'zen',    label: 'Libre',     pull: 1, redeals: 0, bonus: 1, forgiving: true,
        hint: 'Une carte, pioche sans limite, et rien n\'est classé.' }
    ],

    rules: {
      goal: 'Monte les 52 cartes sur les quatre fondations, de l\'as au roi.',
      how: [
        'Dans les colonnes, on empile en descendant et en alternant les couleurs : un valet noir sur une dame rouge.',
        'Une colonne vide n\'accepte qu\'un roi — ou une suite qui commence par un roi.',
        'Une suite de cartes retournées se déplace d\'un seul geste, quelle que soit sa longueur.',
        'Découvrir la carte cachée d\'une colonne la retourne aussitôt.',
        'La pioche retourne une ou trois cartes selon la difficulté ; seule celle du dessus se joue.'
      ],
      scoring: [
        'Une carte montée sur une fondation vaut 10 points, une carte retournée 5.',
        'Redescendre une carte d\'une fondation en coûte 15.',
        'La réussite terminée rapporte 300 points, plus un point par seconde gagnée sur cinq minutes, le tout multiplié par la difficulté.'
      ],
      note: 'Contrairement à Neon Cells, une partie du jeu est cachée, et toutes les donnes ne se gagnent pas : c\'est la nature du Klondike. Le mode facile — une carte à la fois, pioche sans limite — est celui qui en laisse passer le plus.'
    },

    settings: [
      { key: 'auto', type: 'toggle', label: 'Montée automatique', default: false,
        note: 'Les cartes qui ne servent plus rejoignent seules leur fondation' },
      { key: 'guide', type: 'toggle', label: 'Guider le dépôt', default: true,
        note: 'Éclaire les emplacements qui acceptent la carte tenue' }
    ],

    run: {
      counters: ['wins', 'cards', 'moves', 'flips', 'undos'],
      maxima: { best: { start: 0, total: 'bestCards' } }
    },

    stats: {
      tiles: [
        { label: 'Réussites',       from: 'wins' },
        { label: 'Cartes montées',  from: 'cards' },
        { label: 'Coups joués',     from: 'moves' },
        { label: 'Cartes retournées', from: 'flips' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstFound', name: 'Premier as', desc: 'Monter une carte sur une fondation',
        test: function (run) { return run.cards >= 1; } },
      { id: 'firstWin', name: 'Première réussite', desc: 'Terminer une donne',
        test: function (run) { return run.wins >= 1; } },
      { id: 'halfWay', name: 'À mi-chemin', desc: 'Monter 26 cartes dans une même donne',
        test: function (run) { return run.best >= 26; } },
      { id: 'noUndo', name: 'Sans repentir', desc: 'Terminer une donne sans annuler',
        test: function (run) { return !!run.cleanWin; } },
      { id: 'quick', name: 'Main leste', desc: 'Terminer une donne en moins de cinq minutes',
        test: function (run) { return !!run.quickWin; } },
      { id: 'threeCards', name: 'Par trois', desc: 'Terminer une donne avec la pioche par trois',
        test: function (run) { return !!run.hardPullWin; } },
      { id: 'clearColumn', name: 'Colonne vidée', desc: 'Vider entièrement une colonne',
        test: function (run) { return !!run.emptied; } },
      { id: 'allFlipped', name: 'Rien de caché', desc: 'Retourner toutes les cartes cachées d\'une donne',
        test: function (run) { return !!run.allUp; } },
      { id: 'wins10', name: 'Habitué du tapis', desc: 'Réussir dix donnes en tout',
        test: function (run, all) { return all.wins >= 10; } },
      { id: 'cards500', name: 'Cinq cents cartes', desc: 'Monter cinq cents cartes en tout',
        test: function (run, all) { return all.cards >= 500; } },
      { id: 'flips200', name: 'Retourneur', desc: 'Retourner deux cents cartes en tout',
        test: function (run, all) { return all.flips >= 200; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.black,    head: RAMPS.neon.red,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.black, head: RAMPS.classic.red, needs: 'firstFound' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.black,   head: RAMPS.ocean.red,   needs: 'halfWay' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.black,   head: RAMPS.ember.red,   needs: 'firstWin' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'threeCards' }
    ]
  };
}());
