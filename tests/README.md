# Tests

Des tests de bout en bout, joués dans un vrai navigateur : ils lancent les jeux,
appuient sur les touches, cliquent, et vérifient ce que le joueur verrait.

```bash
npm install          # récupère Playwright
npx playwright install chromium
npm test             # les vingt-huit suites
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
`__neonBricks`, `__neon2048`, `__neonMines`, `__neonFour`, `__neonBlocks`,
`__neonCrates`, `__neonMeow`, `__neonCells`, `__neonMots`, `__neonEcho`, `__neonPixel`, `__neonTower`, `__neonKlondike`, `__neonSpider`, `__neonPyramid`, `__neonReversi`, `__neonGems` — qui donne un
instantané de la partie et, pour certains, de quoi poser une situation précise
(placer une grille, planter des mines, lancer la balle, distribuer une donne
connue). C'est ce qui permet de
tester des règles sans dépendre du hasard : le premier clic sûr du démineur est
vérifié sur cent parties, les alignements du puissance 4 sur des positions
construites à la main, et les douze tableaux du pousse-caisses sont passés à un
solveur qui prouve leur solubilité. Neon Meow va plus loin : la suite génère
quatre-vingt-dix grilles et vérifie que chacune n'a qu'une seule solution. Neon
Cells fait de même avec ses donnes : la suite en fait servir huit, à quatre, trois
et deux cellules libres, et les résout toutes depuis la position servie — elle
vérifie aussi que le solveur sait dire non, sur une position construite pour être
sans issue.

Neon Mots met sa règle centrale à nu : `__neonMots.mark(proposition, solution)` est la
fonction de marquage elle-même, et la suite la fait tourner sur **toutes les paires de
mots des trois listes**, soit plus de 359 000 marquages, pour vérifier qu'une lettre
répétée n'est jamais signalée plus de fois qu'elle n'apparaît.

Les jeux de cartes exposent en plus `allCards()` : toutes les cartes en jeu, où qu'elles
soient — colonnes, pioche, défausse, fondations, suites envolées, cartes retirées. Les
suites du Klondike, de l'araignée et de la pyramide jouent trois cents coups au hasard et
vérifient après chacun que le paquet est intact. C'est le défaut qui ne se voit pas à
l'œil dans un jeu de cartes : une carte dupliquée par un déplacement mal défait.

La pyramide va plus loin, parce que sa promesse est plus forte : le jeu ne sert que des
donnes prouvées gagnables. La suite embarque **son propre solveur**, écrit sans partager
une ligne avec le jeu, et le passe sur les **520 donnes de la table** à chaque exécution —
en vérifiant d'abord qu'il sait dire non sur une pyramide construite pour être sans issue,
puis en mesurant sur des donnes tirées au hasard l'effondrement qui justifie la table.

Neon Tower est le seul jeu où le hasard décide, et sa sonde sert à le mettre en doute :
`peek()` lit la porte piégée avant tout choix, `reseat()` refait le tirage par le même
chemin que le jeu. La suite s'en sert pour vérifier qu'ouvrir à côté du piège fait
toujours monter et qu'ouvrir le piège fait toujours tomber — sur soixante manches, un
jeu qui déciderait après coup se trahirait là — puis que six mille tirages ne favorisent
aucune porte.

Neon Pixel embarque dans sa suite un solveur qui ne sait faire qu'une chose : déduire
ligne par ligne, sans jamais supposer. Les vingt dessins du dépôt doivent tomber sous
cette seule technique — c'est la promesse du genre, et c'est ce qui garantit du même
coup que chacun n'a qu'une solution.

Un jeu qui vit dans le temps se teste sans l'attendre : `__neonEcho.skipDemo()` saute la
démonstration, et `arm(séquence)` place le jeu en phase de réponse sur une suite choisie.
La suite s'en sert pour éprouver **chaque position** de la séquence — rendre juste
jusqu'à la k-ième, se tromper là, et vérifier que la manche s'arrête, pour tout k.

Le glisser-déposer se teste avec de vrais gestes : la suite de Neon Cells lit la
géométrie du plateau (`__neonCells.geometry()`), en déduit les coordonnées d'une
carte, et conduit la souris de Playwright de la colonne de départ à celle
d'arrivée.

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

## Les deux adversaires, et les deux garanties

Neon Four et Neon Reversi opposent une IA, et sa force ne se lit pas dans le code. La
suite de l'othello embarque donc **son propre solveur de fin de partie**, écrit sans rien
partager avec le jeu : elle construit douze positions à moins de dix cases vides, calcule
le meilleur écart final atteignable, et vérifie que le coup choisi par le jeu l'atteint.
Puis elle lui fait jouer vingt parties entières contre un joueur au hasard.

Neon Gems repose sur deux garanties silencieuses — pas d'alignement tout fait sur un
plateau servi, et toujours au moins un échange possible. Elles sont vérifiées sur
quarante plateaux neufs, puis après chacun des quelque quatre mille coups de cent parties
jouées de bout en bout. Un plateau mort y est **fabriqué** plutôt que cherché : on part
d'un tirage quelconque et on repeint les cases fautives tant qu'il reste un alignement ou
un échange, jusqu'à ce que la grille n'offre plus rien — puis on vérifie que le jeu la
remélange sans faire payer un coup.
