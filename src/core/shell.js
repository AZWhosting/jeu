/* Socle — coquille de page commune aux jeux.
   Elle lit le jeu demandé dans l'URL (?id=…), charge ses fichiers dans l'ordre,
   et remplit les éléments de présentation décrits par son manifeste. */
window.Core = window.Core || {};

Core.Shell = (function () {
  'use strict';

  function entryFor(id) {
    var list = window.GameRegistry || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function requestedId() {
    var params = new URLSearchParams(location.search);
    var list = window.GameRegistry || [];
    return params.get('id') || (list[0] ? list[0].id : null);
  }

  function version() {
    // On reprend le ?v= de la page pour que les fichiers du jeu soient
    // versionnés comme le reste, et échappent au cache de la même façon.
    var tag = document.querySelector('script[src*="shell.js"]');
    var match = tag && tag.getAttribute('src').match(/\?v=([\w.]+)/);
    return match ? '?v=' + match[1] : '';
  }

  function loadStyles(entry, v) {
    (entry.styles || []).forEach(function (href) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href + v;
      document.head.appendChild(link);
    });
  }

  /* Les scripts sont injectés en série : async = false préserve leur ordre. */
  function loadScripts(entry, v) {
    (entry.meta || []).concat(entry.scripts || []).forEach(function (src) {
      var script = document.createElement('script');
      script.src = src + v;
      script.async = false;
      document.body.appendChild(script);
    });
  }

  /* Le titre du panneau accepte une partie mise en couleur : « Neon Snake »
     s'affiche avec « Snake » en accent. */
  function setTitle(node, name, accent) {
    node.textContent = '';
    if (!accent || name.indexOf(accent) === -1) { node.textContent = name; return; }
    var before = name.slice(0, name.indexOf(accent));
    var span = document.createElement('span');
    span.textContent = accent;
    if (before) { node.appendChild(document.createTextNode(before)); }
    node.appendChild(span);
    var after = name.slice(name.indexOf(accent) + accent.length);
    if (after) { node.appendChild(document.createTextNode(after)); }
  }

  /* « {Espace} » dans une aide devient une touche stylée, sans innerHTML. */
  function setHint(node, text) {
    node.textContent = '';
    if (!text) { return; }
    text.split(/(\{[^}]+\})/).forEach(function (part) {
      if (!part) { return; }
      if (part.charAt(0) === '{') {
        var kbd = document.createElement('kbd');
        kbd.textContent = part.slice(1, -1);
        node.appendChild(kbd);
      } else {
        node.appendChild(document.createTextNode(part));
      }
    });
  }

  function setLegend(items) {
    var box = document.getElementById('legend');
    if (!box) { return; }
    box.textContent = '';
    box.hidden = !items || !items.length;
    (items || []).forEach(function (item) {
      var span = document.createElement('span');
      var dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = item.color;
      dot.style.boxShadow = '0 0 8px ' + item.color;
      span.appendChild(dot);
      span.appendChild(document.createTextNode(item.label));
      box.appendChild(span);
    });
  }

  /* Appelé par chaque jeu au démarrage : la coquille prend la couleur du jeu. */
  function dress(manifest) {
    document.title = manifest.name + ' — ' + (manifest.tagline || 'jeu d\'arcade');
    setTitle(document.getElementById('title'), manifest.name, manifest.accent);
    document.getElementById('subtitle').textContent = manifest.tagline || '';
    setHint(document.getElementById('hint'), manifest.hint);
    setLegend(manifest.legend);
  }

  function boot() {
    var id = requestedId();
    var entry = entryFor(id);
    if (!entry) { location.replace('index.html'); return; }
    var v = version();
    loadStyles(entry, v);
    loadScripts(entry, v);
  }

  return { boot: boot, dress: dress, setLegend: setLegend, entryFor: entryFor, requestedId: requestedId };
}());
