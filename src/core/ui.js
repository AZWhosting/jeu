/* Socle — les éléments d'interface que tous les jeux partagent : HUD, panneau
   central, sélecteur de difficulté, barre d'outils. Chaque jeu s'y branche au
   lieu de recâbler le même DOM. */
window.Core = window.Core || {};

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  Core.applyTheme = function (progress) {
    document.documentElement.dataset.theme = progress.getSetting('theme');
  };

  /* ------------------------------------------------------------------ */
  /* HUD : score, statistique secondaire, record                         */
  /* ------------------------------------------------------------------ */

  Core.createHud = function (progress) {
    var nodes = {
      score: $('score'), side: $('side'), sideBox: $('sideBox'), sideLabel: $('sideLabel'),
      best: $('best'), bestLabel: $('bestLabel')
    };

    function bump(node) {
      if (!progress.getSetting('effects')) { return; }
      node.classList.remove('bump');
      void node.offsetWidth;
      node.classList.add('bump');
    }

    return {
      set: function (fields) {
        if (fields.score !== undefined) {
          var next = String(fields.score);
          if (nodes.score.textContent !== next) { bump(nodes.score); }
          nodes.score.textContent = next;
        }
        if (fields.sideLabel !== undefined) { nodes.sideLabel.textContent = fields.sideLabel; }
        if (fields.side !== undefined) { nodes.side.textContent = fields.side; }
        if (fields.sideVisible !== undefined) { nodes.sideBox.hidden = !fields.sideVisible; }
        if (fields.bestLabel !== undefined) { nodes.bestLabel.textContent = fields.bestLabel; }
        if (fields.best !== undefined) { nodes.best.textContent = fields.best; }
      }
    };
  };

  /* ------------------------------------------------------------------ */
  /* Panneau central : menu, pause, fin de partie                        */
  /* ------------------------------------------------------------------ */

  Core.createPanel = function (onPlay, onQuit) {
    var overlay = $('overlay');
    var nodes = {
      title: $('title'), subtitle: $('subtitle'), cta: $('playBtn'),
      quit: $('quitPanelBtn'),
      field: $('difficultyField'), scoreboard: $('scoreboard'),
      score: $('finalScore'), extra: $('finalExtra'), extraLabel: $('finalExtraLabel'),
      best: $('finalBest')
    };

    nodes.cta.addEventListener('click', function () { onPlay(); });
    if (nodes.quit && onQuit) { nodes.quit.addEventListener('click', function () { onQuit(); }); }

    return {
      show: function (opts) {
        overlay.hidden = false;
        nodes.title.textContent = opts.title;
        nodes.subtitle.textContent = opts.subtitle;
        nodes.cta.textContent = opts.cta;
        nodes.field.hidden = !!opts.hideDifficulty;
        if (nodes.quit) {
          nodes.quit.hidden = !opts.quit;
          if (opts.quit) { nodes.quit.textContent = opts.quit; }
        }
        nodes.scoreboard.hidden = !opts.scoreboard;
        if (opts.scoreboard) {
          nodes.score.textContent = opts.scoreboard.score;
          nodes.extraLabel.textContent = opts.scoreboard.extraLabel;
          nodes.extra.textContent = opts.scoreboard.extra;
          nodes.best.textContent = opts.scoreboard.best;
        }
      },
      hide: function () { overlay.hidden = true; },
      isOpen: function () { return !overlay.hidden; }
    };
  };

  /* ------------------------------------------------------------------ */
  /* Sélecteur de difficulté                                             */
  /* ------------------------------------------------------------------ */

  Core.createDifficultyPicker = function (progress, onSelect) {
    var box = $('difficulty');
    var hint = $('diffHint');
    var list = progress.difficulties();

    list.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice';
      btn.dataset.diff = d.id;
      btn.textContent = d.label;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      box.appendChild(btn);
    });
    box.classList.add('choices-' + list.length);

    /* `persist` n'est vrai que sur un choix explicite du joueur : au chargement,
       rien ne doit être réécrit, sinon une réinitialisation laisse des traces. */
    function select(id, persist) {
      var def = progress.difficultyById(id);
      if (!def) { return; }
      if (persist) { progress.setSetting('difficulty', def.id); }
      Array.prototype.forEach.call(box.children, function (btn) {
        var active = btn.dataset.diff === def.id;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', String(active));
      });
      hint.textContent = def.hint || '';
      onSelect(def.id);
    }

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('.choice');
      if (btn) { select(btn.dataset.diff, true); }
    });

    return { select: select };
  };

  /* ------------------------------------------------------------------ */
  /* Barre d'outils et liens du menu                                     */
  /* ------------------------------------------------------------------ */

  Core.wireToolbar = function (options) {
    var progress = options.progress;
    var soundBtn = $('soundBtn');

    function syncSound() {
      soundBtn.setAttribute('aria-pressed', String(!!progress.getSetting('sound')));
    }

    $('pauseBtn').addEventListener('click', options.onPause);
    $('restartBtn').addEventListener('click', options.onRestart);
    $('statsBtn').addEventListener('click', function () { options.sheets.open('stats'); });

    // Le « i » du bandeau : les règles, à portée sans quitter la partie.
    var infoBtn = $('infoBtn');
    if (infoBtn) {
      infoBtn.addEventListener('click', function () { options.sheets.open('rules'); });
    }

    if (options.onQuit) {
      $('quitBtn').addEventListener('click', options.onQuit);
      // Quitter par la flèche du HUD enregistre aussi : c'est la même sortie.
      document.querySelector('.back').addEventListener('click', function (e) {
        e.preventDefault();
        options.onQuit();
      });
    }

    soundBtn.addEventListener('click', function () {
      var value = !progress.getSetting('sound');
      progress.setSetting('sound', value);
      syncSound();
      if (value && options.onSoundOn) { options.onSoundOn(); }
    });

    document.querySelector('.menu-links').addEventListener('click', function (e) {
      var btn = e.target.closest('.link');
      if (btn) { options.sheets.open(btn.dataset.sheet); }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && options.isPlaying()) { options.onPause(); }
    });

    syncSound();
    return { syncSound: syncSound };
  };
}());
