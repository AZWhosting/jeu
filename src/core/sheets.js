/* Socle — panneaux règles / succès / skins / statistiques / réglages, et
   notifications. Le contenu est entièrement dérivé du manifeste du jeu et de sa
   progression. */
window.Core = window.Core || {};

Core.createSheets = function (progress, hooks) {
  'use strict';

  var manifest = progress.manifest;
  var sheet, body, tabsBox, toasts;
  var activeTab = 'achievements';
  var resetArmed = false;
  hooks = hooks || {};

  var TABS = [
    { id: 'rules',        label: 'Règles', needsRules: true },
    { id: 'achievements', label: 'Succès' },
    { id: 'skins',        label: 'Skins', needsSkins: true },
    { id: 'stats',        label: 'Stats' },
    { id: 'settings',     label: 'Réglages' }
  ].filter(function (tab) {
    if (tab.needsSkins) { return progress.skins().length > 1; }
    if (tab.needsRules) { return !!manifest.rules; }
    return true;
  });

  function difficultyLabel(id) {
    var d = progress.difficultyById(id);
    return d ? d.label : id;
  }

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
  /* Courbe des scores (série unique : pas de légende, teinte unique)     */
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

    // Ligne de repère : la moyenne, discrète, sans étiquette dans le tracé.
    var meanY = PAD_TOP + plot - (mean / max) * plot;
    add('line', { x1: 0, y1: meanY, x2: W, y2: meanY, class: 'spark-mean' });

    recent.forEach(function (run, i) {
      var h = Math.max(2, (run.s / max) * plot);
      var x = i * (barW + GAP);
      var y = PAD_TOP + plot - h;
      var bar = add('path', { d: barPath(x, y, barW, h, 4), class: 'spark-bar' });
      var when = new Date(run.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = run.s + ' points — ' + difficultyLabel(run.d) + ' — ' + when;
      bar.appendChild(title);

      // Étiquettes directes sur les deux seules valeurs qui comptent.
      if (i === maxIndex || i === recent.length - 1) {
        add('text', {
          x: x + barW / 2,
          y: i === maxIndex ? y - 4 : H - 4,
          class: 'spark-label',
          'text-anchor': 'middle'
        }, num(run.s));
      }
    });

    add('line', { x1: 0, y1: PAD_TOP + plot, x2: W, y2: PAD_TOP + plot, class: 'spark-axis' });

    wrap.appendChild(svg);
    wrap.appendChild(el('p', 'chart-note',
      recent.length + ' dernières parties classées — ligne pointillée : moyenne de ' +
      num(mean) + ' points.'));
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Onglets                                                             */
  /* ------------------------------------------------------------------ */

  /* Les règles, telles que le manifeste les déclare : un but en une phrase,
     comment on joue, comment on marque, et ce que le jeu garantit. */
  function renderRules() {
    var rules = manifest.rules || {};
    var frag = document.createDocumentFragment();

    if (rules.goal) {
      var but = el('p', 'rule-goal', rules.goal);
      frag.appendChild(but);
    }

    function section(titre, items) {
      if (!items || !items.length) { return; }
      frag.appendChild(el('div', 'progress-head', titre));
      var list = el('ul', 'rule-list');
      items.forEach(function (line) { list.appendChild(el('li', null, line)); });
      frag.appendChild(list);
    }

    section('Comment on joue', rules.how);
    section('Comment on marque', rules.scoring);

    if (rules.note) {
      var note = el('p', 'rule-note', rules.note);
      frag.appendChild(note);
    }

    // Les commandes, reprises de l'aide affichée sous le menu.
    if (manifest.hint) {
      frag.appendChild(el('div', 'progress-head', 'Commandes'));
      var cmd = el('p', 'rule-keys');
      manifest.hint.split(/(\{[^}]+\})/).forEach(function (part) {
        if (!part) { return; }
        if (part.charAt(0) === '{') { cmd.appendChild(el('kbd', null, part.slice(1, -1))); }
        else { cmd.appendChild(document.createTextNode(part)); }
      });
      frag.appendChild(cmd);
    }

    // Les difficultés, avec ce que chacune change.
    frag.appendChild(el('div', 'progress-head', 'Difficultés'));
    var diffs = el('ul', 'rule-list');
    progress.difficulties().forEach(function (d) {
      diffs.appendChild(el('li', null, d.label + ' — ' + (d.hint || '')));
    });
    frag.appendChild(diffs);

    return frag;
  }

  function renderAchievements() {
    var list = progress.achievements();
    var owned = progress.unlocked();
    var count = list.filter(function (a) { return owned[a.id]; }).length;
    var frag = document.createDocumentFragment();

    var head = el('div', 'progress-head');
    head.appendChild(el('span', null, count + ' / ' + list.length + ' débloqués'));
    frag.appendChild(head);

    var bar = el('div', 'progress-bar');
    var fill = el('div', 'progress-fill');
    fill.style.width = (list.length ? count / list.length * 100 : 0) + '%';
    bar.appendChild(fill);
    frag.appendChild(bar);

    var cards = el('div', 'cards');
    list.forEach(function (a) {
      var got = owned[a.id];
      var card = el('div', 'card' + (got ? ' is-on' : ''));
      card.appendChild(el('span', 'card-badge', got ? '✓' : '🔒'));
      var text = el('div', 'card-text');
      text.appendChild(el('strong', null, a.name));
      text.appendChild(el('span', null, a.desc));
      if (got) {
        text.appendChild(el('em', 'card-date', 'débloqué le ' + new Date(got).toLocaleDateString('fr-FR')));
      }
      card.appendChild(text);
      cards.appendChild(card);
    });
    frag.appendChild(cards);
    return frag;
  }

  function renderSkins() {
    var frag = document.createDocumentFragment();
    var current = progress.getSetting('skin');
    var grid = el('div', 'skins');

    progress.skins().forEach(function (skin) {
      var open = progress.isSkinUnlocked(skin);
      var btn = el('button', 'skin' + (open ? '' : ' is-locked') + (skin.id === current && open ? ' is-active' : ''));
      btn.type = 'button';
      btn.disabled = !open;

      var swatch = el('span', 'skin-swatch');
      swatch.style.background = skin.rainbow
        ? 'linear-gradient(120deg,#ff5d8f,#ffd166,#38f9c3,#55b6ff,#a78bfa)'
        : 'linear-gradient(120deg,' + skin.body + ',' + skin.head + ')';
      btn.appendChild(swatch);
      btn.appendChild(el('strong', null, skin.name));

      var need = null;
      progress.achievements().forEach(function (a) { if (a.id === skin.needs) { need = a; } });
      btn.appendChild(el('span', 'skin-note', open
        ? (skin.id === current ? 'Équipé' : 'Disponible')
        : '🔒 ' + (need ? need.desc : 'À débloquer')));

      btn.addEventListener('click', function () {
        progress.setSetting('skin', skin.id);
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
    var t = progress.totals();
    var frag = document.createDocumentFragment();

    var hero = el('div', 'hero');
    hero.appendChild(el('span', 'hero-label', 'Meilleur score'));
    hero.appendChild(el('strong', 'hero-value', num(progress.bestOverall())));
    hero.appendChild(el('span', 'hero-note',
      t.games ? num(t.games) + ' parties jouées' : 'Aucune partie terminée'));
    frag.appendChild(hero);

    var tiles = el('div', 'tiles');
    ((manifest.stats && manifest.stats.tiles) || []).forEach(function (def) {
      var raw = t[def.from] || 0;
      var value = def.format === 'duration' ? duration(raw) : (def.prefix || '') + num(raw);
      var tile = el('div', 'tile');
      tile.appendChild(el('span', 'tile-label', def.label));
      tile.appendChild(el('strong', 'tile-value', value));
      tiles.appendChild(tile);
    });
    frag.appendChild(tiles);

    frag.appendChild(sparkline(t.history || []));

    var table = el('div', 'table');
    table.appendChild(el('h3', 'chart-title', 'Par difficulté'));
    progress.difficulties().forEach(function (d) {
      var per = (t.byDifficulty || {})[d.id] || { games: 0 };
      var row = el('div', 'row');
      row.appendChild(el('span', null, d.label));
      row.appendChild(el('span', 'row-games', num(per.games) + ' parties'));
      row.appendChild(el('strong', null, progress.ranked(d.id) ? num(progress.bestFor(d.id)) : '—'));
      table.appendChild(row);
    });
    frag.appendChild(table);
    return frag;
  }

  function segmented(def) {
    var field = el('div', 'field');
    field.appendChild(el('span', 'field-label', def.label));
    var choices = el('div', 'choices choices-' + def.options.length);
    def.options.forEach(function (opt) {
      var btn = el('button', 'choice' + (progress.getSetting(def.key) === opt.value ? ' is-active' : ''), opt.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        progress.setSetting(def.key, opt.value);
        if (hooks.onSettingChange) { hooks.onSettingChange(def.key, opt.value); }
        render();
      });
      choices.appendChild(btn);
    });
    field.appendChild(choices);
    var hint = typeof def.hint === 'function' ? def.hint(progress.getSetting(def.key)) : def.hint;
    if (hint) { field.appendChild(el('p', 'field-hint', hint)); }
    return field;
  }

  function toggle(def) {
    var row = el('div', 'switch-row');
    var text = el('div', 'switch-text');
    text.appendChild(el('strong', null, def.label));
    if (def.note) { text.appendChild(el('span', null, def.note)); }
    row.appendChild(text);

    var btn = el('button', 'switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', def.label);
    btn.setAttribute('aria-checked', String(!!progress.getSetting(def.key)));
    btn.appendChild(el('span', 'switch-knob'));
    btn.addEventListener('click', function () {
      var value = !progress.getSetting(def.key);
      progress.setSetting(def.key, value);
      btn.setAttribute('aria-checked', String(value));
      if (hooks.onSettingChange) { hooks.onSettingChange(def.key, value); }
    });
    row.appendChild(btn);
    return row;
  }

  function renderSettings() {
    var frag = document.createDocumentFragment();
    var own = manifest.settings || [];

    // Réglages du jeu à choix multiples, puis thème, puis les interrupteurs :
    // les partagés d'abord, ceux du jeu ensuite.
    own.filter(function (d) { return d.type === 'choice'; }).forEach(function (d) {
      frag.appendChild(segmented(d));
    });

    frag.appendChild(segmented({
      key: 'theme',
      label: 'Thème',
      options: Object.keys(progress.THEMES).map(function (id) {
        return { value: id, label: progress.THEMES[id].label };
      })
    }));

    frag.appendChild(toggle({ key: 'sound', label: 'Son', note: 'Bruitages générés en WebAudio' }));
    frag.appendChild(toggle({ key: 'effects', label: 'Effets visuels',
                              note: 'Particules, secousses et textes flottants' }));
    own.filter(function (d) { return d.type === 'toggle'; }).forEach(function (d) {
      frag.appendChild(toggle(d));
    });

    var danger = el('div', 'danger');
    var btn = el('button', 'danger-btn', resetArmed ? 'Confirmer : tout effacer' : 'Réinitialiser mes données');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (!resetArmed) { resetArmed = true; render(); return; }
      progress.reset();
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
    if (activeTab === 'rules') { body.appendChild(renderRules()); }
    else if (activeTab === 'achievements') { body.appendChild(renderAchievements()); }
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

  return { open: open, close: close, isOpen: isOpen, toast: toast };
};
