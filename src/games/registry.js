/* Catalogue des jeux de la plateforme, dans l'ordre où le hall les présente —
   celui de leur arrivée. Un nouveau jeu se range donc à la fin, et pas avant le
   dernier inscrit : c'est ainsi que Neon 2048 avait dérivé jusqu'au bout de la
   liste, échoué seul sur sa rangée.
   `meta` décrit le jeu (manifeste et reprise de données) : le hall se contente
   de ces fichiers. `scripts` et `styles` le font tourner : seule la coquille
   de jeu les charge. */
window.GameRegistry = [
  {
    id: 'snake',
    meta: ['src/games/snake/manifest.js', 'src/games/snake/legacy.js'],
    scripts: ['src/games/snake/game.js'],
    styles: []
  },
  {
    id: 'bricks',
    meta: ['src/games/bricks/manifest.js'],
    scripts: ['src/games/bricks/game.js'],
    styles: ['src/games/bricks/bricks.css']
  },
  {
    id: '2048',
    meta: ['src/games/2048/manifest.js'],
    scripts: ['src/games/2048/game.js'],
    styles: ['src/games/2048/2048.css']
  },
  {
    id: 'mines',
    meta: ['src/games/mines/manifest.js'],
    scripts: ['src/games/mines/game.js'],
    styles: ['src/games/mines/mines.css']
  },
  {
    id: 'four',
    meta: ['src/games/four/manifest.js'],
    scripts: ['src/games/four/game.js'],
    styles: ['src/games/four/four.css']
  },
  {
    id: 'blocks',
    meta: ['src/games/blocks/manifest.js'],
    scripts: ['src/games/blocks/game.js'],
    styles: ['src/games/blocks/blocks.css']
  },
  {
    id: 'crates',
    meta: ['src/games/crates/manifest.js'],
    scripts: ['src/games/crates/game.js'],
    styles: ['src/games/crates/crates.css']
  },
  {
    id: 'meow',
    meta: ['src/games/meow/manifest.js'],
    scripts: ['src/games/meow/game.js'],
    styles: ['src/games/meow/meow.css']
  },
  {
    id: 'cells',
    meta: ['src/games/cells/manifest.js'],
    scripts: ['src/games/cells/game.js'],
    styles: ['src/games/cells/cells.css']
  },
  {
    id: 'mots',
    meta: ['src/games/mots/manifest.js'],
    scripts: ['src/games/mots/words.js', 'src/games/mots/game.js'],
    styles: ['src/games/mots/mots.css']
  },
  {
    id: 'echo',
    meta: ['src/games/echo/manifest.js'],
    scripts: ['src/games/echo/game.js'],
    styles: ['src/games/echo/echo.css']
  },
  {
    id: 'pixel',
    meta: ['src/games/pixel/manifest.js'],
    scripts: ['src/games/pixel/pictures.js', 'src/games/pixel/game.js'],
    styles: ['src/games/pixel/pixel.css']
  },
  {
    id: 'tower',
    meta: ['src/games/tower/manifest.js'],
    scripts: ['src/games/tower/game.js'],
    styles: ['src/games/tower/tower.css']
  },
  {
    id: 'klondike',
    meta: ['src/games/klondike/manifest.js'],
    scripts: ['src/games/klondike/game.js'],
    styles: ['src/games/klondike/klondike.css']
  },
  {
    id: 'spider',
    meta: ['src/games/spider/manifest.js'],
    scripts: ['src/games/spider/game.js'],
    styles: ['src/games/spider/spider.css']
  },
  {
    id: 'pyramid',
    meta: ['src/games/pyramid/manifest.js'],
    scripts: ['src/games/pyramid/deals.js', 'src/games/pyramid/game.js'],
    styles: ['src/games/pyramid/pyramid.css']
  }
];
