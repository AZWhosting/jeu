/* Neon Blocks — manifeste. Sixième jeu : gravité continue comme le Snake, mais
   avec une pièce qui tourne, une projection au sol et un verrouillage retardé. */
window.Games = window.Games || {};

Games.blocks = (function () {
  'use strict';

  // Une couleur par pièce : I, J, L, O, S, T, Z.
  var RAMPS = {
    neon:    ['#38f9c3', '#55b6ff', '#ff8f5e', '#ffd166', '#7ee787', '#c084fc', '#ff5d8f'],
    classic: ['#00f0f0', '#0000f0', '#f0a000', '#f0f000', '#00f000', '#a000f0', '#f00000'],
    ocean:   ['#8bdcf2', '#5cc6e6', '#35abd4', '#2490bd', '#175d86', '#b8ecf9', '#14496f'],
    ember:   ['#ffe08a', '#ffc45a', '#f7a832', '#f08b1c', '#dd6a14', '#bf4a15', '#ff5d8f']
  };

  return {
    id: 'blocks',
    name: 'Neon Blocks',
    accent: 'Blocks',
    tagline: 'Emboîte les pièces, complète les lignes.',
    icon: '🟦',
    color: '#c084fc',
    hint: 'Flèches pour déplacer et tourner — {Espace} pose la pièce d\'un coup, {C} la met de côté',
    sideLabel: 'Niveau',
    legend: [
      { color: '#c084fc', label: 'Haut : tourner' },
      { color: '#55b6ff', label: 'Bas : descendre' },
      { color: '#38f9c3', label: 'Espace : poser' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    difficulties: [
      { id: 'easy',   label: 'Facile',    start: 1, base: 1100, step: 60, min: 170,
        hint: 'Descente tranquille, la vitesse monte doucement.' },
      { id: 'normal', label: 'Normal',    start: 1, base: 900,  step: 70, min: 110,
        hint: 'Le rythme de référence : un niveau toutes les dix lignes.' },
      { id: 'hard',   label: 'Difficile', start: 5, base: 800,  step: 70, min: 70,
        hint: 'Départ au niveau 5, et ça ne ralentit jamais.' },
      { id: 'zen',    label: 'Zen',       start: 1, base: 1300, step: 40, min: 320, forgiving: true,
        hint: 'Pile pleine, les lignes du haut s\'évaporent : on ne perd jamais.' }
    ],

    settings: [
      { key: 'ghost', type: 'toggle', label: 'Projection au sol', default: true,
        note: 'Montre où la pièce va se poser' },
      { key: 'preview', type: 'choice', label: 'Pièces annoncées', default: '3',
        options: [
          { value: '1', label: 'Une' },
          { value: '3', label: 'Trois' }
        ],
        hint: function (value) {
          return value === '3' ? 'Trois pièces d\'avance : de quoi préparer ses coups.'
            : 'Une seule pièce d\'avance : à l\'ancienne.';
        } }
    ],

    run: {
      counters: ['lines', 'pieces', 'quads'],
      maxima: { maxLevel: { start: 1, total: 'bestLevel' } }
    },

    stats: {
      tiles: [
        { label: 'Lignes faites',   from: 'lines' },
        { label: 'Pièces posées',   from: 'pieces' },
        { label: 'Quadruplés',      from: 'quads' },
        { label: 'Meilleur niveau', from: 'bestLevel' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstLine', name: 'Première ligne', desc: 'Compléter une ligne',
        test: function (run) { return run.lines >= 1; } },
      { id: 'quad', name: 'Quadruplé', desc: 'Effacer quatre lignes d\'un coup',
        test: function (run) { return run.quads >= 1; } },
      { id: 'lines10', name: 'Dix d\'un coup', desc: 'Faire dix lignes en une partie',
        test: function (run) { return run.lines >= 10; } },
      { id: 'lines30', name: 'Bâtisseur', desc: 'Faire trente lignes en une partie',
        test: function (run) { return run.lines >= 30; } },
      { id: 'level5', name: 'Ça s\'accélère', desc: 'Atteindre le niveau 5',
        test: function (run) { return run.maxLevel >= 5; } },
      { id: 'level10', name: 'Vitesse de croisière', desc: 'Atteindre le niveau 10',
        test: function (run) { return run.maxLevel >= 10; } },
      { id: 'score5000', name: 'Cinq mille', desc: 'Marquer 5 000 points en une partie',
        test: function (run) { return run.score >= 5000; } },
      { id: 'score20000', name: 'Vingt mille', desc: 'Marquer 20 000 points en une partie',
        test: function (run) { return run.score >= 20000; } },
      { id: 'hard3000', name: 'Sous pression', desc: 'Marquer 3 000 points en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.score >= 3000; } },
      { id: 'lines500', name: 'Ouvrier qualifié', desc: 'Faire 500 lignes en tout',
        test: function (run, all) { return all.lines >= 500; } },
      { id: 'zenLines', name: 'Sérénité', desc: 'Faire vingt lignes en mode zen',
        test: function (run) { return run.difficulty === 'zen' && run.lines >= 20; } },
      { id: 'games25', name: 'Habitué', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon[0],    head: RAMPS.neon[5],    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic[0], head: RAMPS.classic[6], needs: 'firstLine' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean[0],   head: RAMPS.ocean[4],   needs: 'lines10' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember[0],   head: RAMPS.ember[4],   needs: 'quad' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'level10' }
    ]
  };
}());
