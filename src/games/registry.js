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
    id: '2048',
    meta: ['src/games/2048/manifest.js'],
    scripts: ['src/games/2048/game.js'],
    styles: ['src/games/2048/2048.css']
  }
];
