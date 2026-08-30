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
monte, jusqu'à ×5. Il retombe à ×1 dès que tu traînes. **En mode zen, le
chronomètre ne s'applique pas** : le combo est un simple compteur qui monte d'un
cran à chaque ramassage et atteint ×5 à la cinquième pomme, quel que soit le temps
écoulé, et il ne redescend jamais. Le compteur y est affiché dès ×1, pour qu'on voie
la progression (ailleurs il n'apparaît qu'à partir de ×2).

**Vitesse** : le serpent accélère à mesure qu'il grandit, jusqu'à un plafond propre à
chaque difficulté.

## Difficultés

| Mode | Murs | Obstacles | Rythme |
|---|---|---|---|
| Facile | traversés (le serpent réapparaît en face) | aucun | 150 → 90 ms par case |
| Normal | mortels | aucun | 125 → 68 ms |
| Difficile | mortels | blocs générés aléatoirement | 100 → 52 ms |
| **Zen** | traversés | aucun | 165 → 135 ms |

*(le mode zen ignore aussi le chronomètre des combos — voir plus haut)*

En **mode zen**, rien ne tue : ni les murs, ni les obstacles, ni son propre corps.
La partie ne s'arrête jamais d'elle-même — le HUD remplace le record par la longueur
atteinte. Les parties zen alimentent les statistiques et les succès, mais restent
hors des records et de la courbe de progression : sans risque, un score n'y veut rien
dire.

Le meilleur score est conservé **par difficulté** dans le `localStorage`, comme les
réglages, les succès et les statistiques.

## Succès et skins

Douze succès à débloquer, du « Premier repas » au « Millénaire » (1 000 points en une
partie), en passant par « Puriste » (300 points sans ramasser un seul bonus) et
« Sérénité » (40 segments en mode zen). Six d'entre eux ouvrent un **skin** de
serpent : Rétro, Glace, Orchidée, Braise, Or, et Arc-en-ciel dont la teinte défile le
long du corps. Chaque déblocage s'annonce par une notification pendant la partie.

## Réglages

| Réglage | Options |
|---|---|
| Taille de la grille | 15 × 15, 21 × 21 ou 27 × 27 cases |
| Vitesse | progressive (le serpent accélère) ou constante |
| Thème | Néon, Rétro (vert) ou Crépuscule (violet) |
| Son, effets visuels, quadrillage | activables séparément |

Couper les effets visuels désactive particules, secousses et textes flottants — utile
sur une machine modeste ou si le mouvement gêne. Un bouton permet d'effacer toutes
les données locales, en deux temps pour éviter la fausse manœuvre.

## Statistiques

Le panneau *Stats* récapitule les parties jouées, les pommes mangées, les bonus
ramassés, la longueur maximale, le meilleur combo, le temps de jeu et les points
cumulés, avec les records par difficulté et un graphique des vingt dernières parties
(barre la plus haute étiquetée, ligne pointillée de la moyenne, détail au survol).

## Structure

Le code est séparé en deux : un **socle réutilisable**, qui ne connaît aucun jeu en
particulier, et le **jeu**, qui se décrit dans un manifeste.

```
index.html                    # la page : HUD, plateau, panneaux, croix directionnelle
src/core/
  storage.js                  # stockage local cloisonné : neon:<espace>:<clé>
  progress.js                 # réglages, statistiques, succès et skins, pilotés par le manifeste
  sheets.js                   # panneaux succès / skins / stats / réglages, et notifications
  loop.js                     # boucle à pas fixe, rendu interpolé, canvas HiDPI
  input.js                    # clavier, balayage tactile, croix directionnelle
  audio.js                    # bruitages WebAudio
  ui.css                      # thèmes et coquille visuelle partagée
src/games/snake/
  manifest.js                 # difficultés, réglages, succès, skins, vocabulaire des stats
  game.js                     # le jeu : règles, collisions, rendu du serpent
  snake.css                   # le peu de style qui lui est propre
  legacy.js                   # reprise des données enregistrées avant ce découpage
```

**Le manifeste est le contrat.** Un jeu y déclare ses difficultés, ses réglages, ses
succès (chacun un simple prédicat sur la partie), ses skins et les tuiles de
statistiques avec leur vocabulaire. En échange, il reçoit gratuitement le panneau
complet, les thèmes, la persistance, les notifications de déblocage et la courbe de
progression. Ajouter un deuxième jeu ne demande donc qu'un manifeste et un moteur.

**Cloisonnement des données** : `neon:app:settings` porte les réglages partagés entre
tous les jeux (thème, son, effets) ; `neon:<jeu>:*` porte le reste (réglages propres,
totaux, succès, records). Les données de l'ancien schéma `neon-snake:*` sont reprises
automatiquement au premier chargement, puis effacées.

Les fichiers de `src/` sont appelés avec un suffixe `?v=N` dans `index.html` :
**incrémente ce numéro dès que tu modifies un fichier de `src/`**, sinon les
navigateurs (et le CDN de GitHub Pages) continuent de servir l'ancienne version
depuis leur cache — le HTML est à jour mais le CSS et le JavaScript ne le sont pas,
et la page se retrouve à moitié cassée.

Points techniques notables :

- **Boucle à pas fixe, rendu interpolé** (`core/loop.js`) : la logique avance par
  ticks réguliers, le rendu interpole entre deux ticks pour rester fluide à 60 fps
  quel que soit l'écran. La durée d'un tick est fournie par le jeu, donc variable.
- **File d'entrées** : jusqu'à deux directions sont mises en attente, pour que les
  virages serrés ne soient jamais avalés ; les demi-tours sont filtrés.
- **Sons générés à la volée** en WebAudio (oscillateurs) — aucun fichier audio.
- **Canvas adapté au `devicePixelRatio`**, redimensionné avec la fenêtre.
- **Garde-fou de chargement** : le jeu vérifie que chaque fichier du socle a bien
  défini ce qu'il devait, et affiche lequel manque plutôt que d'échouer en silence.
- `window.__neonSnake.snapshot()` expose un instantané en lecture seule de la partie
  (état, score, position de la tête, bonus, totaux) : c'est le point d'entrée des
  tests automatisés dans un navigateur.

## Idées d'évolution

- Un deuxième jeu (2048 ferait un bon banc d'essai du manifeste), puis un hall
  listant les jeux et un profil commun.
- Défi quotidien : une graine déterministe pour que tout le monde joue la même
  partie le même jour.
- Application installable et hors ligne (manifeste + service worker).
- Serpent adverse piloté par l'IA, portails appariés, proie mobile.
- Malus temporaires : contrôles inversés, brouillard.
- Manette (Gamepad API) et retour haptique sur mobile.
