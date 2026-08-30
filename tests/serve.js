#!/usr/bin/env node
/* Sert le jeu sur http://127.0.0.1:8123 — pratique pour jouer en local sans
   dépendance, et c'est le même serveur que celui des tests. */
'use strict';

var harness = require('./lib/harness');

harness.startServer(Number(process.env.PORT) || 8123).then(function (server) {
  console.log('Neon Arcade sur ' + server.origin + '  (Ctrl+C pour arrêter)');
});
