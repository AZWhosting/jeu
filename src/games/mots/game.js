/* Neon Mots — un mot caché, des essais, et à chaque essai la place exacte de
   chaque lettre. Tout le jeu tient dans le marquage des lettres : c'est là que
   les clones se trompent, sur les lettres répétées. Le reste n'est que rendu. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.mots;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/mots/manifest.js': manifest,
    'src/games/mots/words.js': window.MotsWords
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Mots : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var LETTER_POINTS = 30;       // par lettre du mot trouvé
  var SPARE_BONUS = 40;         // par essai resté inutilisé
  var RESTART_GRACE = 700;
  var NEXT_DELAY = 1500;        // temps d'arrêt sur le mot résolu

  // Disposition AZERTY : c'est un jeu français, le clavier l'est aussi.
  var ROWS = ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN'];

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* Le marquage des lettres                                             */
  /* ------------------------------------------------------------------ */

  /* Deux passes, et l'ordre compte. La première réserve les lettres bien
     placées ; seules les lettres non réservées peuvent ensuite être signalées
     « présente ailleurs ». Sans cela, un mot proposant deux fois la même lettre
     alors que la solution n'en contient qu'une la verrait signalée deux fois. */
  function markGuess(guess, solution) {
    var n = solution.length;
    var out = [];
    var left = {};
    var i;
    for (i = 0; i < n; i++) {
      if (guess.charAt(i) === solution.charAt(i)) { out[i] = 'correct'; }
      else {
        out[i] = 'absent';
        left[solution.charAt(i)] = (left[solution.charAt(i)] || 0) + 1;
      }
    }
    for (i = 0; i < n; i++) {
      if (out[i] === 'correct') { continue; }
      var c = guess.charAt(i);
      if (left[c] > 0) { out[i] = 'present'; left[c]--; }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | paused | over
  var difficulty = progress.difficulty();
  var word, rows, current, keyState, used;
  var score, guesses, resolved, revealUntil;
  var particles;
  var run, runStartedAt, runCommitted, overSince = 0, pauseUntil = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function size() { return conf().size || 5; }
  function tries() { return conf().tries || 6; }
  function best() { return progress.bestFor(difficulty); }
  function list() { return window.MotsWords[size()] || []; }
  function gifted() { return !!progress.getSetting('first'); }

  function knownWord(w) {
    var all = list();
    // La liste est triée : une recherche dichotomique suffit.
    var lo = 0, hi = all.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (all[mid] === w) { return true; }
      if (all[mid] < w) { lo = mid + 1; } else { hi = mid - 1; }
    }
    return false;
  }

  function pickWord() {
    var all = list();
    for (var attempt = 0; attempt < 40; attempt++) {
      var w = all[Math.floor(Math.random() * all.length)];
      if (!used[w]) { return w; }
    }
    used = {};                  // la liste est épuisée : on repart à zéro
    return all[Math.floor(Math.random() * all.length)];
  }

  function newWord(forced) {
    word = forced || pickWord();
    used[word] = true;
    rows = [];
    keyState = {};
    resolved = 0;
    revealUntil = 0;
    current = gifted() ? word.charAt(0) : '';
    renderHud();
  }

  function resetRun() {
    score = 0;
    guesses = 0;
    particles = [];
    used = {};
    run = progress.newRun(difficulty);
    run.bestTry = 0;
    run.lastGasp = false;
    run.unaided = false;
    runStartedAt = performance.now();
    runCommitted = false;
    newWord();
  }

  /* ------------------------------------------------------------------ */
  /* Saisie                                                              */
  /* ------------------------------------------------------------------ */

  function floor() { return gifted() ? 1 : 0; }   // la lettre offerte ne s'efface pas

  function type(letter) {
    if (state !== 'playing' || resolved) { return false; }
    if (current.length >= size()) { return false; }
    current += letter;
    audio.blip(320 + current.length * 30, 0.03, 'square', 0.025);
    return true;
  }

  function backspace() {
    if (state !== 'playing' || resolved) { return false; }
    if (current.length <= floor()) { return false; }
    current = current.slice(0, -1);
    audio.blip(200, 0.04, 'triangle', 0.03);
    return true;
  }

  function submit() {
    if (state !== 'playing' || resolved) { return false; }
    if (current.length < size()) {
      floatText('Il manque des lettres', '#ffd166');
      audio.blip(140, 0.08, 'square', 0.04);
      return false;
    }
    if (progress.getSetting('strict') && !knownWord(current)) {
      floatText('Mot inconnu', '#ff5d8f');
      audio.blip(120, 0.1, 'sawtooth', 0.05);
      return false;
    }

    var marks = markGuess(current, word);
    rows.push({ word: current, marks: marks });
    guesses++;
    run.guesses++;
    rankKeys(current, marks);

    if (current === word) { found(); }
    else if (rows.length >= tries()) { missed(); }
    else {
      current = gifted() ? word.charAt(0) : '';
      audio.pickup();
    }
    renderHud();
    return true;
  }

  /* L'état d'une touche ne redescend jamais : bien placée l'emporte sur
     présente, qui l'emporte sur absente. */
  function rankKeys(guess, marks) {
    var order = { absent: 1, present: 2, correct: 3 };
    for (var i = 0; i < guess.length; i++) {
      var c = guess.charAt(i);
      if (!keyState[c] || order[marks[i]] > order[keyState[c]]) { keyState[c] = marks[i]; }
    }
  }

  function found() {
    resolved = 1;
    revealUntil = performance.now() + NEXT_DELAY;
    var spare = tries() - rows.length;
    var gained = Math.round((LETTER_POINTS * size() + SPARE_BONUS * spare) * (conf().bonus || 1));
    score += gained;
    run.score = score;
    run.words++;
    run.streak++;
    run.bestTry = run.bestTry ? Math.min(run.bestTry, rows.length) : rows.length;
    if (rows.length === tries()) { run.lastGasp = true; }
    if (!gifted()) { run.unaided = true; }

    burst(ramp().correct, 22);
    floatText('Trouvé ! +' + gained, ramp().correct);
    audio.unlocked();
    checkUnlocks();

    setTimeout(function () {
      if (state !== 'playing') { return; }
      newWord();
    }, NEXT_DELAY);
  }

  function missed() {
    resolved = -1;
    revealUntil = performance.now() + NEXT_DELAY;
    run.missed++;
    audio.fail();
    floatText('C\'était ' + word, '#ff5d8f');

    if (conf().forgiving) {
      run.streak = 0;
      setTimeout(function () {
        if (state !== 'playing') { return; }
        newWord();
      }, NEXT_DELAY);
      return;
    }
    setTimeout(function () {
      if (state !== 'playing') { return; }
      finish();
    }, NEXT_DELAY);
  }

  function finish() {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Mot manqué',
      subtitle: 'Le mot était ' + word + '.',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Mots trouvés',
        extra: run.words,
        best: Math.max(best(), score)
      }
    });
  }

  function checkUnlocks() {
    run.durationMs = performance.now() - runStartedAt;
    var fresh = progress.evaluate(run);
    if (!fresh.length) { return; }
    fresh.forEach(function (item) { sheets.toast(item); });
    audio.unlocked();
  }

  function commitRun() {
    if (!run || runCommitted || run.guesses === 0) {
      runCommitted = true;
      return null;
    }
    runCommitted = true;
    run.durationMs = performance.now() - runStartedAt;
    run.score = score;
    var result = progress.finishRun(run);
    result.unlocked.forEach(function (item) { sheets.toast(item); });
    if (result.unlocked.length) { audio.unlocked(); }
    return result;
  }

  function quitToHub() {
    commitRun();
    location.href = 'index.html';
  }

  /* ------------------------------------------------------------------ */
  /* Effets                                                              */
  /* ------------------------------------------------------------------ */

  function burst(color, count) {
    if (!effectsOn() || !loop) { return; }
    var g = geometry();
    var y = g.gridY + (rows.length - 0.5) * (g.cell + g.gap);
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.7 + Math.random() * 2;
      particles.push({
        x: g.size / 2 + (Math.random() - 0.5) * g.gridW, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.0022 + Math.random() * 0.002,
        size: 1.4 + Math.random() * 2.4, color: color
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= p.decay * dt;
      if (p.life <= 0) { particles.splice(i, 1); }
    }
  }

  function floatText(text, color) {
    if (!effectsOn()) { return; }
    var el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = '50%';
    el.style.top = '64%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  function geometry() {
    var s = loop.size();
    var pad = s * 0.03;
    var gap = Math.max(2, s * 0.012);
    var gridTop = s * 0.035;
    var gridBottom = s * 0.635;
    var cols = size(), lines = tries();
    var availW = s - pad * 2, availH = gridBottom - gridTop;
    var cell = Math.min((availW - (cols - 1) * gap) / cols,
                        (availH - (lines - 1) * gap) / lines);
    var gridW = cols * cell + (cols - 1) * gap;
    var gridH = lines * cell + (lines - 1) * gap;

    var kbTop = s * 0.665, kbBottom = s * 0.985;
    var rowGap = s * 0.012;
    var rowH = (kbBottom - kbTop - rowGap * 2) / 3;
    var keyGap = Math.max(2, s * 0.008);
    var unit = (availW - keyGap * 9) / 10;

    return { size: s, pad: pad, gap: gap, cell: cell,
             gridW: gridW, gridH: gridH,
             gridX: (s - gridW) / 2, gridY: gridTop + (availH - gridH) / 2,
             kbTop: kbTop, rowH: rowH, rowGap: rowGap, keyGap: keyGap, unit: unit };
  }

  /* Les touches de l'écran, avec leur rectangle : le rendu et la détection du
     toucher lisent la même liste, donc elles ne peuvent pas diverger. */
  function keyBoxes() {
    var g = geometry();
    var out = [];
    ROWS.forEach(function (letters, r) {
      var y = g.kbTop + r * (g.rowH + g.rowGap);
      var items = [];
      if (r === 2) { items.push({ id: '\n', label: '⏎', w: g.unit * 1.5 }); }
      letters.split('').forEach(function (c) { items.push({ id: c, label: c, w: g.unit }); });
      if (r === 2) { items.push({ id: '\b', label: '⌫', w: g.unit * 1.5 }); }

      var total = items.reduce(function (a, it) { return a + it.w; }, 0) +
                  g.keyGap * (items.length - 1);
      var x = (g.size - total) / 2;
      items.forEach(function (it) {
        out.push({ id: it.id, label: it.label, x: x, y: y, w: it.w, h: g.rowH });
        x += it.w + g.keyGap;
      });
    });
    return out;
  }

  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;
    var keys = keyBoxes();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h) { return k.id; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function fillFor(mark, index) {
    var skin = progress.currentSkin();
    var r = ramp();
    if (mark === 'correct') {
      return skin.rainbow ? 'hsl(' + ((index * 47) % 360) + ', 75%, 58%)' : r.correct;
    }
    if (mark === 'present') {
      return skin.rainbow ? 'hsl(' + ((index * 47 + 180) % 360) + ', 70%, 60%)' : r.present;
    }
    if (mark === 'absent') { return r.absent; }
    return r.empty;
  }

  function roundRect(x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawCell(g, col, line, letter, mark, active) {
    var x = g.gridX + col * (g.cell + g.gap);
    var y = g.gridY + line * (g.cell + g.gap);
    ctx.save();
    ctx.fillStyle = fillFor(mark, col + line * 3);
    roundRect(x, y, g.cell, g.cell, g.cell * 0.18);
    ctx.fill();
    if (!mark || mark === 'typing') {
      ctx.strokeStyle = active ? ramp().correct : ramp().edge;
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
    }
    if (letter) {
      ctx.fillStyle = (mark === 'correct' || mark === 'present') ? ramp().ink : '#e8eefc';
      ctx.font = '700 ' + Math.round(g.cell * 0.52) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, x + g.cell / 2, y + g.cell * 0.54);
    }
    ctx.restore();
  }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!rows) { return; }

    var line, col;
    for (line = 0; line < tries(); line++) {
      var past = rows[line];
      for (col = 0; col < size(); col++) {
        if (past) {
          drawCell(g, col, line, past.word.charAt(col), past.marks[col], false);
        } else if (line === rows.length && !resolved) {
          var typed = current.charAt(col);
          drawCell(g, col, line, typed, typed ? 'typing' : null, col === current.length);
        } else {
          drawCell(g, col, line, '', null, false);
        }
      }
    }

    // Clavier de l'écran.
    keyBoxes().forEach(function (k) {
      var mark = keyState[k.id];
      ctx.save();
      ctx.fillStyle = mark ? fillFor(mark, 0) : 'rgba(120, 150, 200, 0.14)';
      roundRect(k.x, k.y, k.w, k.h, k.h * 0.26);
      ctx.fill();
      if (!mark) {
        ctx.strokeStyle = ramp().edge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = (mark === 'correct' || mark === 'present') ? ramp().ink : '#e8eefc';
      ctx.font = '600 ' + Math.max(11, Math.round(k.h * 0.44)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(k.label, k.x + k.w / 2, k.y + k.h * 0.54);
      ctx.restore();
    });

    ctx.save();
    particles.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  function renderHud() {
    hud.set({
      score: score,
      side: run ? run.streak : 0,
      sideVisible: state === 'playing' || state === 'paused',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Essais',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : guesses
    });
  }

  function startGame() {
    audio.unlock();
    commitRun();
    resetRun();
    state = 'playing';
    loop.resetClock();
    panel.hide();
    renderHud();
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      panel.show({ title: 'Pause', subtitle: 'Le mot t\'attend.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      pauseUntil = performance.now() + 250;
      loop.resetClock();
      panel.hide();
    }
  }

  function guardedStart() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return true; }
    if (state === 'menu' || state === 'over') { startGame(); return true; }
    return false;
  }

  /* Une seule porte d'entrée : le clavier physique et celui de l'écran y
     passent tous les deux. */
  function input(ch) {
    if (state === 'menu' || state === 'over') {
      if (ch === '\n') { guardedStart(); }
      return;
    }
    if (state === 'paused') {
      if (ch === '\n') { togglePause(); }
      return;
    }
    if (performance.now() < pauseUntil) { return; }
    if (ch === '\n') { submit(); }
    else if (ch === '\b') { backspace(); }
    else { type(ch); }
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  hud = Core.createHud(progress);
  panel = Core.createPanel(function () {
    if (state === 'paused') { togglePause(); } else { startGame(); }
  }, function () { quitToHub(); });

  sheets = Core.createSheets(progress, {
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* la palette est relue à chaque image */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
      // La lettre offerte apparaît ou disparaît sans attendre le mot suivant.
      if (name === 'first' && state !== 'menu' && !rows.length && !resolved) {
        current = gifted() ? word.charAt(0) : '';
      }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // rien ne bouge sans le joueur
    render: draw
  });
  ctx = loop.ctx;

  Core.attachInput({
    canvas: canvas,
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onText: input,
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var key = locate(pos);
      if (key) { input(key); }
    },
    onAction: function () { if (!guardedStart()) { togglePause(); } },
    onEscape: function () { if (state === 'playing') { togglePause(); } }
  });

  toolbar = Core.wireToolbar({
    progress: progress,
    sheets: sheets,
    onPause: function () { if (state === 'playing' || state === 'paused') { togglePause(); } },
    onRestart: startGame,
    onQuit: quitToHub,
    onSoundOn: function () { audio.unlock(); audio.pickup(); },
    isPlaying: function () { return state === 'playing'; }
  });

  picker = Core.createDifficultyPicker(progress, function (id) {
    difficulty = id;
    if (run && (state === 'menu' || state === 'over')) {
      resetRun();
      state = 'menu';
    }
    renderHud();
  });

  /* ------------------------------------------------------------------ */
  /* Sonde de test et démarrage                                          */
  /* ------------------------------------------------------------------ */

  window.__neonMots = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        size: size(),
        tries: tries(),
        word: word,
        current: current,
        rows: rows.map(function (r) { return { word: r.word, marks: r.marks.slice() }; }),
        keys: JSON.parse(JSON.stringify(keyState)),
        resolved: resolved,
        score: score,
        guesses: guesses,
        streak: run ? run.streak : 0,
        words: run ? run.words : 0,
        missed: run ? run.missed : 0,
        bestTry: run ? run.bestTry : 0,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    // Le marquage, exposé nu : c'est la règle qu'on veut pouvoir éprouver.
    mark: function (guess, solution) { return markGuess(guess, solution); },
    words: function (n) { return (window.MotsWords[n] || []).slice(); },
    known: function (w) { return knownWord(w); },
    setWord: function (w) { newWord(String(w).toUpperCase()); },
    type: function (ch) { return input(String(ch).toUpperCase()); },
    /* Écrit un mot entier puis le valide, comme le ferait le joueur — donc
       avec les mêmes limites : la première lettre offerte ne s'efface pas, et
       une proposition qui ne commence pas pareil est tout simplement
       impossible à saisir. On le dit plutôt que d'en écrire une autre. */
    guess: function (w) {
      var text = String(w).toUpperCase();
      if (text.length !== size()) { return false; }
      while (current.length > floor()) { backspace(); }
      if (current.length && text.indexOf(current) !== 0) { return false; }
      for (var i = current.length; i < text.length; i++) { type(text.charAt(i)); }
      return submit();
    },
    submit: submit,
    backspace: backspace,
    geometry: geometry,
    keyBoxes: keyBoxes,
    locate: function (x, y) { return locate({ x: x, y: y }); }
  };
  window.Progress = progress;
  window.Sheets = sheets;

  Core.Shell.dress(manifest);
  hud.set({ sideLabel: manifest.sideLabel });
  Core.applyTheme(progress);
  loop.resize();
  resetRun();
  picker.select(difficulty);
  state = 'menu';
  loop.start();
}());
