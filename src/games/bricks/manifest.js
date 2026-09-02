/* Neon Bricks — manifeste. Troisième jeu : contrairement aux deux premiers, il
   repose sur une simulation continue (une balle qui rebondit), et fait donc
   travailler la boucle à pas fixe du socle pour de bon. */
window.Games = window.Games || {};

Games.bricks = (function () {
  'use strict';

  var RAMPS = {
    neon:    ['#38f9c3', '#55b6ff', '#a78bfa', '#ff5d8f', '#ffd166', '#7ee787', '#4aa8ff', '#f0abfc'],
    retro:   ['#4ade5f', '#7ef08a', '#b6ff9c', '#d9ffcc', '#4ade5f', '#7ef08a', '#b6ff9c', '#d9ffcc'],
    ocean:   ['#5cc6e6', '#35abd4', '#2490bd', '#1b74a0', '#175d86', '#14496f', '#5cc6e6', '#35abd4'],
    ember:   ['#ffe08a', '#ffc45a', '#f7a832', '#f08b1c', '#dd6a14', '#bf4a15', '#9c3318', '#7d2418']
  };

  return {
    id: 'bricks',
    name: 'Neon Bricks',
    accent: 'Bricks',
    tagline: 'Casse toutes les briques sans laisser tomber la balle.',
    icon: '🧱',
    color: '#55b6ff',
    hint: 'Flèches, souris ou doigt pour la raquette — {Espace} pour lancer la balle',
    sideLabel: 'Vies',
    legend: [
      { color: '#7ee787', label: 'Raquette large' },
      { color: '#55b6ff', label: 'Balle lente' },
      { color: '#ff5d8f', label: 'Vie en plus' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    lives: 4, rows: 4, paddle: 0.20, speed: 0.72,
        hint: 'Raquette large, balle patiente, quatre rangées.' },
      { id: 'normal', label: 'Normal',    lives: 3, rows: 5, paddle: 0.16, speed: 0.86,
        hint: 'Cinq rangées, et la balle accélère à chaque niveau.' },
      { id: 'hard',   label: 'Difficile', lives: 2, rows: 6, paddle: 0.12, speed: 1.02, tough: true,
        hint: 'Raquette étroite, six rangées, dont une à casser deux fois.' },
      { id: 'zen',    label: 'Zen',       lives: 3, rows: 4, paddle: 0.19, speed: 0.68, forgiving: true,
        hint: 'La balle rebondit aussi en bas : on ne perd jamais.' }
    ],

    rules: {
      goal: 'Casse toutes les briques sans laisser tomber la balle.',
      how: [
        'La raquette se pilote aux flèches, à la souris ou au doigt.',
        'L\'angle de renvoi dépend du point d\'impact : au centre la balle repart droit, sur le bord elle part de biais.',
        'Chaque niveau vidé ajoute une rangée et accélère un peu la balle.',
        'Les bonus tombent des briques cassées — il faut aller les chercher.'
      ],
      scoring: [
        'Chaque brique cassée rapporte des points ; les rangées du haut valent plus.',
        'Une balle perdue coûte une vie ; à zéro, la partie s\'arrête.'
      ],
      note: 'En mode zen la balle rebondit aussi en bas : on ne perd jamais.'
    },
    settings: [
      { key: 'ballSpeed', type: 'choice', label: 'Vitesse de la balle', default: 'normal',
        options: [
          { value: 'soft', label: 'Douce' },
          { value: 'normal', label: 'Normale' },
          { value: 'lively', label: 'Vive' }
        ],
        hint: function (value) {
          return value === 'soft' ? 'Un quart plus lente que la normale.'
            : value === 'lively' ? 'Un quart plus rapide : les réflexes comptent.'
            : 'La vitesse prévue pour chaque difficulté.';
        } },
      { key: 'pointer', type: 'toggle', label: 'Raquette au pointeur', default: true,
        note: 'La raquette suit la souris ou le doigt' },
      { key: 'bonuses', type: 'toggle', label: 'Bonus', default: true,
        note: 'Chutes à attraper avec la raquette' }
    ],

    run: {
      counters: ['bricks', 'bonuses', 'levels'],
      maxima: { maxLevel: { start: 1, total: 'bestLevel' } }
    },

    stats: {
      tiles: [
        { label: 'Briques cassées', from: 'bricks' },
        { label: 'Bonus attrapés',  from: 'bonuses' },
        { label: 'Meilleur niveau', from: 'bestLevel' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' },
        { label: 'Parties jouées',  from: 'games' }
      ]
    },

    achievements: [
      { id: 'firstBrick', name: 'Première brique', desc: 'Casser une brique',
        test: function (run) { return run.bricks >= 1; } },
      { id: 'level2', name: 'Deuxième service', desc: 'Atteindre le niveau 2',
        test: function (run) { return run.maxLevel >= 2; } },
      { id: 'level4', name: 'Endurant', desc: 'Atteindre le niveau 4',
        test: function (run) { return run.maxLevel >= 4; } },
      { id: 'level6', name: 'Increvable', desc: 'Atteindre le niveau 6',
        test: function (run) { return run.maxLevel >= 6; } },
      { id: 'score1000', name: 'Millier', desc: 'Marquer 1 000 points en une partie',
        test: function (run) { return run.score >= 1000; } },
      { id: 'score5000', name: 'Casseur confirmé', desc: 'Marquer 5 000 points en une partie',
        test: function (run) { return run.score >= 5000; } },
      { id: 'perfect', name: 'Sans une égratignure', desc: 'Finir un niveau sans perdre une seule balle',
        test: function (run) { return !!run.perfectLevel; } },
      { id: 'catcher', name: 'Bon attrapeur', desc: 'Attraper 25 bonus en tout',
        test: function (run, all) { return all.bonuses >= 25; } },
      { id: 'bricks500', name: 'Démolisseur', desc: 'Casser 500 briques en tout',
        test: function (run, all) { return all.bricks >= 500; } },
      { id: 'hard1000', name: 'Tête dure', desc: 'Marquer 1 000 points en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.score >= 1000; } },
      { id: 'purist', name: 'Puriste', desc: 'Finir un niveau sans attraper le moindre bonus',
        test: function (run) { return run.levels >= 1 && run.bonuses === 0; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        paddle: '#38f9c3', ball: '#ffffff', body: '#38f9c3', head: '#55b6ff', needs: null },
      { id: 'retro',   name: 'Rétro',       ramp: RAMPS.retro,
        paddle: '#4ade5f', ball: '#d9ffcc', body: '#4ade5f', head: '#b6ff9c', needs: 'level2' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        paddle: '#5cc6e6', ball: '#e8f8ff', body: '#5cc6e6', head: '#175d86', needs: 'level4' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        paddle: '#ff8f5e', ball: '#ffe08a', body: '#ff8f5e', head: '#ffe08a', needs: 'score1000' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        paddle: '#ffffff', ball: '#ffffff', body: '#38f9c3', head: '#ff5d8f', needs: 'score5000' }
    ]
  };
}());
