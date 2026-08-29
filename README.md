# Neon Snake 🐍

Un jeu d'arcade Snake modernisé, en **HTML / CSS / JavaScript pur** : aucune dépendance,
aucun build, aucun serveur. Ouvre `index.html` et joue.

![Neon Snake](https://img.shields.io/badge/d%C3%A9pendances-0-38f9c3) ![Vanilla JS](https://img.shields.io/badge/vanilla-JS-ffd166)

## Jouer

- **En local** : ouvre `index.html` dans un navigateur, ou lance un petit serveur
  (`npx http-server -p 8080` puis <http://localhost:8080>).
- **En ligne** : active GitHub Pages sur la branche du dépôt (Settings → Pages →
  *Deploy from a branch*), le jeu est servi tel quel.

## Contrôles

| Action | Clavier | Tactile |
|---|---|---|
| Se déplacer | Flèches, `WASD` ou `ZQSD` | Balayage sur le plateau, ou croix directionnelle |
| Pause | `Espace` / `Échap` | Bouton ❚❚ |
| Démarrer / rejouer | `Espace` ou `Entrée` | Bouton *Jouer* |
| Couper le son | — | Bouton ♪ |

## Règles et bonus

| Élément | Effet |
|---|---|
| 🔴 **Pomme** | +10 points, le serpent grandit d'une case |
| ⭐ **Or** | +50 points, grandit de deux cases — mais disparaît au bout de 9 s |
| ❄ **Ralenti** | Ralentit le jeu pendant 7 s (jauge bleue en bas du plateau) |
| ◇ **Fantôme** | Traverse les murs, les obstacles et son propre corps pendant 6 s |

**Combos** : enchaîne deux prises à moins de 2,6 s d'intervalle et le multiplicateur
monte, jusqu'à ×5. Il retombe à ×1 dès que tu traînes.

**Vitesse** : le serpent accélère à mesure qu'il grandit, jusqu'à un plafond propre à
chaque difficulté.

## Difficultés

| Mode | Murs | Obstacles | Rythme |
|---|---|---|---|
| Facile | traversés (le serpent réapparaît en face) | aucun | 150 → 90 ms par case |
| Normal | mortels | aucun | 125 → 68 ms |
| Difficile | mortels | 7 blocs générés aléatoirement | 100 → 52 ms |

Le meilleur score est conservé **par difficulté** dans le `localStorage`, comme le
choix de difficulté et l'état du son.

## Structure

```
index.html      # structure de la page (HUD, plateau, panneau, croix directionnelle)
src/style.css   # thème néon, mise en page responsive, animations
src/game.js     # moteur : boucle, collisions, bonus, rendu canvas, sons WebAudio
```

Points techniques notables :

- **Boucle à pas fixe, rendu interpolé** : la logique avance par ticks réguliers, le
  rendu interpole entre deux ticks pour rester fluide à 60 fps quel que soit l'écran.
- **File d'entrées** : jusqu'à deux directions sont mises en attente, pour que les
  virages serrés ne soient jamais avalés ; les demi-tours sont filtrés.
- **Sons générés à la volée** en WebAudio (oscillateurs) — aucun fichier audio.
- **Canvas adapté au `devicePixelRatio`**, redimensionné avec la fenêtre.
- `window.__neonSnake.snapshot()` expose un instantané en lecture seule de la partie
  (état, score, position de la tête, bonus) : c'est le point d'entrée des tests
  automatisés dans un navigateur.

## Idées d'évolution

- Tableau des scores en ligne, ou partage du score en image.
- Nouveaux bonus : aimant à pommes, points doubles temporaires, rétrécissement.
- Mode « niveaux » avec labyrinthes dessinés à la main.
- Mode deux joueurs sur le même clavier.
