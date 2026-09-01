/* Catalogue des jeux de la plateforme.
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
    id: '2048',
    meta: ['src/games/2048/manifest.js'],
    scripts: ['src/games/2048/game.js'],
    styles: ['src/games/2048/2048.css']
  }
];
