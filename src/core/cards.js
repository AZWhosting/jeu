/* Socle — le paquet de cartes et son rendu, partagés par les réussites.
   Trois jeux dessinent maintenant les mêmes cartes : autant qu'elles viennent
   d'un seul endroit, et qu'elles se ressemblent d'un jeu à l'autre.

   Une carte est un entier : rang × 4 + enseigne. Rang 0 = as, 12 = roi.
   Enseignes 0 pique, 1 cœur, 2 carreau, 3 trèfle — donc rouge pour 1 et 2.
   Avec deux paquets, les cartes gardent la même valeur : c'est au jeu de les
   distinguer s'il en a besoin, pas au socle. */
window.Core = window.Core || {};

Core.Cards = (function () {
  'use strict';

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  var SUITS = ['♠', '♥', '♦', '♣'];

  function rank(c) { return c >> 2; }
  function suit(c) { return c & 3; }
  function isRed(c) { var s = c & 3; return s === 1 || s === 2; }
  function label(c) { return RANKS[rank(c)]; }
  function glyph(c) { return SUITS[suit(c)]; }

  /* Générateur reproductible : une donne se rejoue à partir de son numéro. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Un paquet de 52 cartes, ou plusieurs empilés. `suits` restreint les
     enseignes utilisées — l'araignée s'en sert pour ses parties à une ou deux
     enseignes, en complétant toujours à 104 cartes. */
  function deck(copies, suits) {
    var used = suits || 4;
    var out = [];
    for (var n = 0; n < (copies || 1); n++) {
      for (var r = 0; r < 13; r++) {
        for (var s = 0; s < 4; s++) { out.push(r * 4 + (used === 4 ? s : (s % used))); }
      }
    }
    return out;
  }

  function shuffle(list, rnd) {
    var draw = rnd || Math.random;
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(draw() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  /* Une suite descendante alterne-t-elle bien les couleurs ? (Klondike, FreeCell) */
  function alternating(cards) {
    for (var i = 1; i < cards.length; i++) {
      if (rank(cards[i - 1]) !== rank(cards[i]) + 1) { return false; }
      if (isRed(cards[i - 1]) === isRed(cards[i])) { return false; }
    }
    return true;
  }

  /* Une suite descendante de la même enseigne ? (araignée) */
  function sameSuitRun(cards) {
    for (var i = 1; i < cards.length; i++) {
      if (rank(cards[i - 1]) !== rank(cards[i]) + 1) { return false; }
      if (suit(cards[i - 1]) !== suit(cards[i])) { return false; }
    }
    return true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /* Dessine une carte. `opts` :
       ramp   palette du skin (face, edge, red, black, back…)
       band   hauteur réellement visible : sous une carte couverte, seul
              l'index compte, et le gros symbole ne se dessine pas
       lit    couleur de halo, si la carte est mise en avant
       down   carte face cachée : on montre son dos
       ink    encre imposée, pour les palettes arc-en-ciel */
  function draw(ctx, x, y, w, h, card, opts) {
    var o = opts || {};
    var ramp = o.ramp || {};
    var band = o.band === undefined ? h : o.band;

    ctx.save();
    if (o.lit) { ctx.shadowColor = o.lit; ctx.shadowBlur = 16; }

    if (o.down) {
      ctx.fillStyle = ramp.back || 'rgba(70, 100, 160, 0.55)';
      roundRect(ctx, x, y, w, h, w * 0.14);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = o.lit || ramp.edge || 'rgba(120, 150, 200, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Un damier discret, pour que le dos ne soit pas un simple aplat.
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = ramp.face || '#101a2c';
      var step = Math.max(4, w * 0.16);
      for (var gy = y + step * 0.6; gy < y + h - step * 0.3; gy += step) {
        for (var gx = x + step * 0.6; gx < x + w - step * 0.3; gx += step) {
          ctx.beginPath();
          ctx.arc(gx, gy, Math.max(1, step * 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.restore();
      return;
    }

    ctx.fillStyle = ramp.face || '#101a2c';
    roundRect(ctx, x, y, w, h, w * 0.14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = o.lit || ramp.edge || 'rgba(120, 150, 200, 0.35)';
    ctx.lineWidth = o.lit ? 2 : 1;
    ctx.stroke();

    var ink = o.ink || (isRed(card) ? (ramp.red || '#ff5d8f') : (ramp.black || '#55b6ff'));
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 ' + Math.round(w * 0.33) + 'px system-ui, sans-serif';
    ctx.fillText(RANKS[rank(card)], x + w * 0.11, y + h * 0.055);
    ctx.font = Math.round(w * 0.30) + 'px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(SUITS[suit(card)], x + w * 0.90, y + h * 0.055);

    if (band >= h * 0.75) {
      ctx.font = Math.round(w * 0.46) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillText(SUITS[suit(card)], x + w / 2, y + h * 0.62);
    }
    ctx.restore();
  }

  /* Un emplacement vide : la place d'une carte, sans la carte. */
  function slot(ctx, x, y, w, h, opts) {
    var o = opts || {};
    var ramp = o.ramp || {};
    ctx.save();
    ctx.fillStyle = ramp.slot || 'rgba(120, 150, 200, 0.12)';
    roundRect(ctx, x, y, w, h, w * 0.14);
    ctx.fill();
    ctx.strokeStyle = o.lit || ramp.edge || 'rgba(120, 150, 200, 0.35)';
    ctx.lineWidth = o.lit ? 2.5 : 1;
    if (o.lit) { ctx.shadowColor = o.lit; ctx.shadowBlur = 12; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (o.glyph) {
      ctx.fillStyle = ramp.edge || 'rgba(120, 150, 200, 0.35)';
      ctx.font = Math.round(w * 0.52) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.glyph, x + w / 2, y + h / 2);
    }
    ctx.restore();
  }

  return {
    RANKS: RANKS, SUITS: SUITS,
    rank: rank, suit: suit, isRed: isRed, label: label, glyph: glyph,
    mulberry32: mulberry32, deck: deck, shuffle: shuffle,
    alternating: alternating, sameSuitRun: sameSuitRun,
    draw: draw, slot: slot, roundRect: roundRect
  };
}());
