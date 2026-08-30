/* Neon Snake — panneaux secondaires : succès, skins, statistiques, réglages.
   Le contenu est construit en JavaScript ; le moteur ne connaît que l'API publique. */
window.Sheets = (function () {
  'use strict';

  var P = window.Progress;
  var hooks = {};
  var sheet, body, tabsBox, toasts;
  var activeTab = 'achievements';
  var resetArmed = false;

  var TABS = [
    { id: 'achievements', label: 'Succès' },
    { id: 'skins',        label: 'Skins' },
    { id: 'stats',        label: 'Stats' },
    { id: 'settings',     label: 'Réglages' }
  ];

  var DIFFICULTY_LABELS = { easy: 'Facile', normal: 'Normal', hard: 'Difficile', zen: 'Zen' };

  /* ------------------------------------------------------------------ */
  /* Formats                                                             */
  /* ------------------------------------------------------------------ */

  function num(n) { return Math.round(n).toLocaleString('fr-FR'); }

  function duration(ms) {
    var total = Math.round(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h) { return h + ' h ' + m + ' min'; }
    if (m) { return m + ' min ' + s + ' s'; }
    return s + ' s';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Courbe des scores (une seule série : pas de légende, hue unique)     */
  /* ------------------------------------------------------------------ */

  function barPath(x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h);
    return 'M' + x + ' ' + (y + h) +
           'V' + (y + radius) +
           'Q' + x + ' ' + y + ' ' + (x + radius) + ' ' + y +
           'H' + (x + w - radius) +
           'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + radius) +
           'V' + (y + h) + 'Z';
  }

  function sparkline(history) {
    var recent = history.slice(-20);
    var wrap = el('div', 'chart');
    wrap.appendChild(el('h3', 'chart-title', 'Scores des dernières parties'));

    if (recent.length < 2) {
      wrap.appendChild(el('p', 'empty', 'Joue au moins deux parties pour voir ta progression.'));
      return wrap;
    }

    var W = 300, H = 92, PAD_TOP = 14, PAD_BOTTOM = 16, GAP = 2;
    var plot = H - PAD_TOP - PAD_BOTTOM;
    var scores = recent.map(function (r) { return r.s; });
    var max = Math.max.apply(null, scores) || 1;
    var mean = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    var barW = (W - GAP * (recent.length - 1)) / recent.length;
    var maxIndex = scores.lastIndexOf(max);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      recent.length + ' dernières parties : meilleur score ' + max +
      ', moyenne ' + Math.round(mean) + ', dernier ' + scores[scores.length - 1] + '.');

    function add(tag, attrs, text) {
      var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text !== undefined) { node.textContent = text; }
      svg.appendChild(node);
      return node;
    }

    // Ligne de repère : la moyenne, en gris, discrète.
    var meanY = PAD_TOP + plot - (mean / max) * plot;
    add('line', { x1: 0, y1: meanY, x2: W, y2: meanY, class: 'spark-mean' });

    recent.forEach(function (run, i) {
      var h = Math.max(2, (run.s / max) * plot);
      var x = i * (barW + GAP);
      var y = PAD_TOP + plot - h;
      var bar = add('path', { d: barPath(x, y, barW, h, 4), class: 'spark-bar' });
      var when = new Date(run.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = run.s + ' points — ' + (DIFFICULTY_LABELS[run.d] || run.d) + ' — ' + when;
      bar.appendChild(title);

      // Étiquettes directes sur les deux seules valeurs qui comptent.
      if (i === maxIndex || i === recent.length - 1) {
        add('text', {
          x: x + barW / 2,
          y: i === maxIndex ? y - 4 : H - 4,
          class: 'spark-label',
          'text-anchor': 'middle'
        }, i === maxIndex ? num(run.s) : num(run.s));
      }
    });

    // Ligne de base.
    add('line', { x1: 0, y1: PAD_TOP + plot, x2: W, y2: PAD_TOP + plot, class: 'spark-axis' });

    wrap.appendChild(svg);
    wrap.appendChild(el('p', 'chart-note',
      recent.length + ' dernières parties, mode zen exclu — ligne pointillée : moyenne de ' +
      num(mean) + ' points.'));
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Onglets                                                             */
  /* ------------------------------------------------------------------ */

  function renderAchievements() {
    var owned = P.unlocked();
    var count = P.ACHIEVEMENTS.filter(function (a) { return owned[a.id]; }).length;
    var frag = document.createDocumentFragment();

    var head = el('div', 'progress-head');
    head.appendChild(el('span', null, count + ' / ' + P.ACHIEVEMENTS.length + ' débloqués'));
    frag.appendChild(head);

    var bar = el('div', 'progress-bar');
    var fill = el('div', 'progress-fill');
    fill.style.width = (count / P.ACHIEVEMENTS.length * 100) + '%';
    bar.appendChild(fill);
    frag.appendChild(bar);

    var list = el('div', 'cards');
    P.ACHIEVEMENTS.forEach(function (a) {
      var got = owned[a.id];
      var card = el('div', 'card' + (got ? ' is-on' : ''));
      card.appendChild(el('span', 'card-badge', got ? '✓' : '🔒'));
      var text = el('div', 'card-text');
      text.appendChild(el('strong', null, a.name));
      text.appendChild(el('span', null, a.desc));
      if (got) {
        text.appendChild(el('em', 'card-date',
          'débloqué le ' + new Date(got).toLocaleDateString('fr-FR')));
      }
      card.appendChild(text);
      list.appendChild(card);
    });
    frag.appendChild(list);
    return frag;
  }

  function renderSkins() {
    var frag = document.createDocumentFragment();
    var current = P.getSetting('skin');
    var grid = el('div', 'skins');

    P.SKINS.forEach(function (skin) {
      var open = P.isSkinUnlocked(skin);
      var btn = el('button', 'skin' + (open ? '' : ' is-locked') + (skin.id === current && open ? ' is-active' : ''));
      btn.type = 'button';
      btn.disabled = !open;

      var swatch = el('span', 'skin-swatch');
      if (skin.rainbow) {
        swatch.style.background = 'linear-gradient(120deg,#ff5d8f,#ffd166,#38f9c3,#55b6ff,#a78bfa)';
      } else {
        swatch.style.background = 'linear-gradient(120deg,' + skin.body + ',' + skin.head + ')';
      }
      btn.appendChild(swatch);
      btn.appendChild(el('strong', null, skin.name));

      var need = null;
      if (!open) {
        P.ACHIEVEMENTS.forEach(function (a) { if (a.id === skin.needs) { need = a; } });
      }
      btn.appendChild(el('span', 'skin-note', open
        ? (skin.id === current ? 'Équipé' : 'Disponible')
        : '🔒 ' + (need ? need.desc : 'À débloquer')));

      btn.addEventListener('click', function () {
        P.setSetting('skin', skin.id);
        if (hooks.onSkinChange) { hooks.onSkinChange(); }
        render();
      });
      grid.appendChild(btn);
    });

    frag.appendChild(grid);
    frag.appendChild(el('p', 'chart-note', 'Les skins se débloquent avec les succès.'));
    return frag;
  }

  function renderStats() {
    var t = P.totals();
    var frag = document.createDocumentFragment();

    var bests = ['easy', 'normal', 'hard'].map(function (d) { return P.bestFor(d); });
    var overall = Math.max.apply(null, bests.concat([0]));

    var hero = el('div', 'hero');
    hero.appendChild(el('span', 'hero-label', 'Meilleur score'));
    hero.appendChild(el('strong', 'hero-value', num(overall)));
    hero.appendChild(el('span', 'hero-note', t.games ? num(t.games) + ' parties jouées' : 'Aucune partie terminée'));
    frag.appendChild(hero);

    var tiles = el('div', 'tiles');
    [
      ['Pommes mangées', num(t.apples)],
      ['Bonus ramassés', num(t.powerups)],
      ['Longueur max', num(t.bestLength)],
      ['Meilleur combo', '×' + num(t.bestCombo)],
      ['Temps de jeu', duration(t.timeMs)],
      ['Points cumulés', num(t.score)]
    ].forEach(function (pair) {
      var tile = el('div', 'tile');
      tile.appendChild(el('span', 'tile-label', pair[0]));
      tile.appendChild(el('strong', 'tile-value', pair[1]));
      tiles.appendChild(tile);
    });
    frag.appendChild(tiles);

    frag.appendChild(sparkline(t.history || []));

    var table = el('div', 'table');
    table.appendChild(el('h3', 'chart-title', 'Par difficulté'));
    ['easy', 'normal', 'hard', 'zen'].forEach(function (d) {
      var per = (t.byDifficulty || {})[d] || { games: 0, best: 0 };
      var row = el('div', 'row');
      row.appendChild(el('span', null, DIFFICULTY_LABELS[d]));
      row.appendChild(el('span', 'row-games', num(per.games) + ' parties'));
      row.appendChild(el('strong', null, d === 'zen' ? '—' : num(P.bestFor(d))));
      table.appendChild(row);
    });
    frag.appendChild(table);
    return frag;
  }

  function segmented(label, name, options, hint) {
    var field = el('div', 'field');
    field.appendChild(el('span', 'field-label', label));
    var choices = el('div', 'choices choices-' + options.length);
    options.forEach(function (opt) {
      var btn = el('button', 'choice' + (P.getSetting(name) === opt.value ? ' is-active' : ''), opt.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        P.setSetting(name, opt.value);
        if (hooks.onSettingChange) { hooks.onSettingChange(name, opt.value); }
        render();
      });
      choices.appendChild(btn);
    });
    field.appendChild(choices);
    if (hint) { field.appendChild(el('p', 'field-hint', hint)); }
    return field;
  }

  function toggle(label, name, hint) {
    var row = el('div', 'switch-row');
    var text = el('div', 'switch-text');
    text.appendChild(el('strong', null, label));
    if (hint) { text.appendChild(el('span', null, hint)); }
    row.appendChild(text);

    var btn = el('button', 'switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-checked', String(!!P.getSetting(name)));
    btn.appendChild(el('span', 'switch-knob'));
    btn.addEventListener('click', function () {
      var value = !P.getSetting(name);
      P.setSetting(name, value);
      btn.setAttribute('aria-checked', String(value));
      if (hooks.onSettingChange) { hooks.onSettingChange(name, value); }
    });
    row.appendChild(btn);
    return row;
  }

  function renderSettings() {
    var frag = document.createDocumentFragment();

    frag.appendChild(segmented('Taille de la grille', 'grid', [
      { value: 'small', label: 'Petite' },
      { value: 'medium', label: 'Moyenne' },
      { value: 'large', label: 'Grande' }
    ], P.GRID_SIZES[P.getSetting('grid')] + ' × ' + P.GRID_SIZES[P.getSetting('grid')] +
       ' cases — s\'applique à la prochaine partie.'));

    frag.appendChild(segmented('Vitesse', 'speed', [
      { value: 'progressive', label: 'Progressive' },
      { value: 'constant', label: 'Constante' }
    ], P.getSetting('speed') === 'progressive'
       ? 'Le serpent accélère à mesure qu\'il grandit.'
       : 'Le rythme reste identique du début à la fin.'));

    frag.appendChild(segmented('Thème', 'theme', [
      { value: 'neon', label: 'Néon' },
      { value: 'retro', label: 'Rétro' },
      { value: 'dusk', label: 'Crépuscule' }
    ]));

    frag.appendChild(toggle('Son', 'sound', 'Bruitages générés en WebAudio'));
    frag.appendChild(toggle('Effets visuels', 'effects', 'Particules, secousses et textes flottants'));
    frag.appendChild(toggle('Quadrillage', 'gridLines', 'Lignes de repère sur le plateau'));

    var danger = el('div', 'danger');
    var btn = el('button', 'danger-btn', resetArmed
      ? 'Confirmer : tout effacer'
      : 'Réinitialiser mes données');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (!resetArmed) {
        resetArmed = true;
        render();
        return;
      }
      P.resetAll();
      location.reload();
    });
    danger.appendChild(btn);
    danger.appendChild(el('p', 'field-hint', resetArmed
      ? 'Scores, succès, skins et réglages seront perdus. Clique à nouveau pour confirmer.'
      : 'Efface les records, les succès et les réglages de ce navigateur.'));
    frag.appendChild(danger);

    return frag;
  }

  /* ------------------------------------------------------------------ */
  /* Assemblage                                                          */
  /* ------------------------------------------------------------------ */

  function render() {
    Array.prototype.forEach.call(tabsBox.children, function (btn) {
      var on = btn.dataset.tab === activeTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });

    body.innerHTML = '';
    if (activeTab === 'achievements') { body.appendChild(renderAchievements()); }
    else if (activeTab === 'skins') { body.appendChild(renderSkins()); }
    else if (activeTab === 'stats') { body.appendChild(renderStats()); }
    else { body.appendChild(renderSettings()); }
    body.scrollTop = 0;
  }

  function open(tab) {
    activeTab = tab || activeTab;
    resetArmed = false;
    sheet.hidden = false;
    render();
    if (hooks.onOpen) { hooks.onOpen(); }
  }

  function close() {
    if (sheet.hidden) { return; }
    sheet.hidden = true;
    resetArmed = false;
    if (hooks.onClose) { hooks.onClose(); }
  }

  function isOpen() { return !sheet.hidden; }

  function toast(item) {
    var node = el('div', 'toast');
    node.appendChild(el('span', 'toast-icon', item.kind === 'skin' ? '🎨' : '🏆'));
    var text = el('div', 'toast-text');
    text.appendChild(el('strong', null, item.kind === 'skin' ? 'Skin débloqué' : 'Succès débloqué'));
    text.appendChild(el('span', null, item.name + (item.kind === 'skin' ? '' : ' — ' + item.desc)));
    node.appendChild(text);
    toasts.appendChild(node);
    setTimeout(function () { node.classList.add('is-leaving'); }, 3400);
    setTimeout(function () { node.remove(); }, 3900);
    while (toasts.children.length > 3) { toasts.firstChild.remove(); }
  }

  function init(options) {
    hooks = options || {};
    sheet = document.getElementById('sheet');
    body = document.getElementById('sheetBody');
    tabsBox = document.getElementById('sheetTabs');
    toasts = document.getElementById('toasts');

    TABS.forEach(function (tab) {
      var btn = el('button', 'tab', tab.label);
      btn.type = 'button';
      btn.dataset.tab = tab.id;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', function () { activeTab = tab.id; render(); });
      tabsBox.appendChild(btn);
    });

    document.getElementById('sheetClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
    }, true);
  }

  return { init: init, open: open, close: close, isOpen: isOpen, toast: toast };
}());
