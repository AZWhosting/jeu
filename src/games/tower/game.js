/* Neon Tower — monter, ou encaisser.

   Le hasard est ici au centre du jeu, ce que la plateforme avait évité
   jusqu'à présent. Il est donc entièrement montré : la porte piégée est tirée
   au sort à l'entrée du palier, avant tout choix du joueur, et le jeu affiche
   la probabilité exacte, ce que deviendrait le pot et l'espérance du coup.
   Rien n'est décidé après coup, et les tests le vérifient. */
(function () {
  'use strict';

  var manifest = window.Games && window.Games.tower;
  var required = {
    'src/core/storage.js': window.Core && Core.Storage,
    'src/core/progress.js': window.Core && Core.createProgress,
    'src/core/sheets.js': window.Core && Core.createSheets,
    'src/core/loop.js': window.Core && Core.createLoop,
    'src/core/input.js': window.Core && Core.attachInput,
    'src/core/audio.js': window.Core && Core.createAudio,
    'src/core/ui.js': window.Core && Core.createHud,
    'src/core/shell.js': window.Core && Core.Shell,
    'src/games/tower/manifest.js': manifest
  };
  var missing = Object.keys(required).filter(function (file) { return !required[file]; }).join(', ');
  if (missing) {
    var note = document.getElementById('subtitle');
    if (note) {
      note.textContent = 'Chargement incomplet (' + missing + '). Recharge la page avec Ctrl+Maj+R.';
      note.style.color = '#ff5d8f';
    }
    console.error('Neon Tower : ' + missing + ' n\'a pas été chargé.');
    return;
  }

  var progress = Core.createProgress(manifest);
  var audio = Core.createAudio(function () { return !!progress.getSetting('sound'); });
  var sheets, loop, ctx, hud, panel, toolbar, picker;

  var SUMMIT_BONUS = 1.5;       // le pot du sommet, une fois la tour finie
  var PROBES_START = 2;
  var PROBES_MAX = 5;
  var FALL_HOLD = 1100;         // temps d'arrêt sur le piège ouvert
  var SUMMIT_HOLD = 1500;
  var RESTART_GRACE = 700;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var effectsOn = function () { return !!progress.getSetting('effects'); };

  var canvas = $('board');
  var effects = $('effects');

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = 'menu';           // menu | playing | falling | paused | over
  var difficulty = progress.difficulty();
  var level, doors, trap, revealed, pot, probes, probedThisClimb;
  var lives, score, pending, openedDoor, holdUntil;
  var particles;
  var run, runStartedAt, runCommitted, overSince = 0;

  function conf() { return progress.difficultyById(difficulty); }
  function ladder() { return manifest.ladders[conf().ladder] || manifest.ladders.normal; }
  function tipping() { return conf().tipping || 99; }
  function best() { return progress.bestFor(difficulty); }
  function step() { return ladder()[Math.min(level, ladder().length) - 1]; }
  function atSummit() { return level > ladder().length; }

  /* Ce que le palier courant propose, tel qu'il est affiché au joueur. */
  function odds() {
    if (atSummit()) { return null; }
    var s = step();
    var chance = (s.doors - 1) / s.doors;
    return {
      doors: s.doors,
      chance: chance,
      nextPot: s.pot,
      expected: chance * s.pot,
      held: pot,
      worth: chance * s.pot >= pot
    };
  }

  /* Le tirage : la porte piégée est fixée à l'entrée du palier, avant que le
     joueur n'ait choisi quoi que ce soit. */
  function deal() {
    var s = step();
    doors = s.doors;
    trap = Math.floor(Math.random() * doors);
    revealed = {};
    pending = -1;
    openedDoor = -1;
  }

  function newClimb() {
    level = 1;
    pot = 0;
    probedThisClimb = false;
    deal();
    renderHud();
  }

  function resetRun() {
    score = 0;
    lives = conf().lives || 0;
    probes = PROBES_START;
    particles = [];
    run = progress.newRun(difficulty);
    run.wiseBank = false;
    run.greedyBank = false;
    run.blindBank = false;
    runStartedAt = performance.now();
    runCommitted = false;
    newClimb();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function open(door) {
    if (state !== 'playing' || atSummit()) { return false; }
    if (door < 0 || door >= doors) { return false; }

    // Au-delà du basculement, un réglage demande confirmation : deux fois la
    // même porte. Il vaut mieux hésiter par choix que par accident.
    if (progress.getSetting('confirm') && level >= tipping() && pending !== door) {
      pending = door;
      floatText('Encore une fois pour confirmer', '#ffd166');
      return false;
    }
    pending = -1;

    if (door === trap) { fall(door); return false; }

    openedDoor = door;
    pot = step().pot;
    level++;
    run.climbs++;
    run.deepest = Math.max(run.deepest, level - 1);
    audio.chain(Math.min(6, level));
    burst(ramp().safe, 10);

    if (atSummit()) { summit(); return true; }
    deal();
    renderHud();
    return true;
  }

  function fall(door) {
    openedDoor = door;
    state = 'falling';
    holdUntil = performance.now() + FALL_HOLD;
    run.traps++;
    pot = 0;
    audio.fail();
    shake();
    floatText('Piège — le pot est perdu', ramp().trap);

    if (!conf().forgiving) { lives--; }
    renderHud();

    setTimeout(function () {
      if (state !== 'falling') { return; }
      if (!conf().forgiving && lives <= 0) { finish(false); return; }
      state = 'playing';
      newClimb();
    }, FALL_HOLD);
  }

  function bank() {
    if (state !== 'playing' || pot <= 0) { return false; }
    score += pot;
    run.score = score;
    run.banked++;
    if (level === tipping()) { run.wiseBank = true; }
    if (level > tipping()) { run.greedyBank = true; }
    if (!probedThisClimb) { run.blindBank = true; }
    probes = Math.min(PROBES_MAX, probes + 1);

    burst(ramp().pot, 18);
    floatText('Encaissé +' + pot, ramp().pot);
    audio.unlocked();
    checkUnlocks();
    newClimb();
    return true;
  }

  function summit() {
    var gained = Math.round(pot * SUMMIT_BONUS);
    pot = gained;
    state = 'falling';                 // même temps d'arrêt, autre raison
    holdUntil = performance.now() + SUMMIT_HOLD;
    burst(ramp().pot, 34);
    floatText('Sommet ! ' + gained, ramp().pot);
    audio.unlocked();
    setTimeout(function () {
      if (state !== 'falling') { return; }
      state = 'playing';
      bank();
    }, SUMMIT_HOLD);
  }

  /* La sonde ouvre le rideau sur une porte, sans l'ouvrir. */
  function probe() {
    if (state !== 'playing' || atSummit() || probes <= 0) { return -1; }
    var libres = [];
    for (var i = 0; i < doors; i++) { if (revealed[i] === undefined) { libres.push(i); } }
    if (libres.length <= 1) { return -1; }      // sonder la dernière n'apprend rien
    var pick = libres[Math.floor(Math.random() * libres.length)];
    revealed[pick] = (pick === trap);
    probes--;
    probedThisClimb = true;
    audio.blip(620, 0.09, 'triangle', 0.05);
    renderHud();
    return pick;
  }

  function finish(won) {
    state = 'over';
    overSince = performance.now();
    var result = commitRun();
    var beaten = !!(result && result.record);
    renderHud();
    panel.show({
      title: beaten ? 'Nouveau record !' : 'Plus de vies',
      subtitle: 'Tu as encaissé ' + run.banked +
                (run.banked > 1 ? ' pots.' : ' pot.') + ' Plus haut palier : ' + run.deepest + '.',
      cta: 'Nouvelle partie',
      quit: 'Retour au hall',
      scoreboard: {
        score: score,
        extraLabel: 'Pots encaissés',
        extra: run.banked,
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
    if (!run || runCommitted || run.climbs === 0) {
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
    var g = geometry();
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.8 + Math.random() * 2.2;
      particles.push({
        x: g.size / 2, y: g.doorY + g.doorH / 2,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.0022 + Math.random() * 0.002,
        size: 1.5 + Math.random() * 2.5, color: color
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
    el.style.top = '30%';
    effects.appendChild(el);
    setTimeout(function () { el.remove(); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Géométrie                                                           */
  /* ------------------------------------------------------------------ */

  function geometry() {
    var s = loop.size();
    var pad = s * 0.035;
    var doorY = s * 0.30;
    var doorH = s * 0.32;
    var gap = s * 0.018;
    var doorW = (s - pad * 2 - gap * (doors - 1)) / doors;
    var barH = s * 0.085;
    return { size: s, pad: pad, doorY: doorY, doorH: doorH, gap: gap, doorW: doorW,
             barY: s - pad - barH, barH: barH };
  }

  function doorBox(i) {
    var g = geometry();
    return { x: g.pad + i * (g.doorW + g.gap), y: g.doorY, w: g.doorW, h: g.doorH };
  }

  function buttons(g) {
    var w = Math.min(g.size * 0.34, 180);
    var gapB = g.size * 0.02;
    return [
      { id: 'bank',  label: 'Encaisser', x: g.size / 2 - w - gapB / 2, y: g.barY, w: w, h: g.barH },
      { id: 'probe', label: 'Sonde ' + probes, x: g.size / 2 + gapB / 2, y: g.barY, w: w, h: g.barH }
    ];
  }

  function locate(pos) {
    var g = geometry();
    var px = pos.x * g.size, py = pos.y * g.size;
    if (py >= g.barY) {
      var list = buttons(g);
      for (var b = 0; b < list.length; b++) {
        var btn = list[b];
        if (px >= btn.x && px <= btn.x + btn.w) { return { t: 'button', id: btn.id }; }
      }
      return null;
    }
    if (py >= g.doorY && py <= g.doorY + g.doorH) {
      for (var i = 0; i < doors; i++) {
        var box = doorBox(i);
        if (px >= box.x && px <= box.x + box.w) { return { t: 'door', i: i }; }
      }
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

  function doorColor(i) {
    var skin = progress.currentSkin();
    if (skin.rainbow) { return 'hsl(' + ((i * 53 + level * 17) % 360) + ', 78%, 62%)'; }
    return ramp().door;
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

  function money(v) { return String(Math.round(v)); }

  function draw(now, alpha, dt) {
    var g = geometry();
    updateParticles(dt);
    ctx.clearRect(0, 0, g.size, g.size);
    if (!doors) { return; }
    var o = odds();

    // Les paliers déjà franchis, en pastilles.
    ctx.save();
    var total = ladder().length;
    var dotR = Math.max(3, g.size * 0.010);
    var spread = Math.min(g.size * 0.7, total * dotR * 3.2);
    var x0 = g.size / 2 - spread / 2 + (spread / total) / 2;
    for (var d = 0; d < total; d++) {
      ctx.globalAlpha = d < level - 1 ? 0.95 : 0.25;
      ctx.fillStyle = d < level - 1 ? ramp().safe : ramp().dim;
      ctx.beginPath();
      ctx.arc(x0 + d * (spread / total), g.size * 0.075, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Le pot en cours, en grand : c'est lui l'enjeu.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(139, 154, 192, 0.9)';
    ctx.font = '600 ' + Math.round(g.size * 0.032) + 'px system-ui, sans-serif';
    ctx.fillText(atSummit() ? 'Tour terminée' : 'Palier ' + level + ' · pot en jeu',
                 g.size / 2, g.size * 0.135);
    ctx.fillStyle = pot > 0 ? ramp().pot : 'rgba(139, 154, 192, 0.5)';
    ctx.font = '700 ' + Math.round(g.size * 0.085) + 'px system-ui, sans-serif';
    ctx.fillText(money(pot), g.size / 2, g.size * 0.205);
    ctx.restore();

    // Les portes.
    for (var i = 0; i < doors; i++) {
      var box = doorBox(i);
      var seen = revealed[i];
      var shown = state === 'falling' && openedDoor >= 0;
      var isTrap = i === trap;
      var color = doorColor(i);

      ctx.save();
      if (shown && isTrap) { color = ramp().trap; }
      else if (seen === true) { color = ramp().trap; }
      else if (seen === false) { color = ramp().safe; }

      var lit = seen !== undefined || (shown && isTrap) || pending === i;
      ctx.globalAlpha = lit ? 1 : 0.34;
      if (lit) { ctx.shadowColor = color; ctx.shadowBlur = 20; }
      ctx.fillStyle = color;
      roundRect(box.x, box.y, box.w, box.h, box.w * 0.16);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pending === i ? ramp().pot : ramp().edge;
      ctx.lineWidth = pending === i ? 3 : 1;
      ctx.stroke();

      ctx.fillStyle = lit ? 'rgba(6, 18, 26, 0.85)' : '#e8eefc';
      ctx.font = '700 ' + Math.round(box.w * 0.34) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var mark = seen === true ? '✕' : (seen === false ? '✓' : String(i + 1));
      if (shown && isTrap) { mark = '✕'; }
      ctx.fillText(mark, box.x + box.w / 2, box.y + box.h * 0.54);
      ctx.restore();
    }

    // Ce que coûte et ce que rapporte le prochain palier, en toutes lettres.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lineY = g.doorY + g.doorH + g.size * 0.055;
    if (o) {
      ctx.fillStyle = '#e8eefc';
      ctx.font = '600 ' + Math.round(g.size * 0.038) + 'px system-ui, sans-serif';
      ctx.fillText('Monter : ' + Math.round(o.chance * 100) + ' % · le pot passerait à ' +
                   money(o.nextPot), g.size / 2, lineY);
      if (progress.getSetting('odds')) {
        ctx.font = '600 ' + Math.round(g.size * 0.030) + 'px system-ui, sans-serif';
        ctx.fillStyle = o.worth ? ramp().safe : ramp().trap;
        var verdict = pot > 0
          ? 'en moyenne ' + money(o.expected) + ' contre ' + money(pot) + ' déjà acquis'
          : 'en moyenne ' + money(o.expected) + ' — rien à perdre encore';
        ctx.fillText(verdict, g.size / 2, lineY + g.size * 0.048);
      }
    }
    ctx.restore();

    // Bandeau : encaisser, sonder, et les vies.
    ctx.save();
    buttons(g).forEach(function (btn) {
      var on = btn.id === 'bank' ? pot > 0 : probes > 0;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.fillStyle = btn.id === 'bank' && on ? ramp().safe : 'rgba(120, 150, 200, 0.16)';
      roundRect(btn.x, btn.y, btn.w, btn.h, btn.h * 0.32);
      ctx.fill();
      if (!(btn.id === 'bank' && on)) {
        ctx.strokeStyle = ramp().edge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = btn.id === 'bank' && on ? '#06121a' : '#e8eefc';
      ctx.font = '600 ' + Math.max(12, Math.round(btn.h * 0.34)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h * 0.54);
      ctx.globalAlpha = 1;
    });
    if (!conf().forgiving) {
      ctx.textAlign = 'right';
      ctx.fillStyle = lives <= 1 ? ramp().trap : 'rgba(139, 154, 192, 0.9)';
      ctx.font = '600 ' + Math.round(g.size * 0.030) + 'px system-ui, sans-serif';
      ctx.fillText('♥ '.repeat(Math.max(0, lives)).trim() || '—',
                   g.size - g.pad, g.barY - g.size * 0.028);
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
      side: level,
      sideVisible: state !== 'menu',
      bestLabel: progress.ranked(difficulty) ? 'Record' : 'Pots',
      best: progress.ranked(difficulty) ? Math.max(best(), score) : (run ? run.banked : 0)
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
      panel.show({ title: 'Pause', subtitle: 'Le pot t\'attend.', cta: 'Reprendre',
                   hideDifficulty: true, quit: 'Enregistrer et quitter' });
    } else if (state === 'paused') {
      state = 'playing';
      loop.resetClock();
      panel.hide();
    }
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
    onOpen: function () { if (state === 'playing') { togglePause(); } },
    onSkinChange: function () { /* la palette est relue à chaque image */ },
    onSettingChange: function (name) {
      if (name === 'theme') { Core.applyTheme(progress); }
      if (name === 'sound' && toolbar) { toolbar.syncSound(); }
    }
  });

  loop = Core.createLoop({
    canvas: canvas,
    running: function () { return false; },   // rien ne bouge sans le joueur
    render: draw
  });
  ctx = loop.ctx;

  var doorKeys = {};
  for (var k = 1; k <= 6; k++) {
    doorKeys[String(k)] = (function (i) {
      return function () { if (!guardedStart()) { open(i); } };
    }(k - 1));
  }
  doorKeys.e = function () { if (!guardedStart()) { bank(); } };
  doorKeys.p = function () { if (!guardedStart()) { probe(); } };

  Core.attachInput({
    canvas: canvas,
    swipe: false,
    blocked: function () { return sheets.isOpen(); },
    onInteract: function () { audio.unlock(); },
    onTap: function (pos) {
      if (guardedStart()) { return; }
      var spot = locate(pos);
      if (!spot) { return; }
      if (spot.t === 'door') { open(spot.i); }
      else if (spot.id === 'bank') { bank(); }
      else { probe(); }
    },
    onAction: function () { if (!guardedStart()) { togglePause(); } },
    onEscape: function () { if (state === 'playing') { togglePause(); } },
    keys: doorKeys
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

  window.__neonTower = {
    snapshot: function () {
      var o = odds();
      return {
        state: state,
        difficulty: difficulty,
        level: level,
        doors: doors,
        pot: pot,
        score: score,
        lives: lives,
        probes: probes,
        revealed: JSON.parse(JSON.stringify(revealed)),
        tipping: tipping(),
        chance: o ? o.chance : null,
        nextPot: o ? o.nextPot : null,
        expected: o ? o.expected : null,
        worth: o ? o.worth : null,
        banked: run ? run.banked : 0,
        climbs: run ? run.climbs : 0,
        traps: run ? run.traps : 0,
        deepest: run ? run.deepest : 0,
        skin: progress.currentSkin().id,
        totals: progress.totals(),
        unlocked: Object.keys(progress.unlocked())
      };
    },
    ladder: function () { return ladder().map(function (s) { return { doors: s.doors, pot: s.pot }; }); },
    // La porte piégée, telle qu'elle est déjà fixée. Réservée aux tests : c'est
    // ce qui permet de vérifier que le jeu ne la décide pas après le choix.
    peek: function () { return trap; },
    // Refait le tirage du palier courant, par le même chemin que le jeu.
    reseat: function () { deal(); return trap; },
    open: function (i) { return open(i); },
    bank: bank,
    probe: probe,
    /* Place la manche à un palier donné. Coupe court au temps d'arrêt qui
       suit un piège, pour qu'un test puisse enchaîner sans l'attendre : la
       minuterie de la chute vérifie l'état avant d'agir et se retire d'elle-
       même. */
    setLevel: function (k) {
      if (state === 'falling') { state = 'playing'; }
      if (state !== 'playing') { return false; }
      level = clamp(k, 1, ladder().length);
      pot = level > 1 ? ladder()[level - 2].pot : 0;
      deal();
      renderHud();
      return true;
    },
    doorBox: doorBox,
    geometry: geometry,
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
