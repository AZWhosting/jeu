/* Socle — boucle de jeu à pas fixe avec rendu interpolé, et canvas HiDPI.
   La logique avance par ticks réguliers ; le rendu, lui, tourne à la fréquence
   de l'écran et interpole entre deux ticks. */
window.Core = window.Core || {};

Core.createLoop = function (options) {
  'use strict';

  var canvas = options.canvas;
  var ctx = canvas.getContext('2d');
  var running = options.running || function () { return false; };
  var duration = options.duration || function () { return 100; };
  var tick = options.tick || function () {};
  var render = options.render || function () {};
  var MAX_FRAME = 64;          // ms : au-delà, on ne rattrape pas le retard
  var MAX_CATCHUP = 4;         // ticks rattrapés au maximum en une image

  var accumulator = 0;
  var lastFrame = 0;
  var alpha = 1;
  var size = 0;                // côté du canvas, en pixels CSS

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var side = Math.max(1, Math.round(rect.width));
    size = side;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    var dt = Math.min(MAX_FRAME, now - lastFrame);
    lastFrame = now;

    if (running()) {
      accumulator += dt;
      var d = duration(now);
      var guard = 0;
      while (accumulator >= d && running() && guard++ < MAX_CATCHUP) {
        accumulator -= d;
        tick(now);
        d = duration(now);
      }
      alpha = Math.max(0, Math.min(1, accumulator / d));
    } else {
      alpha = 1;
    }

    render(now, alpha, dt);
    requestAnimationFrame(frame);
  }

  function resetClock() {
    lastFrame = performance.now();
    accumulator = 0;
  }

  function start() {
    resize();
    resetClock();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);

  return {
    ctx: ctx,
    start: start,
    resize: resize,
    resetClock: resetClock,
    alpha: function () { return alpha; },
    size: function () { return size; }
  };
};
