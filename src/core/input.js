/* Socle — entrées : clavier, balayage tactile et croix directionnelle,
   ramenés à deux évènements simples : une direction ou une action. */
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

  document.addEventListener('keydown', function (e) {
    if (blocked()) { return; }
    var move = KEYS[e.key] || KEYS[String(e.key).toLowerCase()];
    if (move) {
      e.preventDefault();
      onInteract();
      onDirection(move[0], move[1]);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onInteract();
      onAction();
    }
    if (e.key === 'Escape') { onEscape(); }
  });

  if (options.canvas) {
    var touchStart = null;
    options.canvas.addEventListener('pointerdown', function (e) {
      touchStart = { x: e.clientX, y: e.clientY };
      onInteract();
    });
    options.canvas.addEventListener('pointerup', function (e) {
      if (!touchStart) { return; }
      var dx = e.clientX - touchStart.x;
      var dy = e.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) { return; }
      if (Math.abs(dx) > Math.abs(dy)) { onDirection(dx > 0 ? 1 : -1, 0); }
      else { onDirection(0, dy > 0 ? 1 : -1); }
    });
  }

  if (options.dpad) {
    options.dpad.addEventListener('click', function (e) {
      var btn = e.target.closest('.pad');
      if (!btn) { return; }
      onInteract();
      var move = DIR_BY_NAME[btn.dataset.dir];
      if (move) { onDirection(move[0], move[1]); }
    });
  }
};
