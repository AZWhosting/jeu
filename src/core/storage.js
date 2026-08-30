/* Socle — stockage local cloisonné par jeu.
   Les clés suivent le schéma neon:<espace>:<nom>, où l'espace vaut « app »
   pour les réglages partagés et l'identifiant du jeu pour le reste. */
window.Core = window.Core || {};

Core.Storage = (function () {
  'use strict';

  var ROOT = 'neon:';

  function full(space, name) { return ROOT + space + ':' + name; }

  function read(space, name, fallback) {
    try {
      var raw = localStorage.getItem(full(space, name));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function write(space, name, value) {
    try { localStorage.setItem(full(space, name), JSON.stringify(value)); } catch (e) { /* navigation privée */ }
  }

  function remove(space, name) {
    try { localStorage.removeItem(full(space, name)); } catch (e) { /* ignore */ }
  }

  /* Toutes les clés d'un espace, sans le préfixe. */
  function names(space) {
    var prefix = ROOT + space + ':';
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) { out.push(k.slice(prefix.length)); }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function clear(space) {
    names(space).forEach(function (name) { remove(space, name); });
  }

  return { read: read, write: write, remove: remove, names: names, clear: clear, ROOT: ROOT };
}());
