/* Socle — bruitages générés à la volée en WebAudio. Aucun fichier audio. */
window.Core = window.Core || {};

Core.createAudio = function (isEnabled) {
  'use strict';

  var ctx = null;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') { ctx.resume(); } return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) { ctx = new Ctx(); }
  }

  function blip(freq, duration, type, gain) {
    if (!isEnabled() || !ctx) { return; }
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var vol = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    vol.gain.setValueAtTime(gain || 0.06, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(vol).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock: unlock,
    blip: blip,
    pickup: function () { blip(520, 0.09, 'square'); },
    chain:  function (n) { blip(520 + n * 110, 0.1, 'triangle', 0.07); },
    bonus:  function () { blip(320, 0.07, 'sawtooth', 0.05); blip(660, 0.18, 'triangle', 0.05); },
    fail:   function () { blip(180, 0.35, 'sawtooth', 0.08); blip(90, 0.5, 'square', 0.06); },
    unlocked: function () {
      blip(660, 0.12, 'triangle', 0.06);
      setTimeout(function () { blip(880, 0.18, 'triangle', 0.06); }, 120);
    }
  };
};
