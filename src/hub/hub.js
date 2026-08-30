/* Le hall : liste les jeux de la plateforme et résume la progression commune.
   Il ne charge que les manifestes, jamais les moteurs. */
(function () {
  'use strict';

  var registry = window.GameRegistry || [];
  var games = registry.map(function (entry) {
    var manifest = window.Games && window.Games[entry.id];
    return manifest ? { entry: entry, manifest: manifest, progress: Core.createProgress(manifest) } : null;
  }).filter(Boolean);

  function num(n) { return Math.round(n).toLocaleString('fr-FR'); }

  function duration(ms) {
    var total = Math.round(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    if (h) { return h + ' h ' + m + ' min'; }
    if (m) { return m + ' min'; }
    return total + ' s';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Profil : la somme de tous les jeux                                  */
  /* ------------------------------------------------------------------ */

  function renderProfile() {
    var totals = { games: 0, timeMs: 0, score: 0, unlocked: 0, achievements: 0 };
    games.forEach(function (g) {
      var t = g.progress.totals();
      totals.games += t.games;
      totals.timeMs += t.timeMs;
      totals.score += t.score;
      var owned = g.progress.unlocked();
      totals.achievements += g.progress.achievements().length;
      totals.unlocked += g.progress.achievements().filter(function (a) { return owned[a.id]; }).length;
    });

    var box = document.getElementById('profile');
    [
      ['Parties jouées', num(totals.games)],
      ['Temps de jeu', duration(totals.timeMs)],
      ['Points cumulés', num(totals.score)],
      ['Succès', totals.unlocked + ' / ' + totals.achievements]
    ].forEach(function (pair) {
      var tile = el('div', 'tile');
      tile.appendChild(el('span', 'tile-label', pair[0]));
      tile.appendChild(el('strong', 'tile-value', pair[1]));
      box.appendChild(tile);
    });

    var ratio = totals.achievements ? totals.unlocked / totals.achievements : 0;
    document.getElementById('profileFill').style.width = (ratio * 100) + '%';
  }

  /* ------------------------------------------------------------------ */
  /* Cartes des jeux                                                     */
  /* ------------------------------------------------------------------ */

  function renderCards() {
    var list = document.getElementById('games');

    games.forEach(function (g) {
      var t = g.progress.totals();
      var owned = g.progress.unlocked();
      var count = g.progress.achievements().filter(function (a) { return owned[a.id]; }).length;

      var card = el('a', 'game-card');
      card.href = 'jeu.html?id=' + encodeURIComponent(g.manifest.id);
      card.style.setProperty('--game-color', g.manifest.color || 'var(--mint)');

      var icon = el('span', 'game-icon', g.manifest.icon || '🎮');
      card.appendChild(icon);

      var text = el('div', 'game-text');
      text.appendChild(el('strong', 'game-name', g.manifest.name));
      text.appendChild(el('span', 'game-tagline', g.manifest.tagline || ''));

      var meta = el('div', 'game-meta');
      meta.appendChild(el('span', null, t.games ? num(t.games) + ' parties' : 'Jamais joué'));
      meta.appendChild(el('span', null, 'Record ' + num(g.progress.bestOverall())));
      meta.appendChild(el('span', null, count + ' / ' + g.progress.achievements().length + ' succès'));
      text.appendChild(meta);

      card.appendChild(text);
      card.appendChild(el('span', 'game-go', '›'));
      list.appendChild(card);
    });
  }

  // Le thème est un réglage partagé : le hall porte celui choisi dans les jeux.
  var app = Core.Storage.read('app', 'settings', {}) || {};
  document.documentElement.dataset.theme = app.theme || 'neon';

  renderProfile();
  renderCards();
}());
