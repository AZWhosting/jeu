/* Neon Pyramid — manifeste. La pyramide : vingt-huit cartes empilées en sept
   rangées, qu'on démolit deux par deux en formant treize. C'est la quatrième
   réussite de la plateforme, et la seule qui ne se joue pas en empilant : ici
   on ne construit rien, on retire.

   Sa particularité tient à la donne. Une pyramide tirée au hasard est le plus
   souvent perdue d'avance — 3 % environ se terminent quand la pioche ne passe
   qu'une fois. Le jeu ne tire donc pas au hasard : il pioche dans une table de
   donnes qu'un solveur a prouvées gagnables, avec exactement le nombre de
   passes que la difficulté accorde. Toute partie perdue l'est parce qu'il y
   avait un chemin et qu'on l'a manqué. */
window.Games = window.Games || {};

Games.pyramid = (function () {
  'use strict';

  var RAMPS = {
    neon: {
      red: '#ff5d8f', black: '#fbbf24', face: '#191307', edge: 'rgba(251, 191, 36, 0.55)',
      slot: 'rgba(251, 191, 36, 0.12)', back: 'rgba(150, 110, 30, 0.72)',
      home: '#fbbf24', pick: '#38f9c3', dead: '#ff5d8f'
    },
    classic: {
      red: '#e5484d', black: '#e8eefc', face: '#12161f', edge: 'rgba(232, 238, 252, 0.45)',
      slot: 'rgba(232, 238, 252, 0.10)', back: 'rgba(120, 130, 150, 0.65)',
      home: '#c9a227', pick: '#8ce99a', dead: '#e5484d'
    },
    ocean: {
      red: '#ff9f45', black: '#8bdcf2', face: '#0c1b26', edge: 'rgba(92, 198, 230, 0.55)',
      slot: 'rgba(92, 198, 230, 0.13)', back: 'rgba(40, 120, 150, 0.70)',
      home: '#38f9c3', pick: '#ffe08a', dead: '#ff9f45'
    },
    ember: {
      red: '#ffb45a', black: '#ffe6c4', face: '#1c1210', edge: 'rgba(255, 143, 94, 0.55)',
      slot: 'rgba(255, 143, 94, 0.13)', back: 'rgba(150, 70, 45, 0.72)',
      home: '#ff8f5e', pick: '#fff0bd', dead: '#ff5d8f'
    }
  };

  return {
    id: 'pyramid',
    name: 'Neon Pyramid',
    accent: 'Pyramid',
    tagline: 'La pyramide : vingt-huit cartes à défaire, deux par deux, en faisant treize.',
    icon: '🔺',
    color: '#fbbf24',
    hint: 'Deux cartes qui font 13 s\'en vont — {P} pioche, {U} annule',
    sideLabel: 'Pyramide',
    legend: [
      { color: '#fbbf24', label: 'Deux cartes libres qui totalisent 13 disparaissent' },
      { color: '#38f9c3', label: 'Le roi vaut 13 : il part tout seul' },
      { color: '#ff5d8f', label: 'Une carte encore couverte ne se joue pas' }
    ],

    ramps: RAMPS,
    defaultDifficulty: 'easy',
    unrankedDifficulties: ['zen'],

    /* `passes` : combien de fois la pioche défile. C'est tout l'écart de
       difficulté — et le critère avec lequel les donnes ont été prouvées. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    passes: 3, bonus: 1,
        hint: 'La pioche repasse trois fois : de quoi se tromper et se reprendre.' },
      { id: 'normal', label: 'Normal',    passes: 2, bonus: 1.6,
        hint: 'Deux passes seulement : le second tour ne pardonne plus grand-chose.' },
      { id: 'hard',   label: 'Difficile', passes: 1, bonus: 2.5,
        hint: 'Une seule passe. Chaque carte piochée se joue maintenant ou jamais.' },
      { id: 'zen',    label: 'Libre',     passes: 3, bonus: 1, forgiving: true,
        hint: 'Trois passes, annulation à volonté, et rien n\'est classé.' }
    ],

    rules: {
      goal: 'Fais disparaître les vingt-huit cartes de la pyramide en les retirant deux par deux.',
      how: [
        'Une carte est libre quand plus rien ne la recouvre : au départ, seule la rangée du bas l\'est.',
        'Deux cartes libres dont les valeurs totalisent 13 s\'en vont ensemble : as = 1, valet = 11, dame = 12.',
        'Le roi vaut 13 à lui seul : une tape suffit à le retirer, et il compte pour une paire.',
        'La carte du dessus de la défausse compte comme libre : elle se marie avec la pyramide.',
        'La pioche donne une carte à la défausse. Vide, elle se retourne — autant de fois que la difficulté l\'accorde.'
      ],
      scoring: [
        'Une carte retirée de la pyramide vaut d\'autant plus qu\'elle était haut : 5 points en bas, 35 au sommet.',
        'Une rangée entièrement dégagée rapporte 60 points.',
        'La pyramide achevée rapporte 400 points, plus un point par seconde gagnée sur cinq minutes.',
        'Le tout est multiplié par la prime de la difficulté : ×1,6 en normal, ×2,5 en difficile.'
      ],
      note: 'Toutes les donnes servies ont été prouvées gagnables avec le nombre de passes de la difficulté choisie. Si la partie se bloque, le chemin existait : il est passé ailleurs.'
    },

    settings: [
      { key: 'guide', type: 'toggle', label: 'Guider les paires', default: true,
        note: 'Éclaire les cartes qui complètent celle que tu tiens' },
      { key: 'dead', type: 'toggle', label: 'Arrêter à l\'impasse', default: true,
        note: 'Clôt la partie dès qu\'aucun coup n\'est plus possible ; sinon, à toi d\'annuler' },
      { key: 'fan', type: 'toggle', label: 'Défausse en éventail', default: true,
        note: 'Montre les trois dernières cartes piochées, pas seulement la dernière' }
    ],

    run: {
      counters: ['pairs', 'moves', 'redeals', 'cleared', 'wins'],
      maxima: { best: { start: 0, total: 'bestCleared' } }
    },

    stats: {
      tiles: [
        { label: 'Paires retirées',    from: 'pairs' },
        { label: 'Pyramides achevées', from: 'wins' },
        { label: 'Cartes retirées',    from: 'cleared' },
        { label: 'Meilleure partie',   from: 'bestCleared' },
        { label: 'Temps de jeu',       from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',     from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstPair', name: 'Treize', desc: 'Retirer une première paire, ou un roi',
        test: function (run) { return run.pairs >= 1; } },
      { id: 'firstRow', name: 'Une rangée', desc: 'Dégager une rangée entière',
        test: function (run) { return run.rows >= 1; } },
      { id: 'halfWay', name: 'À mi-pente', desc: 'Retirer quatorze cartes dans une même partie',
        test: function (run) { return run.best >= 14; } },
      { id: 'firstWin', name: 'Sommet atteint', desc: 'Achever une pyramide',
        test: function (run) { return run.wins >= 1; } },
      { id: 'normalWin', name: 'Deux passes', desc: 'Achever une pyramide en normal',
        test: function (run) { return run.difficulty === 'normal' && run.wins >= 1; } },
      { id: 'hardWin', name: 'Une seule passe', desc: 'Achever une pyramide en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.wins >= 1; } },
      { id: 'noUndo', name: 'Sans repentir', desc: 'Achever une pyramide sans jamais annuler',
        test: function (run) { return !!run.cleanWin; } },
      { id: 'onePass', name: 'Du premier coup', desc: 'Achever une pyramide sans retourner la pioche',
        test: function (run) { return !!run.singlePass; } },
      { id: 'quick', name: 'Main leste', desc: 'Achever une pyramide en moins de trois minutes',
        test: function (run) { return !!run.quickWin; } },
      { id: 'pairs150', name: 'Cent cinquante paires', desc: 'Retirer 150 paires en tout',
        test: function (run, all) { return all.pairs >= 150; } },
      { id: 'wins10', name: 'Bâtisseuse', desc: 'Achever dix pyramides en tout',
        test: function (run, all) { return all.wins >= 10; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Sable',       ramp: RAMPS.neon,
        body: RAMPS.neon.black,    head: RAMPS.neon.red,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.black, head: RAMPS.classic.red, needs: 'firstPair' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.black,   head: RAMPS.ocean.red,   needs: 'halfWay' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.black,   head: RAMPS.ember.red,   needs: 'firstWin' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'hardWin' }
    ]
  };
}());
