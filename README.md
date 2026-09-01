# Neon Arcade 🕹️

Une petite **plateforme de jeux d'arcade** en **HTML / CSS / JavaScript purs** :
aucune dépendance, aucun build, aucun serveur. Ouvre `index.html` et joue.

![Jeux](https://img.shields.io/badge/jeux-10-38f9c3) ![Dépendances](https://img.shields.io/badge/d%C3%A9pendances-0-38f9c3) ![Vanilla JS](https://img.shields.io/badge/vanilla-JS-ffd166)

| Jeu | Principe |
|---|---|
| 🐍 **Neon Snake** | Mange, grandis, évite ta propre queue. Bonus, combos, quatre difficultés. |
| 🧱 **Neon Bricks** | Casse toutes les briques sans laisser tomber la balle. Bonus, niveaux enchaînés. |
| 🔢 **Neon 2048** | Glisse, fusionne, vise la plus grande tuile. Quatre tailles de grille. |
| 💣 **Neon Mines** | Démineur : déduis où sont les mines, marque-les, déblaie le reste. |
| 🔴 **Neon Four** | Puissance 4 contre une IA qui explore l'arbre des coups. |
| 🟦 **Neon Blocks** | Tetris : emboîte les pièces, complète les lignes, tiens le rythme. |
| 📦 **Neon Crates** | Pousse-caisses : douze tableaux à résoudre, annulation à volonté. |
| 🐱 **Neon Meow** | Un chat par territoire, jamais deux qui se touchent. Déduction pure. |
| 🃏 **Neon Cells** | Réussite FreeCell : 52 cartes visibles, aucune donne insoluble servie. |
| 🔤 **Neon Mots** | Le mot caché en six essais, clavier AZERTY à l'écran. |

Le **hall** (`index.html`) liste les jeux et résume la progression commune : parties
jouées, temps de jeu, points cumulés et succès tous jeux confondus. Il défile quand le
catalogue dépasse l'écran, et passe à deux colonnes dès qu'il y a la place. Chaque jeu
s'ouvre dans la même coquille (`jeu.html?id=…`) et hérite des mêmes panneaux :
succès, skins, statistiques et réglages.

## Jouer

- **En local** : ouvre `index.html` dans un navigateur, ou lance le serveur intégré
  avec `npm start` puis <http://127.0.0.1:8123>.
- **En ligne** : active GitHub Pages sur la branche du dépôt (Settings → Pages →
  *Deploy from a branch*), le tout est servi tel quel.

## Contrôles

Tous les jeux partagent les mêmes commandes.

| Action | Clavier | Tactile |
|---|---|---|
| Se déplacer / glisser | Flèches, `WASD` ou `ZQSD` | Balayage sur le plateau, ou croix directionnelle |
| Saisir et déposer (cartes) | — | Glisser du doigt ou à la souris ; une tape envoie la carte |
| Écrire un mot | Lettres, `Entrée`, `Retour` | Clavier AZERTY dessiné sur le plateau |
| Action secondaire (drapeau) | `F` | Clic droit, ou appui long sur la case |
| Pause | `Espace` / `Échap` | Bouton ❚❚ |
| Démarrer / rejouer | `Espace` ou `Entrée` | Bouton *Jouer* |
| Couper le son | — | Bouton ♪ |
| Panneaux | — | Bouton ☰, ou les liens du menu |
| **Enregistrer et quitter** | — | Bouton ⏏, la flèche ‹, ou le bouton du panneau de pause |

**Quitter en cours de partie n'efface rien** : le bouton ⏏ de la barre d'outils, la
flèche de retour du HUD et le bouton *Enregistrer et quitter* du panneau de pause font
tous la même chose — la partie en cours est ajoutée aux statistiques (score, durée,
succès), puis on revient au hall. Une partie vide, où rien ne s'est passé, n'est pas
enregistrée.

## 🐍 Neon Snake

| Élément | Effet |
|---|---|
| 🔴 **Pomme** | +10 points, le serpent grandit d'une case |
| ⭐ **Or** | +50 points, grandit de deux cases — mais disparaît au bout de 9 s |
| ❄ **Ralenti** | Ralentit le jeu pendant 7 s (jauge bleue en bas du plateau) |
| ◇ **Fantôme** | Traverse les murs, les obstacles et son propre corps pendant 6 s |

**Combos** : enchaîne deux prises à moins de 2,6 s d'intervalle et le multiplicateur
monte, jusqu'à ×5. Il retombe à ×1 dès que tu traînes. **En mode zen, le chronomètre
ne s'applique pas** : le combo est un simple compteur qui monte d'un cran à chaque
ramassage et atteint ×5 à la cinquième pomme, quel que soit le temps écoulé, et il ne
redescend jamais. Le compteur y est affiché dès ×1 (ailleurs il n'apparaît qu'à
partir de ×2).

| Mode | Murs | Obstacles | Rythme |
|---|---|---|---|
| Facile | traversés | aucun | 150 → 90 ms par case |
| Normal | mortels | aucun | 125 → 68 ms |
| Difficile | mortels | blocs générés aléatoirement | 100 → 52 ms |
| **Zen** | traversés | aucun | 165 → 135 ms |

En **mode zen**, rien ne tue : ni les murs, ni les obstacles, ni son propre corps. La
partie ne s'arrête jamais d'elle-même, et le HUD remplace le record par la longueur
atteinte.

Réglages propres au jeu : taille de la grille (15, 21 ou 27 cases), vitesse
progressive ou constante, quadrillage visible ou non.

## 🧱 Neon Bricks

Une balle, une raquette, des briques. La raquette se pilote aux flèches, à la souris
ou au doigt ; l'angle de renvoi dépend du point d'impact — au centre la balle repart
tout droit, sur le bord elle part de biais. Chaque niveau vidé en ajoute une rangée et
accélère un peu la balle.

| Bonus | Effet |
|---|---|
| 🟢 **Raquette large** | Raquette agrandie de moitié pendant 10 s |
| 🔵 **Balle lente** | Balle ralentie pendant 6 s |
| 🔴 **Vie en plus** | Une vie supplémentaire |

| Mode | Vies | Rangées | Particularité |
|---|---|---|---|
| Facile | 4 | 4 | Raquette large, balle patiente |
| Normal | 3 | 5 | L'équilibre de référence |
| Difficile | 2 | 6 | Raquette étroite, rangée du haut à casser deux fois |
| **Zen** | ∞ | 4 | La balle rebondit aussi en bas : on ne perd jamais |

Réglages propres au jeu : vitesse de la balle, suivi au pointeur, bonus activables.

## 🔢 Neon 2048

Glisse les tuiles : deux tuiles identiques qui se rencontrent fusionnent et leur
somme est marquée. Une nouvelle tuile apparaît à chaque coup effectif.

| Mode | Grille | Particularité |
|---|---|---|
| Classique | 4 × 4 | La règle d'origine |
| Serré | 3 × 3 | Chaque coup compte, la place manque vite |
| Large | 5 × 5 | De la place, des parties longues |
| **Zen** | 4 × 4 | Sans issue, les plus petites tuiles s'évaporent : on ne perd jamais |

Atteindre la tuile objectif affiche l'écran de victoire, mais rien n'oblige à
s'arrêter là : *Continuer* reprend la partie pour viser plus haut.

Réglages propres au jeu : objectif (1024, 2048 ou 4096) et apparition des nouvelles
tuiles (une sur dix en 4, ou toutes en 2).

## 💣 Neon Mines

Le démineur classique. Un clic découvre une case, le clic droit — ou un appui long sur
mobile, ou la touche `F` — y plante un drapeau. Un chiffre indique combien de mines
touchent la case ; recliquer sur un chiffre déjà découvert déblaie ses voisines dès que
les drapeaux autour correspondent.

**Le premier clic est toujours sûr** : les mines ne sont posées qu'après, et jamais sous
la case jouée ni ses voisines. Aucune partie ne peut donc mourir au premier coup.

| Mode | Grille | Mines |
|---|---|---|
| Facile | 9 × 9 | 10 |
| Normal | 12 × 12 | 22 |
| Difficile | 16 × 16 | 45 |
| **Zen** | 12 × 12 | 20 — une mine touchée est désamorcée, on ne perd jamais |

Le score compte 10 points par case révélée, plus une prime de victoire qui décroît avec
le temps : les records récompensent donc les grilles déminées vite.

Réglages propres au jeu : premier clic sûr, marquage automatique des dernières cases,
chiffres colorés ou sobres.

## 🔴 Neon Four

Puissance 4 contre un adversaire. Les flèches visent une colonne, `Espace` lâche le
jeton — ou un clic direct sur la colonne. Le premier à aligner quatre jetons l'emporte,
horizontalement, verticalement ou en diagonale.

**L'adversaire réfléchit vraiment** : il explore l'arbre des coups en minimax avec
élagage alpha-bêta, en examinant les colonnes centrales d'abord pour élaguer plus tôt.
Il évalue chaque fenêtre de quatre cases selon ce qu'elle promet, et saisit toujours une
victoire immédiate comme il pare toujours une défaite immédiate — même en mode maladroit.

| Mode | Profondeur | Erreurs |
|---|---|---|
| Facile | 2 coups d'avance | une fois sur trois |
| Normal | 4 coups | rarement |
| Difficile | 6 coups | jamais |
| **Zen** | joue au hasard | `U` annule ton dernier coup |

Le score compte 10 points par jeton posé, plus une prime de victoire d'autant plus
grosse que la partie a été courte. Un match nul en rapporte le tiers.

Réglages propres au jeu : qui commence (toi, l'adversaire, ou en alternance) et le
grisage des colonnes pleines.

## 🟦 Neon Blocks

Le Tetris. Les flèches déplacent, `Haut` fait tourner, `Bas` accélère la descente,
`Espace` pose la pièce d'un coup et `C` la met de côté pour plus tard. La projection
au sol montre où elle atterrira.

Une pièce qui touche le fond dispose d'un court répit avant de se figer : de quoi la
glisser une dernière fois. La rotation est rattrapée par un décalage quand la place
manque contre un mur. Les pièces sortent d'un sac de sept, si bien qu'aucune ne se
fait attendre indéfiniment.

| Mode | Départ | Descente |
|---|---|---|
| Facile | niveau 1 | 1100 ms par case, jamais sous 170 |
| Normal | niveau 1 | 900 ms, jamais sous 110 |
| Difficile | niveau 5 | 800 ms, jamais sous 70 |
| **Zen** | niveau 1 | 1300 ms — pile pleine, le haut s'évapore, on ne perd jamais |

Une ligne rapporte 100 points, deux 300, trois 500, quatre 800, le tout multiplié par
le niveau — qui monte toutes les dix lignes. Poser soi-même la pièce rapporte deux
points par case gagnée.

Réglages propres au jeu : projection au sol, et une ou trois pièces annoncées.

## 📦 Neon Crates

Le pousse-caisses. Les flèches déplacent le pousseur, qui pousse une caisse s'il en
rencontre une — jamais deux, jamais contre un mur. Tout est résolu quand chaque cible
porte sa caisse. `U` annule le dernier pas, `R` recommence le tableau : dans un jeu de
réflexion, revenir en arrière fait partie du jeu.

Chaque tableau annonce un **nombre de pas conseillé**. Le résoudre en moins rapporte
dix points par pas économisé, en plus des cent points du tableau.

| Série | Tableaux | Ce qui s'y joue |
|---|---|---|
| Facile | 4 | Une ou deux caisses, pas de piège |
| Normal | 4 | Des murs qui coupent les passages |
| Difficile | 4 | Serré : une caisse dans un coin est perdue |
| **Libre** | les 12 | Sans classement, et `N` passe au tableau suivant |

Une caisse hors cible coincée entre deux murs d'angle est signalée en rouge : elle ne
bougera plus, autant recommencer tout de suite.

**Les douze tableaux sont prouvés solubles** — un solveur en largeur d'abord explore
l'espace des positions et vérifie, à chaque exécution des tests, que chacun a une
solution et que le par annoncé est tenable. Deux tableaux insolubles ont d'ailleurs été
attrapés ainsi pendant l'écriture.

Réglages propres au jeu : signalement des caisses bloquées, et quadrillage du sol.

## 🐱 Neon Meow

Un casse-tête de déduction, dans la famille de *Meowdoku*. Le plateau est découpé en
territoires colorés, et il faut y installer les chats :

1. **un chat par territoire**, ni plus ni moins ;
2. **jamais deux chats sur la même ligne ni la même colonne** ;
3. **jamais deux chats qui se touchent**, pas même en diagonale.

Un clic pose un chat, un clic droit — ou un appui long — barre une case dont on a
déduit qu'elle est vide. Deux chats qui ne peuvent pas cohabiter deviennent roses. La
touche `H` donne un coup de patte : elle place un chat juste, contre cinquante points.

| Mode | Grille | Particularité |
|---|---|---|
| Facile | 5 × 5 | De quoi prendre le pli |
| Normal | 6 × 6 | Il faut vraiment déduire |
| Difficile | 7 × 7 | Les territoires deviennent retors |
| **Zen** | 6 × 6 | Sans classement, et les coups de patte sont gratuits |

**Les grilles sont tirées au sort, jamais préécrites** — et trois choses sont garanties
avant qu'une grille arrive à l'écran :

- **une seule solution.** Le générateur pose une solution, découpe les territoires
  autour d'elle, puis répare : tant qu'une autre solution existe, il la casse en
  déplaçant une de ses cases vers un territoire voisin, ce qui invalide la solution
  parasite sans toucher à la vraie.
- **des territoires comparables.** Ils poussent tous en même temps, anneau par anneau,
  et aucun n'est accepté en dessous de trois cases ni au-dessus d'une fois et demie la
  moyenne. Un territoire d'une seule case donnerait son chat sans la moindre déduction ;
  un territoire géant se lirait comme le fond du plateau.
- **la taille annoncée.** Si la recherche traîne, le générateur desserre ses exigences
  d'équilibre plutôt que de servir une grille plus petite : la difficulté choisie est
  toujours celle qu'on joue.

Les tests revérifient tout cela sur quatre-vingt-dix grilles à chaque exécution.

Réglages propres au jeu : signalement des bagarres, et barrage automatique des cases
qu'un chat posé vient d'interdire.

## 🃏 Neon Cells

La réussite **FreeCell**. Les 52 cartes sont visibles dès le début : il n'y a rien à
deviner, seulement à décider. Huit colonnes, quatre **cellules libres** qui tiennent une
carte chacune, quatre **fondations** à remplir de l'as au roi.

- Dans les colonnes, on empile en **descendant** et en **alternant les couleurs** :
  un valet noir sur une dame rouge.
- Une **suite** déjà rangée se déplace d'un seul geste. Le nombre de cartes
  transportables n'est pas arbitraire : c'est exactement ce qu'on pourrait déplacer à la
  main, soit *(cellules libres + 1) × 2^(colonnes vides)*.
- **Glisser-déposer** à la souris comme au doigt ; une simple **tape** envoie la carte
  là où elle a le plus de sens — sa fondation d'abord, une colonne ensuite, une cellule
  en dernier recours.
- `U` annule, `R` redonne la même donne, `I` demande un indice.

Les cartes qui ne peuvent plus servir à personne **montent seules** aux fondations (un
as, ou un deux dont les deux couleurs opposées sont déjà rangées). C'est un réglage,
désactivable pour qui préfère tout faire à la main.

| Mode | Cellules libres | Ce qui change |
|---|---|---|
| Facile | 4 | La réussite d'origine |
| Normal | 3 | Une case de manœuvre en moins, prime de 40 % |
| Difficile | 2 | Chaque carte posée coûte cher, prime de 100 % |
| **Libre** | 4 | Sans classement |

Une carte montée rapporte 12 points. Terminer une donne en rapporte 250, plus un point
par seconde gagnée sur cinq minutes — et c'est cette prime de fin que le coefficient de
difficulté multiplie. Un indice en coûte 40.

**Aucune donne insoluble n'arrive sur le tapis.** Le jeu embarque son propre solveur —
une recherche au meilleur d'abord, guidée par une estimation du chemin restant — et il
tire des donnes jusqu'à en avoir résolu une. Le même solveur sert deux fois de plus :
il fournit les indices, et quand une position n'a plus de solution il le dit
franchement plutôt que de faire perdre son temps au joueur. Les tests reprennent la
vérification de l'extérieur, en resolvant eux-mêmes chaque donne servie, à quatre, trois
et deux cellules.

Réglages propres au jeu : montée automatique aux fondations, et éclairage des
emplacements qui accepteraient la carte tenue.

## 🔤 Neon Mots

Un mot est caché ; chaque proposition dit, lettre par lettre, ce qu'elle vaut :
**bien placée**, **présente mais ailleurs**, ou **absente**. Le clavier AZERTY dessiné
sous la grille garde la trace de tout ce qu'on a appris — et l'état d'une touche ne
redescend jamais. On écrit au clavier de la machine comme au doigt sur celui de
l'écran.

| Mode | Mot | Essais |
|---|---|---|
| Facile | 4 lettres | 6 |
| Normal | 5 lettres | 6 — prime de 30 % |
| Difficile | 6 lettres | 5 — prime de 80 % |
| **Libre** | 5 lettres | 8, et un mot manqué n'arrête pas la partie |

Comme au *Motus*, **la première lettre est offerte** : elle est déjà écrite et ne
s'efface pas. C'est un réglage, et le succès *Sans cadeau* attend ceux qui le coupent.

Un mot trouvé rapporte 30 points par lettre, plus 40 par essai resté inutilisé, le tout
multiplié par la prime de difficulté. Manquer un mot arrête la partie — sauf en mode
libre.

**La liste est écrite à la main** : un millier de noms, adjectifs et infinitifs
courants, en majuscules et sans accent, ni pluriels ni conjugaisons ni noms propres.
Elle sert deux fois — elle fournit les mots à trouver, et elle décide de ce qu'on
accepte comme proposition. Elle est forcément incomplète : le réglage *Refuser les mots
inconnus* existe pour le jour où elle recale un vrai mot.

**Ce qui est prouvé, en revanche, c'est le marquage.** C'est là que les jeux de ce genre
se trompent, sur les lettres répétées : proposer `ELLES` quand la solution est `ELEVE`
ne doit signaler que deux E, pas trois. Les tests vérifient, sur **toutes les paires de
mots des trois listes — plus de 359 000 marquages** — que pour chaque lettre le nombre
de cases signalées vaut exactement le minimum entre ce que la proposition en contient et
ce que la solution en contient, et qu'une case est marquée « bien placée » si et
seulement si les deux lettres coïncident.

Réglages propres au jeu : première lettre offerte, et refus des mots inconnus.

## Succès, skins et statistiques

Chaque jeu a ses **succès** — douze chacun — et plusieurs
d'entre eux débloquent un **skin** : couleurs du serpent d'un côté, palettes de tuiles
de l'autre, dont un arc-en-ciel dans les deux cas. Chaque déblocage s'annonce par une
notification pendant la partie.

Le panneau *Stats* récapitule les totaux avec le vocabulaire de chaque jeu (pommes et
bonus ici, coups et fusions là), les records par difficulté, et un graphique des vingt
dernières parties : barre la plus haute étiquetée, ligne pointillée de la moyenne,
détail au survol.

## Réglages

| Réglage | Portée | Options |
|---|---|---|
| Thème | **partagé** | Néon, Rétro (vert) ou Crépuscule (violet) |
| Son | **partagé** | activable |
| Effets visuels | **partagé** | particules, secousses et textes flottants |
| Le reste | propre au jeu | grille et vitesse pour le Snake, objectif et tuiles pour 2048 |

Un bouton efface toutes les données locales, en deux temps pour éviter la fausse
manœuvre.

## Structure

Le code est séparé en trois : un **socle** qui ne connaît aucun jeu, les **jeux** qui
se décrivent dans un manifeste, et le **hall**.

```
index.html                    # le hall : profil commun et cartes des jeux
jeu.html                      # la coquille commune, ouverte en ?id=<jeu>
src/core/
  storage.js                  # stockage local cloisonné : neon:<espace>:<clé>
  progress.js                 # réglages, statistiques, succès et skins, pilotés par le manifeste
  sheets.js                   # panneaux succès / skins / stats / réglages, et notifications
  ui.js                       # HUD, panneau central, sélecteur de difficulté, barre d'outils
  loop.js                     # boucle à pas fixe, rendu interpolé, canvas HiDPI
  input.js                    # clavier (coups, maintien, saisie de texte), pointeur, balayage, pavé, glisser-déposer
  audio.js                    # bruitages WebAudio
  shell.js                    # charge le jeu demandé et habille la page
  ui.css                      # thèmes et coquille visuelle partagée
src/games/
  registry.js                 # catalogue : quels fichiers pour quel jeu
  snake/manifest.js · game.js · legacy.js
  bricks/manifest.js · game.js · bricks.css
  2048/manifest.js · game.js · 2048.css
  mines/manifest.js · game.js · mines.css
  four/manifest.js · game.js · four.css
  blocks/manifest.js · game.js · blocks.css
  crates/manifest.js · game.js · crates.css
  meow/manifest.js · game.js · meow.css
  cells/manifest.js · game.js · cells.css
  mots/manifest.js · game.js · words.js · mots.css
src/hub/hub.js · hub.css      # le hall
tests/                        # vingt suites de bout en bout (voir plus bas)
```

**Le manifeste est le contrat.** Un jeu y déclare son nom, ses difficultés, ses
réglages, ses succès (chacun un simple prédicat sur la partie), ses skins et les
tuiles de statistiques avec leur vocabulaire. En échange, il reçoit les quatre
panneaux, les thèmes, la persistance, les notifications de déblocage, la courbe de
progression, le HUD, le menu et la barre d'outils. `game.js` ne contient plus que les
règles et le rendu.

**Cloisonnement des données** : `neon:app:settings` porte les réglages partagés entre
tous les jeux ; `neon:<jeu>:*` porte le reste (réglages propres, totaux, succès,
records). Les données de l'ancien schéma `neon-snake:*` sont reprises automatiquement
au premier chargement, puis effacées.

## Tests

Vingt suites de bout en bout, jouées dans un vrai navigateur : elles lancent les
jeux, appuient sur les touches, cliquent, et vérifient ce que le joueur verrait.

```bash
npm install && npx playwright install chromium
npm test                        # les vingt suites, environ 4 minutes
node tests/run.js mines four    # seulement celles dont le nom correspond
npm start                       # sert le jeu sur http://127.0.0.1:8123
```

Le lanceur démarre son propre serveur statique : rien d'autre à installer.
Détails et façon d'écrire une suite dans [`tests/README.md`](tests/README.md).

Ces tests ne sont pas décoratifs : ils ont attrapé, entre autres, une fin de partie
jamais détectée sur un plateau déjà bloqué (2048), un niveau suivant qui ne
s'enclenchait pas si la balle était au repos (casse-briques), des succès non
évalués tant que la balle restait collée à la raquette, un éclair de ligne complétée
cadencé sur la gravité (Tetris), deux tableaux de pousse-caisses insolubles, un générateur de grilles
qui échouait vingt-six fois sur trente en 7 × 7, une difficulté réécrite au
chargement qui survivait à une réinitialisation, le cache périmé qui rendait les
boutons du menu inertes, et le panneau de fin de partie coupé net par le bord du
plateau — dont la première correction, en le sortant du plateau, rendait la barre
d'outils inaccessible pendant la pause.

## Ajouter un jeu

1. Créer `src/games/<id>/manifest.js` (nom, difficultés, réglages, succès, skins,
   statistiques) et `game.js` (règles et rendu).
2. L'inscrire dans `src/games/registry.js`.
3. Ajouter son manifeste au hall dans `index.html`.

Rien d'autre : le hall, les panneaux et la persistance suivent. Un jeu qui ne déclare
pas de skins voit l'onglet correspondant disparaître ; un jeu sans légende n'en
affiche pas.

Les fichiers de `src/` sont appelés avec un suffixe `?v=N` dans les deux pages :
**incrémente ce numéro dès que tu modifies un fichier de `src/`**, sinon les
navigateurs (et le CDN de GitHub Pages) continuent de servir l'ancienne version depuis
leur cache — le HTML est à jour mais le CSS et le JavaScript ne le sont pas, et la
page se retrouve à moitié cassée. Les fichiers d'un jeu héritent automatiquement du
`?v=` de la coquille.

Points techniques notables :

- **Boucle à pas fixe, rendu interpolé** (`core/loop.js`) : la logique avance par
  ticks réguliers dont le jeu fixe la durée, le rendu interpole entre deux ticks. Les
  dix jeux l'utilisent différemment : le Snake avance d'une case par tick (150 à
  52 ms), le Tetris fait descendre sa pièce au rythme du niveau (1100 à 70 ms), le
  casse-briques simule sa balle à 120 pas par seconde, 2048 et le puissance 4 ne
  demandent aucun tick — leur boucle ne sert qu'aux animations —, le démineur s'en
  sert seulement pour son chronomètre, et ni le pousse-caisses, ni Neon Meow, ni la
  réussite, ni le jeu de lettres n'en ont besoin.
- **Entrées à plusieurs régimes** (`core/input.js`) : coups discrets (une direction, une
  action) pour les jeux au tour par tour ; axe maintenu et position du pointeur pour la
  raquette du casse-briques ; tape sur une case, action secondaire (clic droit ou appui
  long) et touches propres au jeu pour le démineur ; saisie-déplacement-dépôt, avec
  capture du pointeur, pour les cartes de la réussite ; saisie de texte pour le jeu de
  lettres, où « z » redevient une lettre au lieu d'un pas vers le haut et où Entrée
  valide un mot au lieu de lancer la partie. Un seul module, six usages.
- **File d'entrées** (Snake) : jusqu'à deux directions sont mises en attente, pour que
  les virages serrés ne soient jamais avalés ; les demi-tours sont filtrés.
- **Sons générés à la volée** en WebAudio (oscillateurs) — aucun fichier audio.
- **Canvas adapté au `devicePixelRatio`**, redimensionné avec la fenêtre.
- **Garde-fou de chargement** : chaque jeu vérifie que les fichiers du socle ont bien
  défini ce qu'ils devaient, et affiche lequel manque plutôt que d'échouer en silence.
- **Panneau borné par un plateau carré** : le panneau central vit à l'intérieur du
  plateau, dont la hauteur ne dépasse jamais la largeur. Dans sa forme la plus longue —
  fin de partie, difficultés et tableau de score réunis — la place peut manquer. Plutôt
  que d'être tranché par le bord du plateau, il s'y arrête (`max-height: 100%`) et
  défile chez lui, bordure et coins visibles. C'est une garantie de structure et non un
  ajustement au pixel : la hauteur d'un texte dépend des polices du visiteur, pas de ce
  qu'on a mesuré. Il ne sort jamais du plateau non plus, sinon la barre d'outils
  deviendrait inutilisable pendant la pause. Les tests le vérifient sur quatre tailles
  d'écran, et une fois de plus avec un texte volontairement plus haut.
- `window.__neonSnake`, `window.__neonBricks`, `window.__neon2048`, `window.__neonMines`,
  `window.__neonFour`, `window.__neonBlocks`, `window.__neonCrates`, `window.__neonMeow`
  et `window.__neonCells` exposent un
  instantané en lecture seule de la partie, et de quoi placer une situation précise :
  c'est le point d'entrée des tests automatisés dans un navigateur.

## Idées d'évolution

- Un onzième jeu : un Memory, un Simon, ou un picross.
- Défi quotidien : une graine déterministe pour que tout le monde joue le même mot ou
  la même donne le même jour.
- Application installable et hors ligne (manifeste + service worker).
- Succès transversaux à la plateforme, et un niveau de profil commun.
- Manette (Gamepad API) et retour haptique sur mobile.
