/* Neon Echo — la machine joue une suite de dalles, le joueur la rend. Elle
   s'allonge d'une dalle par manche, et le rythme presse.

   La démonstration n'est pas une chaîne de setTimeout mais une lecture de
   l'horloge à chaque image : une pause, un onglet en arrière-plan ou une
   image sautée ne peuvent donc pas la désynchroniser. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.echo;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/echo/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Echo : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var ROUND_POINTS = 10;        // par dalle de la séquence rendue
  var LEAD_IN = 700;            // silence avant que la machine ne commence
  var PRESS_LIT = 190;          // durée d'illumination d'une dalle frappée
  var WRONG_HOLD = 900;         // temps d'arrêt sur la faute
  var RESTART_GRACE = 700;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  // menu | showing (la machine joue) | input (à toi) | wrong | paused | over
  var state = 'menu';
  var difficulty = progress.difficulty();
  var sequence, cursor, round, score;
  var demoStart, demoIndex, lit, litUntil, wrongPad, wrongUntil;
  var particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function padCount() { return conf().pads || 4; }
  function reversed() { return !!conf().reverse; }
  function best() { return progress.bestFor(difficulty); }

  /* La durée d'une dalle allumée : elle raccourcit d'une manche à l'autre,
     et s'arrête net au plancher de la difficulté. */
  function litMs() {
    var c = conf();
    if (progress.getSetting('steady')) { return c.start; }
    return Math.max(c.floor, c.start - (round - 1) * c.step);
  }
  function gapMs() { return Math.round(litMs() * 0.35); }
  function stepMs() { return litMs() + gapMs(); }

  /* Ce que le joueur doit rendre : la séquence, à l'endroit ou à l'envers. */
  function expected() {
    return reversed() ? sequence.slice().reverse() : sequence.slice();
  }

  function resetRun() {
    sequence = [];
    round = 0;
    score = 0;
    particles = [];
    lit = -1;
    litUntil = 0;
    wrongPad = -1;
    wrongUntil = 0;
    run = progress.newRun(difficulty);
    run.pads = padCount();
    runStartedAt = performance.now();
    runCommitted = false;
  }

  /* Une manche de plus : la suite garde son préfixe et gagne une dalle. */
  function nextRound() {
    sequence.push(Math.floor(Math.random() * padCount()));
    round = sequence.length;
    run.round = Math.max(run.round, round);
    cursor = 0;
    demoIndex = -1;
    demoStart = performance.now() + LEAD_IN;
    state = 'showing';
    renderHud();
  }

  function replayRound() {
    cursor = 0;
    demoIndex = -1;
    demoStart = performance.now() + LEAD_IN;
    state = 'showing';
    renderHud();
  }

  /* ------------------------------------------------------------------ */
  /* La démonstration, pilotée par l'horloge                             */
  /* ------------------------------------------------------------------ */

  function advanceDemo(now) {
    if (state !== 'showing') { return; }
    if (now < demoStart) { return; }
    var step = stepMs();
    var index = Math.floor((now - demoStart) / step);
    if (index >= sequence.length) {
      state = 'input';
      lit = -1;
      return;
    }
    if (index !== demoIndex) {
      demoIndex = index;
      var pad = sequence[index];
      lit = pad;
      litUntil = demoStart + index * step + litMs();
      audio.blip(manifest.pads[pad].note, litMs() / 1000 * 0.7, 'triangle', 0.06);
    }
    if (now > litUntil) { lit = -1; }
  }

  /* ------------------------------------------------------------------ */
  /* Frappe                                                              */
  /* ------------------------------------------------------------------ */

  function press(pad) {
    if (pad < 0 || pad >= padCount()) { return false; }
    // Frapper pendant que la machine joue ne compte pas : on écoute d'abord.
    if (state !== 'input') { return false; }

    lit = pad;
    litUntil = performance.now() + PRESS_LIT;
    audio.blip(manifest.pads[pad].note, 0.16, 'triangle', 0.06);
    run.presses++;

    var want = expected();
    if (pad !== want[cursor]) { slip(pad); return false; }

    cursor++;
    if (cursor >= want.length) { clearRound(); }
    return true;
  }

  function slip(pad) {
    run.slips++;
    wrongPad = pad;
    wrongUntil = performance.now() + WRONG_HOLD;
    state = 'wrong';
    audio.fail();
    shake();

    if (conf().forgiving) {
      floatText('Presque — on rejoue', '#ffd166');
      setTimeout(function () {
        if (state !== 'wrong') { return; }
        wrongPad = -1;
        replayRound();
      }, WRONG_HOLD);
      return;
    }
    setTimeout(function () {
      if (state !== 'wrong') { return; }
      finish();
    }, WRONG_HOLD);
  }

  function clearRound() {
    var gained = Math.round(ROUND_POINTS * round * (conf().bonus || 1));
    score += gained;
    run.score = score;
    run.rounds++;
    burst(manifest.pads[sequence[sequence.length - 1]].color, 16);
    floatText('+' + gained, ramp()[0]);
    audio.chain(Math.min(6, round));
    checkUnlocks();
    renderHud();
    setTimeout(function () {
      if (state !== 'input') { return; }
      nextRound();
    }, 620);
  }

  function finish() {
    state = 'over';
    overSince = performance.now();
    wrongPad = -1;
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Séquence perdue',
      subtitle: 'Tu as tenu ' + run.round + (run.round > 1 ? ' dalles.' : ' dalle.'),
      cta: 'Rejouer',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Plus longue suite',
        extra: run.round,
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
    if (!run || runCommitted || run.presses === 0) {
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

  function shake() {
    if (!effectsOn()) { return; }
    var wrap = document.querySelector('.board-wrap');
    if (!wrap) { return; }
    wrap.classList.remove('shake');
    void wrap.offsetWidth;
    wrap.classList.add('shake');
  }

  function burst(color, count) {
    if (!effectsOn() || !loop) { return; }
    var s = loop.size();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.8 + Math.random() * 2.2;
      particles.push({
        x: s / 2, y: s / 2,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.0022 + Math.random() * 0.002,
        size: 1.6 + Math.random() * 2.6, color: color
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vx *= 0.96;
      p.vy *= 0.96;
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
    el.style.top = '50%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie et rendu                                                  */
  /* ------------------------------------------------------------------ */

  function grid() { return padCount() === 6 ? { cols: 3, lines: 2 } : { cols: 2, lines: 2 }; }

  function geometry() {
    var s = loop.size();
    var g = grid();
    var pad = s * 0.045;
    var gap = s * 0.030;
    var top = s * 0.13;                      // bandeau d'état au-dessus
    var w = (s - pad * 2 - gap * (g.cols - 1)) / g.cols;
    var h = (s - top - pad - gap * (g.lines - 1)) / g.lines;
    return { size: s, pad: pad, gap: gap, top: top, w: w, h: h, cols: g.cols, lines: g.lines };
  }

  function padBox(index) {
    var geo = geometry();
    var col = index % geo.cols, line = Math.floor(index / geo.cols);
    return {
      x: geo.pad + col * (geo.w + geo.gap),
      y: geo.top + line * (geo.h + geo.gap),
      w: geo.w, h: geo.h
    };
  }

  function locate(pos) {
    var s = loop.size();
    var px = pos.x * s, py = pos.y * s;
    for (var i = 0; i < padCount(); i++) {
      var b = padBox(i);
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { return i; }
    }
    return -1;
  }

  function ramp() {
    var skin = progress.currentSkin();
    return skin.ramp || manifest.ramps.neon;
  }

  function padColor(index) {
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((index * 61) % 360) + ', 80%, 62%)'; }
    var r = ramp();
    return r[index] || manifest.pads[index].color;
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

  function banner() {
    if (state === 'showing') { return { text: 'Écoute…', color: '#c084fc' }; }
    if (state === 'input') {
      return { text: reversed() ? 'À toi, à l\'envers' : 'À toi',
               color: ramp()[0] || '#38f9c3' };
    }
    if (state === 'wrong') { return { text: 'Raté', color: '#ff5d8f' }; }
    return { text: '', color: '#8b9ac0' };
  }

  function draw(now, alpha, dt) {
    var geo = geometry();
    advanceDemo(now);
    if (now > litUntil && state !== 'showing') { lit = -1; }
    if (state === 'wrong' && now > wrongUntil) { wrongPad = -1; }
    updateParticles(dt);
    ctx.clearRect(0, 0, geo.size, geo.size);

    for (var i = 0; i < padCount(); i++) {
      var b = padBox(i);
      var color = padColor(i);
      var on = (i === lit);
      var bad = (i === wrongPad);

      ctx.save();
      if (on || bad) { ctx.shadowColor = bad ? '#ff5d8f' : color; ctx.shadowBlur = 26; }
      ctx.globalAlpha = bad ? 1 : (on ? 1 : 0.30);
      ctx.fillStyle = bad ? '#ff5d8f' : color;
      roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.16);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = on || bad ? 'rgba(255, 255, 255, 0.55)' : 'rgba(120, 150, 200, 0.28)';
      ctx.lineWidth = on || bad ? 2.5 : 1;
      ctx.stroke();

      // Le symbole tient le même rôle que la couleur, pour qui ne la distingue
      // pas — et le même que la note, pour qui joue sans le son.
      if (progress.getSetting('glyphs')) {
        ctx.globalAlpha = on || bad ? 1 : 0.55;
        ctx.fillStyle = on ? 'rgba(6, 18, 26, 0.85)' : color;
        ctx.font = Math.round(Math.min(b.w, b.h) * 0.34) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(manifest.pads[i].glyph, b.x + b.w / 2, b.y + b.h * 0.54);
      }
      ctx.restore();
    }

    // Bandeau : qui joue, et où on en est dans la séquence.
    var msg = banner();
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = msg.color;
    ctx.font = '700 ' + Math.round(geo.size * 0.052) + 'px system-ui, sans-serif';
    ctx.fillText(msg.text, geo.size / 2, geo.top * 0.42);

    if (state === 'showing' || state === 'input') {
      var done = state === 'showing' ? Math.max(0, demoIndex + 1) : cursor;
      var total = sequence.length;
      var dotR = Math.max(2.5, geo.size * 0.008);
      var spread = Math.min(geo.size * 0.8, total * dotR * 3.4);
      var x0 = geo.size / 2 - spread / 2 + (spread / Math.max(1, total)) / 2;
      for (var d = 0; d < total; d++) {
        ctx.globalAlpha = d < done ? 0.95 : 0.30;
        ctx.fillStyle = state === 'showing' ? '#c084fc' : (ramp()[0] || '#38f9c3');
        ctx.beginPath();
        ctx.arc(x0 + d * (spread / Math.max(1, total)), geo.top * 0.78, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

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
      side: round,
      sideVisible: state !== 'menu',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Manches',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : (run ? run.rounds : 0)
    });
  }

  function startGame() {
    audio.unlock();
    commitRun();
    resetRun();
    panel.hide();
    loop.resetClock();
    nextRound();
  }

  function togglePause() {
    if (state === 'showing' || state === 'input' || state === 'wrong') {
      state = 'paused';
      lit = -1;
      panel.show({ title: 'Pause', subtitle: 'La séquence t\'attend.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      panel.hide();
      loop.resetClock();
      // On ne reprend pas au milieu d'une démonstration : on la rejoue en
      // entier, sinon le joueur devrait deviner ce qu'il a manqué.
      replayRound();
    }
  }

  function playing() {
    return state === 'showing' || state === 'input' || state === 'wrong';
  }

  function guardedStart() {
    if (state === 'over' && performance.now() - overSince < RESTART_GRACE) { return true; }
    if (state === 'menu' || state === 'over') { startGame(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  hud = Core.createHud(progress);
  panel = Core.createPanel(function () {
    if (state === 'paused') { togglePause(); } else { startGame(); }
  }, function () { quitToHub(); });

  sheets = Core.createSheets(progress, {
    onOpen: function () { if (playing()) { togglePause(); } },
    onSkinChange: function () { /* la palette est relue à chaque image */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // tout est piloté par l'horloge du rendu
    render: draw
  });
  ctx = loop.ctx;

  var padKeys = {};
  for (var k = 1; k <= 6; k++) {
    padKeys[String(k)] = (function (index) {
      return function () { if (!guardedStart()) { press(index); } };
    }(k - 1));
  }

  Core.attachInput({
    canvas: canvas,
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var pad = locate(pos);
      if (pad >= 0) { press(pad); }
    },
    onAction: function () { if (!guardedStart()) { togglePause(); } },
    onEscape: function () { if (playing()) { togglePause(); } },
    keys: padKeys
  });

  toolbar = Core.wireToolbar({
    progress: progress,
    sheets: sheets,
    onPause: function () { if (playing() || state === 'paused') { togglePause(); } },
    onRestart: startGame,
    onQuit: quitToHub,
    onSoundOn: function () { audio.unlock(); audio.pickup(); },
    isPlaying: playing
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

  window.__neonEcho = {
    snapshot: function () {
      return {
        state: state,
        difficulty: difficulty,
        pads: padCount(),
        reverse: reversed(),
        sequence: sequence.slice(),
        expected: expected(),
        cursor: cursor,
        round: round,
        score: score,
        rounds: run ? run.rounds : 0,
        slips: run ? run.slips : 0,
        presses: run ? run.presses : 0,
        bestRound: run ? run.round : 0,
        litMs: litMs(),
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    press: function (pad) { return press(pad); },
    // Saute la démonstration : les tests n'ont pas à l'écouter en temps réel.
    skipDemo: function () {
      if (state !== 'showing') { return false; }
      demoStart = performance.now() - stepMs() * (sequence.length + 1);
      demoIndex = sequence.length;
      state = 'input';
      lit = -1;
      return true;
    },
    // Rend la séquence attendue, sans faute.
    replay: function () {
      var want = expected();
      for (var i = 0; i < want.length; i++) {
        if (!press(want[i])) { return false; }
      }
      return true;
    },
    /* Place le jeu en phase de réponse sur une séquence donnée. Les tests
       peuvent ainsi éprouver chaque position de la séquence sans réécouter la
       démonstration à chaque fois. */
    arm: function (list) {
      if (state === 'menu' || state === 'over') { return false; }
      sequence = list.slice();
      round = sequence.length;
      if (run) { run.round = Math.max(run.round, round); }
      cursor = 0;
      demoIndex = sequence.length;
      lit = -1;
      wrongPad = -1;
      state = 'input';
      renderHud();
      return true;
    },
    pads: function () { return manifest.pads; },
    padBox: padBox,
    locate: function (x, y) { return locate({ x: x, y: y }); }
  };
  window.Progress = progress;
  window.Sheets = sheets;

  Core.Shell.dress(manifest);
  hud.set({ sideLabel: manifest.sideLabel });
  Core.applyTheme(progress);
  loop.resize();
  resetRun();
  cursor = 0;
  picker.select(difficulty);
  state = 'menu';
  loop.start();
}());
