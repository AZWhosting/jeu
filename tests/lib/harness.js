/* Petit harnais de test : serveur statique, navigateur, et compteur de
   vérifications. Aucune dépendance en dehors de Playwright. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var SHOTS = path.join(__dirname, '..', 'screenshots');

/* Playwright peut être installé localement, à la racine, ou globalement :
   on essaie dans cet ordre plutôt que d'imposer un emplacement. */
function loadPlaywright() {
  var candidates = ['playwright', 'playwright-core',
                    '/opt/node22/lib/node_modules/playwright'];
  for (var i = 0; i < candidates.length; i++) {
    try { return require(candidates[i]); } catch (e) { /* on essaie le suivant */ }
  }
  console.error('\nPlaywright est introuvable. Installe-le avec :\n  npm install -D playwright\n' +
                '  npx playwright install chromium\n');
  process.exit(2);
}

var playwright = loadPlaywright();

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/* Serveur statique minimal : le jeu n'a besoin de rien d'autre. */
function startServer(port) {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var name = decodeURIComponent(req.url.split('?')[0]);
      if (name === '/') { name = '/index.html'; }
      var file = path.join(ROOT, path.normalize(name).replace(/^(\.\.[/\\])+/, ''));
      fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404); res.end('introuvable'); return; }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', function () {
      resolve({
        origin: 'http://127.0.0.1:' + server.address().port,
        close: function () { return new Promise(function (done) { server.close(done); }); }
      });
    });
  });
}

/* Compteur de vérifications d'une suite. */
function checker() {
  var fails = 0;
  return {
    get fails() { return fails; },
    section: function (title) { console.log('\n  ' + title); },
    check: function (label, ok, extra) {
      console.log((ok ? '    OK   ' : '    ÉCHEC') + ' ' + label +
                  (extra !== undefined ? ' → ' + extra : ''));
      if (!ok) { fails++; }
    },
    fail: function (label, extra) { this.check(label, false, extra); }
  };
}

function shotPath(name) {
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* déjà là */ }
  return path.join(SHOTS, name + '.png');
}

/* Ouvre un navigateur et renvoie de quoi écrire une suite sans répéter
   la plomberie : page prête, erreurs JS collectées, raccourcis d'URL. */
async function open(context) {
  var browser = await playwright.chromium.launch();
  var page = await browser.newPage({ viewport: { width: 520, height: 940 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error') { errors.push('console: ' + m.text()); } });
  return {
    browser: browser,
    page: page,
    errors: errors,
    playwright: playwright,
    url: function (id) { return context.origin + '/jeu.html?id=' + id; },
    hub: function () { return context.origin + '/index.html'; },
    fileUrl: function (id) { return 'file://' + path.join(ROOT, 'jeu.html') + '?id=' + id; },
    shot: shotPath,
    newPage: async function (options) {
      var p = await browser.newPage(options || { viewport: { width: 520, height: 940 } });
      p.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
      p.on('console', function (m) { if (m.type() === 'error') { errors.push('console: ' + m.text()); } });
      return p;
    }
  };
}

module.exports = {
  ROOT: ROOT,
  playwright: playwright,
  startServer: startServer,
  checker: checker,
  open: open,
  shotPath: shotPath
};
