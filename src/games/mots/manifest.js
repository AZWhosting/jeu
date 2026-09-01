/* Neon Mots — manifeste. Dixième jeu, et le premier qui ne demande ni réflexes
   ni raisonnement spatial : seulement du vocabulaire. Un mot caché, des essais,
   et à chaque essai la place exacte de chaque lettre. */
window.Games = window.Games || {};

Games.mots = (function () {
  'use strict';

  /* Palettes : la lettre bien placée, la lettre présente ailleurs, la lettre
     absente, et le fond des cases encore vides. */
  var RAMPS = {
    neon: {
      correct: '#38f9c3', present: '#ffd166', absent: 'rgba(120, 150, 200, 0.20)',
      empty: 'rgba(120, 150, 200, 0.10)', ink: '#06121a', edge: 'rgba(120, 150, 200, 0.30)'
    },
    classic: {
      correct: '#7ec850', present: '#c9a227', absent: 'rgba(200, 200, 200, 0.18)',
      empty: 'rgba(200, 200, 200, 0.09)', ink: '#0d1117', edge: 'rgba(232, 238, 252, 0.28)'
    },
    ocean: {
      correct: '#38f9c3', present: '#8bdcf2', absent: 'rgba(92, 198, 230, 0.20)',
      empty: 'rgba(92, 198, 230, 0.10)', ink: '#04161f', edge: 'rgba(92, 198, 230, 0.32)'
    },
    ember: {
      correct: '#ffc45a', present: '#ff8f5e', absent: 'rgba(255, 143, 94, 0.20)',
      empty: 'rgba(255, 143, 94, 0.10)', ink: '#1c0f08', edge: 'rgba(255, 143, 94, 0.32)'
    }
  };

  return {
    id: 'mots',
    name: 'Neon Mots',
    accent: 'Mots',
    tagline: 'Trouve le mot caché, lettre après lettre.',
    icon: '🔤',
    color: '#8bdcf2',
    hint: 'Tape le mot au clavier — {Entrée} valide, {Retour} efface',
    sideLabel: 'Série',
    legend: [
      { color: '#38f9c3', label: 'Lettre bien placée' },
      { color: '#ffd166', label: 'Lettre du mot, mal placée' },
      { color: '#8b9ac0', label: 'Lettre absente du mot' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `size` est la longueur du mot, `tries` le nombre d'essais. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    size: 4, tries: 6, bonus: 1,
        hint: 'Des mots de quatre lettres, six essais.' },
      { id: 'normal', label: 'Normal',    size: 5, tries: 6, bonus: 1.3,
        hint: 'Des mots de cinq lettres, six essais.' },
      { id: 'hard',   label: 'Difficile', size: 6, tries: 5, bonus: 1.8,
        hint: 'Des mots de six lettres, et un essai de moins.' },
      { id: 'zen',    label: 'Libre',     size: 5, tries: 8, bonus: 1, forgiving: true,
        hint: 'Huit essais, et un mot manqué n\'arrête pas la partie.' }
    ],

    settings: [
      { key: 'first', type: 'toggle', label: 'Première lettre offerte', default: true,
        note: 'Comme au Motus : le mot commence déjà pour toi' },
      { key: 'strict', type: 'toggle', label: 'Refuser les mots inconnus', default: true,
        note: 'La liste du jeu est limitée : décoche si elle refuse un vrai mot' }
    ],

    run: {
      counters: ['words', 'guesses', 'missed'],
      maxima: { streak: { start: 0, total: 'bestStreak' } }
    },

    stats: {
      tiles: [
        { label: 'Mots trouvés',    from: 'words' },
        { label: 'Essais joués',    from: 'guesses' },
        { label: 'Mots manqués',    from: 'missed' },
        { label: 'Meilleure série', from: 'bestStreak' },
        { label: 'Temps de jeu',    from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',  from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstWord', name: 'Premier mot', desc: 'Trouver un mot',
        test: function (run) { return run.words >= 1; } },
      { id: 'twoTries', name: 'Deuxième coup', desc: 'Trouver un mot en deux essais',
        test: function (run) { return run.bestTry === 2; } },
      { id: 'oneTry', name: 'Du premier coup', desc: 'Trouver un mot au premier essai',
        test: function (run) { return run.bestTry === 1; } },
      { id: 'lastTry', name: 'In extremis', desc: 'Trouver un mot au tout dernier essai',
        test: function (run) { return !!run.lastGasp; } },
      { id: 'streak3', name: 'Trois d\'affilée', desc: 'Enchaîner trois mots trouvés',
        test: function (run) { return run.streak >= 3; } },
      { id: 'streak6', name: 'Six d\'affilée', desc: 'Enchaîner six mots trouvés',
        test: function (run) { return run.streak >= 6; } },
      { id: 'hardWord', name: 'Six lettres', desc: 'Trouver un mot en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.words >= 1; } },
      { id: 'noGift', name: 'Sans cadeau', desc: 'Trouver un mot sans la première lettre offerte',
        test: function (run) { return !!run.unaided; } },
      { id: 'words10', name: 'Bon lecteur', desc: 'Trouver dix mots en tout',
        test: function (run, all) { return all.words >= 10; } },
      { id: 'words50', name: 'Beau vocabulaire', desc: 'Trouver cinquante mots en tout',
        test: function (run, all) { return all.words >= 50; } },
      { id: 'guesses200', name: 'À l\'usure', desc: 'Jouer deux cents essais en tout',
        test: function (run, all) { return all.guesses >= 200; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.correct,    head: RAMPS.neon.present,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.correct, head: RAMPS.classic.present, needs: 'firstWord' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.correct,   head: RAMPS.ocean.present,   needs: 'streak3' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.correct,   head: RAMPS.ember.present,   needs: 'twoTries' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'hardWord' }
    ]
  };
}());
