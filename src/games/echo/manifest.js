/* Neon Echo — manifeste. Onzième jeu, et le premier qui ne demande ni adresse
   ni raisonnement : de la mémoire. C'est aussi le premier où le son porte une
   information et non un simple retour — chaque touche a sa note. Il reste
   pourtant entièrement jouable son coupé : la couleur, le symbole et
   l'illumination disent la même chose que la note. */
window.Games = window.Games || {};

Games.echo = (function () {
  'use strict';

  /* Six touches : une couleur, un symbole et une note chacune. Les notes
     forment une gamme pentatonique mineure, jolie dans n'importe quel ordre —
     une séquence tirée au hasard ne sonnera jamais faux. */
  var PADS = [
    { color: '#38f9c3', glyph: '▲', note: 262 },
    { color: '#ffd166', glyph: '●', note: 311 },
    { color: '#ff5d8f', glyph: '■', note: 349 },
    { color: '#55b6ff', glyph: '◆', note: 392 },
    { color: '#c084fc', glyph: '★', note: 466 },
    { color: '#ff8f5e', glyph: '✚', note: 523 }
  ];

  var RAMPS = {
    neon:    ['#38f9c3', '#ffd166', '#ff5d8f', '#55b6ff', '#c084fc', '#ff8f5e'],
    classic: ['#7ec850', '#c9a227', '#e5484d', '#4a90d9', '#9b59b6', '#e67e22'],
    ocean:   ['#38f9c3', '#8bdcf2', '#5cc6e6', '#55b6ff', '#7ee787', '#ffd166'],
    ember:   ['#ffc45a', '#ff8f5e', '#ff5d8f', '#ffe08a', '#e5484d', '#fff0bd']
  };

  return {
    id: 'echo',
    name: 'Neon Echo',
    accent: 'Echo',
    tagline: 'Écoute, regarde, et rends la séquence.',
    icon: '🎵',
    color: '#c084fc',
    hint: 'Touches {1} à {6}, ou tape directement sur les dalles',
    sideLabel: 'Manche',
    legend: [
      { color: '#c084fc', label: 'La machine joue : on écoute' },
      { color: '#38f9c3', label: 'À toi : rends la séquence' },
      { color: '#ff5d8f', label: 'Une erreur suffit' }
    ],

    pads: PADS,
    ramps: RAMPS,
    defaultDifficulty: 'normal',
    unrankedDifficulties: ['zen'],

    /* `pads` : combien de dalles. `reverse` : la séquence se rend à l'envers.
       `start`, `step` et `floor` donnent la durée d'une dalle allumée, qui
       raccourcit d'une manche à l'autre sans jamais passer sous le plancher. */
    difficulties: [
      { id: 'easy',   label: 'Facile',    pads: 4, reverse: false,
        start: 620, step: 20, floor: 260, bonus: 1,
        hint: 'Quatre dalles, séquence à rendre dans l\'ordre.' },
      { id: 'normal', label: 'Normal',    pads: 6, reverse: false,
        start: 540, step: 22, floor: 220, bonus: 1.4,
        hint: 'Six dalles, et un rythme qui presse de manche en manche.' },
      { id: 'hard',   label: 'Difficile', pads: 6, reverse: true,
        start: 540, step: 22, floor: 220, bonus: 2,
        hint: 'Six dalles, et la séquence se rend à l\'envers.' },
      { id: 'zen',    label: 'Libre',     pads: 4, reverse: false, forgiving: true,
        start: 680, step: 12, floor: 340, bonus: 1,
        hint: 'Une erreur ne termine rien : la manche est simplement rejouée.' }
    ],

    rules: {
      goal: 'Retiens la séquence que joue la machine, et rends-la.',
      how: [
        'La machine allume les dalles une à une : on écoute et on regarde.',
        'Puis on rend la séquence dans le même ordre — à l\'envers en difficile.',
        'Une seule faute suffit à perdre la manche.',
        'Frapper pendant que la machine joue ne compte pas.'
      ],
      scoring: [
        'Chaque manche réussie rapporte dix points par dalle de la séquence.',
        'Le tout est multiplié par la prime de difficulté.'
      ],
      note: 'La séquence garde son préfixe et gagne une dalle par manche, et le rythme presse — sans jamais passer sous un plancher. Chaque dalle a sa note, sa couleur et son symbole : le jeu se joue muet comme il se joue sans distinguer les couleurs.'
    },
    settings: [
      { key: 'glyphs', type: 'toggle', label: 'Symboles sur les dalles', default: true,
        note: 'Chaque dalle garde une forme, en plus de sa couleur' },
      { key: 'steady', type: 'toggle', label: 'Rythme constant', default: false,
        note: 'La séquence ne s\'accélère pas d\'une manche à l\'autre' }
    ],

    run: {
      counters: ['rounds', 'presses', 'slips'],
      maxima: { round: { start: 0, total: 'bestRound' } }
    },

    stats: {
      tiles: [
        { label: 'Manches réussies',  from: 'rounds' },
        { label: 'Dalles frappées',   from: 'presses' },
        { label: 'Fautes',            from: 'slips' },
        { label: 'Plus longue suite', from: 'bestRound' },
        { label: 'Temps de jeu',      from: 'timeMs', format: 'duration' },
        { label: 'Points cumulés',    from: 'score' }
      ]
    },

    achievements: [
      { id: 'firstRound', name: 'Premier écho', desc: 'Réussir une manche',
        test: function (run) { return run.rounds >= 1; } },
      { id: 'round5', name: 'Cinq de suite', desc: 'Rendre une séquence de cinq',
        test: function (run) { return run.round >= 5; } },
      { id: 'round8', name: 'Huit de suite', desc: 'Rendre une séquence de huit',
        test: function (run) { return run.round >= 8; } },
      { id: 'round12', name: 'Douze de suite', desc: 'Rendre une séquence de douze',
        test: function (run) { return run.round >= 12; } },
      { id: 'reverse', name: 'À rebours', desc: 'Réussir une manche en difficile',
        test: function (run) { return run.difficulty === 'hard' && run.rounds >= 1; } },
      { id: 'reverse5', name: 'Mémoire inversée', desc: 'Rendre une séquence de cinq à l\'envers',
        test: function (run) { return run.difficulty === 'hard' && run.round >= 5; } },
      { id: 'clean', name: 'Sans faute', desc: 'Atteindre la manche six sans une seule faute',
        test: function (run) { return run.round >= 6 && run.slips === 0; } },
      { id: 'sixPads', name: 'Six dalles', desc: 'Réussir une manche à six dalles',
        test: function (run) { return run.pads === 6 && run.rounds >= 1; } },
      { id: 'rounds50', name: 'Bonne oreille', desc: 'Réussir cinquante manches en tout',
        test: function (run, all) { return all.rounds >= 50; } },
      { id: 'presses500', name: 'Cinq cents frappes', desc: 'Frapper cinq cents dalles en tout',
        test: function (run, all) { return all.presses >= 500; } },
      { id: 'score1000', name: 'Mille points', desc: 'Marquer 1 000 points en une partie',
        test: function (run) { return run.score >= 1000; } },
      { id: 'games25', name: 'Fidèle', desc: 'Jouer 25 parties',
        test: function (run, all) { return all.games >= 25; } }
    ],

    skins: [
      { id: 'neon',    name: 'Néon',        ramp: RAMPS.neon,
        body: RAMPS.neon[0],    head: RAMPS.neon[4],    needs: null },
      { id: 'classic', name: 'Classique',   ramp: RAMPS.classic,
        body: RAMPS.classic[0], head: RAMPS.classic[4], needs: 'firstRound' },
      { id: 'ocean',   name: 'Océan',       ramp: RAMPS.ocean,
        body: RAMPS.ocean[0],   head: RAMPS.ocean[3],   needs: 'round5' },
      { id: 'ember',   name: 'Braise',      ramp: RAMPS.ember,
        body: RAMPS.ember[0],   head: RAMPS.ember[2],   needs: 'sixPads' },
      { id: 'rainbow', name: 'Arc-en-ciel', rainbow: true,
        body: '#38f9c3', head: '#ff5d8f', needs: 'round8' }
    ]
  };
}());
