# Tests

Des tests de bout en bout, joués dans un vrai navigateur : ils lancent les jeux,
appuient sur les touches, cliquent, et vérifient ce que le joueur verrait.

```bash
npm install          # récupère Playwright
npx playwright install chromium
npm test             # les seize suites
node tests/run.js snake four    # seulement celles dont le nom contient ça
```

Le lanceur démarre son propre serveur statique sur un port libre : rien d'autre à
installer, et rien à démarrer à côté.

## Organisation

```
tests/run.js          # lanceur : serveur, enchaînement des suites, résumé
tests/serve.js        # le même serveur, pour jouer en local (npm start)
tests/lib/harness.js  # serveur statique, navigateur, compteur de vérifications
tests/suites/*.js     # une suite par thème, exécutées dans l'ordre des noms
tests/screenshots/    # captures produites au passage (ignorées par git)
```

Chaque suite exporte `{ name, run(server) }` et renvoie son nombre d'échecs. Le
harnais fournit `h.page`, `h.url('snake')`, `h.hub()`, `h.fileUrl('snake')`,
`h.shot('nom')`, et collecte les erreurs JavaScript de la page.

## Ce sur quoi ils s'appuient

Chaque jeu expose une sonde en lecture seule — `window.__neonSnake`,
`__neonBricks`, `__neon2048`, `__neonMines`, `__neonFour`, `__neonBlocks` — qui donne un
instantané de la partie et, pour certains, de quoi poser une situation précise
(placer une grille, planter des mines, lancer la balle). C'est ce qui permet de
tester des règles sans dépendre du hasard : le premier clic sûr du démineur est
vérifié sur cent parties, les alignements du puissance 4 sur des positions
construites à la main.

## Écrire une suite

```js
'use strict';
var harness = require('../lib/harness');

module.exports = {
  name: 'Mon jeu — ce que je vérifie',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);

    await h.page.goto(h.url('monjeu'));
    check('le titre est posé', (await h.page.textContent('#title')) === 'Mon jeu');

    check('aucune erreur JS', h.errors.length === 0, h.errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
```
