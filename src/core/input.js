/* Socle — entrées : clavier, pointeur, balayage tactile et croix directionnelle.
   Deux usages coexistent : les coups discrets (une direction, une action) et le
   maintien continu, dont un jeu de raquette a besoin. */
window.Core = window.Core || {};

Core.attachInput = function (options) {
  'use strict';

  var KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    z: [0, -1], q: [-1, 0]
  };
  var DIR_BY_NAME = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var SWIPE_MIN = 22;          // px en deçà desquels on ignore le geste

  var blocked = options.blocked || function () { return false; };
  var onDirection = options.onDirection || function () {};
  var onAction = options.onAction || function () {};
  var onEscape = options.onEscape || function () {};
  var onInteract = options.onInteract || function () {};
  var onPointer = options.onPointer || null;
  var onTap = options.onTap || null;             // clic ou tape brève sur le plateau
  var onSecondary = options.onSecondary || null; // clic droit ou appui long
  var extraKeys = options.keys || {};            // touches propres au jeu
  var swipeEnabled = options.swipe !== false;
  var LONG_PRESS_MS = 420;
  var TAP_SLOP = 10;                             // px : au-delà, ce n'est plus une tape

  // Touches et pavé maintenus : le jeu lit cet axe à chaque tick.
  var held = {};
  var padHeld = null;

  function axis() {
    if (padHeld) { return { x: padHeld[0], y: padHeld[1] }; }
    var x = 0, y = 0;
    Object.keys(held).forEach(function (k) {
      if (!held[k]) { return; }
      var move = KEYS[k];
      if (move) { x += move[0]; y += move[1]; }
    });
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  document.addEventListener('keydown', function (e) {
    if (blocked()) { return; }
    var name = KEYS[e.key] ? e.key : String(e.key).toLowerCase();
    var move = KEYS[name];
    if (move) {
      e.preventDefault();
      held[name] = true;
      onInteract();
      onDirection(move[0], move[1]);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onInteract();
      onAction();
    }
    if (e.key === 'Escape') { onEscape(); return; }
    var extra = extraKeys[String(e.key).toLowerCase()];
    if (extra) { e.preventDefault(); onInteract(); extra(); }
  });

  document.addEventListener('keyup', function (e) {
    var name = KEYS[e.key] ? e.key : String(e.key).toLowerCase();
    if (KEYS[name]) { held[name] = false; }
  });

  // Une touche relâchée hors de la page ne doit pas rester coincée.
  window.addEventListener('blur', function () { held = {}; padHeld = null; });

  if (options.canvas) {
    var canvas = options.canvas;
    var touchStart = null;

    function ratio(e) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / Math.max(1, rect.width),
        y: (e.clientY - rect.top) / Math.max(1, rect.height)
      };
    }

    var longPressTimer = null;
    var longPressed = false;

    function cancelLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    canvas.addEventListener('pointerdown', function (e) {
      touchStart = { x: e.clientX, y: e.clientY };
      longPressed = false;
      onInteract();
      if (onPointer && !blocked()) { onPointer(ratio(e), true); }
      if (onSecondary) {
        // Appui long : l'équivalent tactile du clic droit.
        var pos = ratio(e);
        cancelLongPress();
        longPressTimer = setTimeout(function () {
          longPressTimer = null;
          longPressed = true;
          if (!blocked()) { onSecondary(pos); }
        }, LONG_PRESS_MS);
      }
    });

    if (onSecondary) {
      canvas.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (!blocked()) { onSecondary(ratio(e)); }
      });
    }

    if (onPointer) {
      canvas.addEventListener('pointermove', function (e) {
        if (blocked()) { return; }
        // Sur écran tactile, seuls les mouvements doigt posé comptent.
        if (e.pointerType !== 'mouse' && !touchStart) { return; }
        onPointer(ratio(e), !!touchStart);
      });
    }

    ['pointermove', 'pointercancel', 'pointerleave'].forEach(function (type) {
      canvas.addEventListener(type, function (e) {
        if (!touchStart || !longPressTimer) { return; }
        if (type !== 'pointermove' ||
            Math.abs(e.clientX - touchStart.x) > TAP_SLOP ||
            Math.abs(e.clientY - touchStart.y) > TAP_SLOP) { cancelLongPress(); }
      });
    });

    canvas.addEventListener('pointerup', function (e) {
      if (!touchStart) { return; }
      var dx = e.clientX - touchStart.x;
      var dy = e.clientY - touchStart.y;
      touchStart = null;
      cancelLongPress();

      if (onTap && !longPressed && Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
        if (!blocked()) { onTap(ratio(e)); }
      }
      longPressed = false;

      if (!swipeEnabled) { return; }
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) { return; }
      if (Math.abs(dx) > Math.abs(dy)) { onDirection(dx > 0 ? 1 : -1, 0); }
      else { onDirection(0, dy > 0 ? 1 : -1); }
    });
  }

  if (options.dpad) {
    var dpad = options.dpad;

    dpad.addEventListener('click', function (e) {
      var btn = e.target.closest('.pad');
      if (!btn) { return; }
      onInteract();
      var move = DIR_BY_NAME[btn.dataset.dir];
      if (move) { onDirection(move[0], move[1]); }
    });

    // Maintien sur le pavé : utile pour une raquette, inoffensif ailleurs.
    dpad.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.pad');
      if (btn) { padHeld = DIR_BY_NAME[btn.dataset.dir] || null; }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      dpad.addEventListener(type, function () { padHeld = null; });
    });
  }

  return { axis: axis };
};
