#!/usr/bin/env node
/* Lance les suites de test dans un navigateur, sur un serveur statique local.
   Usage :  node tests/run.js            toutes les suites
            node tests/run.js snake four  seulement celles dont le nom correspond */
'use strict';

var fs = require('fs');
var path = require('path');
var harness = require('./lib/harness');

var SUITES = path.join(__dirname, 'suites');

async function main() {
  var filters = process.argv.slice(2);
  var files = fs.readdirSync(SUITES).filter(function (f) { return f.endsWith('.js'); }).sort();
  if (filters.length) {
    files = files.filter(function (f) {
      return filters.some(function (needle) { return f.indexOf(needle) !== -1; });
    });
  }
  if (!files.length) { console.error('Aucune suite ne correspond.'); process.exit(2); }

  var server = await harness.startServer(0);
  console.log('Serveur de test : ' + server.origin);

  var results = [];
  var started = Date.now();

  for (var i = 0; i < files.length; i++) {
    var suite = require(path.join(SUITES, files[i]));
    process.stdout.write('\n[' + suite.name + ']');
    var t0 = Date.now();
    var fails = 0;
    try {
      fails = await suite.run(server);
    } catch (e) {
      console.log('\n    ÉCHEC suite interrompue → ' + e.message);
      fails = fails || 1;
    }
    results.push({ name: suite.name, fails: fails, ms: Date.now() - t0 });
  }

  await server.close();

  console.log('\n\n──────── Résumé ────────');
  var total = 0;
  results.forEach(function (r) {
    total += r.fails;
    console.log((r.fails ? '  ÉCHEC ' : '  OK    ') + r.name +
                '  (' + Math.round(r.ms / 100) / 10 + ' s' + (r.fails ? ', ' + r.fails + ' échec(s)' : '') + ')');
  });
  console.log('  ' + results.length + ' suites en ' + Math.round((Date.now() - started) / 1000) + ' s — ' +
              (total ? total + ' vérification(s) en échec' : 'tout passe'));
  process.exit(total ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(2);
});
