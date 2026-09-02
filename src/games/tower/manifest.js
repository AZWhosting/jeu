/* Neon Tower — manifeste. Treizième jeu, et le premier qui pose une question
   qu'aucun autre ne pose : quand s'arrêter. On monte des paliers, le pot
   grossit, et une porte sur n est piégée.

   La plateforme a jusqu'ici évité le hasard subi. Ici le hasard est central,
   mais il est entièrement montré : à chaque palier le jeu affiche la
   probabilité exacte, ce que deviendrait le pot, et l'espérance du coup. Le
   joueur ne parie jamais à l'aveugle — et à partir d'un certain palier,
   annoncé, monter devient perdant en moyenne. */
window.Games = window.Games || {};

Games.tower = (function () {
  'use strict';

  /* Chaque palier : combien de portes, et ce que vaut le pot une fois franchi.
     `doors` décroît, donc le risque monte ; `pot` grimpe pour compenser — mais
     plus assez à partir de `tipping`, et c'est là que le jeu commence. */
  var LADDERS = {
    easy: [
      { doors: 6, pot: 120 },  { doors: 6, pot: 190 },  { doors: 5, pot: 280 },
      { doors: 4, pot: 420 },  { doors: 3, pot: 700 },  { doors: 2, pot: 1300 },
      { doors: 2, pot: 2400 }, { doors: 2, pot: 4400 }, { doors: 2, pot: 8000 },
      { doors: 2, pot: 15000 }
    ],
    normal: [
      { doors: 6, pot: 100 },  { doors: 5, pot: 150 },  { doors: 4, pot: 240 },
      { doors: 3, pot: 408 },  { doors: 2, pot: 700 },  { doors: 2, pot: 1200 },
      { doors: 2, pot: 2100 }, { doors: 2, pot: 3800 }, { doors: 2, pot: 7000 },
      { doors: 2, pot: 13000 }
    ],
    hard: [
      { doors: 5, pot: 100 },  { doors: 4, pot: 160 },  { doors: 3, pot: 260 },
      { doors: 2, pot: 430 },  { doors: 2, pot: 750 },  { doors: 2, pot: 1350 },
      { doors: 2, pot: 2500 }, { doors: 2, pot: 4700 }, { doors: 2, pot: 9000 },
      { doors: 2, pot: 17000 }
    ]
  };

  var RAMPS = {
    neon:    { door: '#e879f9', safe: '#38f9c3', trap: '#ff5d8f', pot: '#ffd166',
               dim: 'rgba(232, 121, 249, 0.22)', edge: 'rgba(232, 121, 249, 0.40)' },
    classic: { door: '#e8eefc', safe: '#7ec850', trap: '#e5484d', pot: '#c9a227',
               dim: 'rgba(232, 238, 252, 0.16)', edge: 'rgba(232, 238, 252, 0.34)' },
    ocean:   { door: '#8bdcf2', safe: '#38f9c3', trap: '#ff8f5e', pot: '#ffd166',
               dim: 'rgba(92, 198, 230, 0.20)', edge: 'rgba(92, 198, 230, 0.40)' },
    ember:   { door: '#ffc45a', safe: '#7ee787', trap: '#ff5d8f', pot: '#fff0bd',
               dim: 'rgba(255, 143, 94, 0.20)', edge: 'rgba(255, 143, 94, 0.42)' }
  };

  return {
    id: 'tower',
    name: 'Neon Tower',
    accent: 'Tower',
    tagline: 'Monte, ou encaisse. Tout est affiché.',
    icon: '🗼',
    color: '#e879f9',
    hint: 'Chiffres {1} à {6} pour ouvrir — {E} encaisse, {P} sonde une porte',
    sideLabel: 'Palier',
    legend: [
      { color: '#e879f9', label: 'Une porte sur n est piégée' },
      { color: '#ffd166', label: 'Le pot grossit à chaque palier' },
      { color: '#38f9c3', label: 'Encaisser met le pot à l\'abri' }
    ],

    ladders: LADDERS,
    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `tipping` : le premier palier où monter rapporte, en moyenne, moins que
       ce qu'on a déjà. Il est calculé à la main ici et revérifié par les tests
       à partir de la table elle-même. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    ladder: 'easy',   lives: 4, tipping: 6,
        hint: 'Quatre vies, et monter reste payant jusqu\'au cinquième palier.' },
      { id: 'normal', label: 'Normal',    ladder: 'normal', lives: 3, tipping: 5,
        hint: 'Trois vies, et le calcul bascule au cinquième palier.' },
      { id: 'hard',   label: 'Difficile', ladder: 'hard',   lives: 2, tipping: 4,
        hint: 'Deux vies, et il devient perdant de monter dès le quatrième.' },
      { id: 'zen',    label: 'Libre',     ladder: 'easy',   lives: 0, tipping: 6,
        forgiving: true,
        hint: 'Les pièges coûtent le pot, jamais la partie. Sans classement.' }
    ],

    settings: [
      { key: 'odds', type: 'toggle', label: 'Afficher l\'espérance', default: true,
        note: 'Ce que rapporte le prochain palier, en moyenne' },
      { key: 'confirm', type: 'toggle', label: 'Confirmer au-delà du basculement', default: false,
        note: 'Demande confirmation quand monter devient perdant' }
    ],

    run: {
      counters: ['banked', 'climbs', 'traps'],
      maxima: { deepest: { start: 0, total: 'bestDepth' } }
    },

    stats: {
      tiles: [
        { label: 'Manches encaissées', from: 'banked' },
        { label: 'Paliers franchis',   from: 'climbs' },
        { label: 'Pièges ouverts',     from: 'traps' },
        { label: 'Palier le plus haut', from: 'bestDepth' },
        { label: 'Temps de jeu',       from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',     from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstBank', name: 'Premier retrait', desc: 'Encaisser un pot',
        test: function (run) { return run.banked >= 1; } },
      { id: 'depth5', name: 'Cinquième palier', desc: 'Franchir cinq paliers dans une manche',
        test: function (run) { return run.deepest >= 5; } },
      { id: 'depth8', name: 'Huitième palier', desc: 'Franchir huit paliers dans une manche',
        test: function (run) { return run.deepest >= 8; } },
      { id: 'wise', name: 'Sagesse', desc: 'Encaisser juste avant le palier du basculement',
        test: function (run) { return !!run.wiseBank; } },
      { id: 'greedy', name: 'Cupidité récompensée', desc: 'Encaisser au-delà du basculement',
        test: function (run) { return !!run.greedyBank; } },
      { id: 'bank5', name: 'Cinq manches', desc: 'Encaisser cinq pots dans une partie',
        test: function (run) { return run.banked >= 5; } },
      { id: 'noProbe', name: 'À l\'instinct', desc: 'Encaisser un pot sans sonder une seule porte',
        test: function (run) { return !!run.blindBank; } },
      { id: 'hardBank', name: 'Deux vies', desc: 'Encaisser un pot en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.banked >= 1; } },
      { id: 'climbs50', name: 'Grimpeur', desc: 'Franchir cinquante paliers en tout',
        test: function (run, all) { return all.climbs >= 50; } },
      { id: 'banked25', name: 'Prudent', desc: 'Encaisser vingt-cinq pots en tout',
        test: function (run, all) { return all.banked >= 25; } },
      { id: 'score5000', name: 'Cinq mille', desc: 'Marquer 5 000 points en une partie',
        test: function (run) { return run.score >= 5000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon.door,    head: RAMPS.neon.pot,    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic.door, head: RAMPS.classic.pot, needs: 'firstBank' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean.door,   head: RAMPS.ocean.pot,   needs: 'depth5' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember.door,   head: RAMPS.ember.pot,   needs: 'wise' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'depth8' }
    ]
  };
}());
