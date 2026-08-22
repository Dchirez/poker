# Poker

Texas Hold'em jouable à six dans le navigateur, entre amis, via un code de table.
JavaScript pur, aucune dépendance de build. Deux cartes par joueur, cinq cartes
communes, cash game à jetons fictifs.

▶ **[dchirez.fr/poker/](https://dchirez.fr/poker/)**

## Jouer

L'hôte ouvre une table et reçoit un **code à cinq caractères** (`K7QM2`). Les autres le
saisissent, ou ouvrent directement le lien d'invitation `?table=K7QM2`, puis choisissent
un siège libre. La première main est lancée par l'hôte ; les suivantes s'enchaînent
seules après quelques secondes.

Blindes, tapis de départ et temps de réflexion se règlent à la création de la table.
On peut recaver entre deux mains, quitter son siège et revenir : le tapis suit.

## Architecture

Trois briques, volontairement étanches.

### Le moteur (`js/moteur.js`)

Une fonction pure de l'état de la partie. Il ne connaît ni le DOM ni le réseau, ce qui
le rend testable hors navigateur. Il gère l'ordre de parole (y compris le tête-à-tête,
où le bouton est petite blinde et parle en premier préflop puis en dernier ensuite),
l'option de la grosse blinde, la relance minimum, les tapis, et le découpage en
**pots latéraux** quand des joueurs sont engagés pour des montants différents.

Deux règles souvent oubliées sont implémentées explicitement :

- un tapis inférieur à une relance complète ne **rouvre pas** les enchères ;
- une **mise non suivie** est rendue. Si vous misez 500 face à un adversaire qui ne peut
  suivre que 300, les 200 excédentaires reviennent dans votre tapis avant le partage.

### L'évaluateur de mains (`js/mains.js`)

Une carte est un entier `0..51` (`valeur = 2 + c % 13`, `couleur = c / 13`). L'évaluation
énumère les 21 combinaisons de 5 cartes parmi 7 et retient la meilleure. Chaque main
produit un **score entier comparable** : catégorie en base 15, puis les rangs de
départage dans l'ordre. Deux mains de force identique donnent exactement le même score,
ce qui rend les pots partagés exacts sans cas particulier.

L'As compte 1 ou 14 : la « roue » A-2-3-4-5 est reconnue comme une quinte à 5.

Le paquet est mélangé par Fisher-Yates alimenté par `crypto.getRandomValues`, avec
rejet des tirages biaisés.

### Le réseau (`js/reseau.js`)

WebRTC **en étoile** via PeerJS. L'identifiant du pair de l'hôte dérive du code de
table, les invités s'y connectent directement. Personne ne parle à personne d'autre :
tout transite par l'hôte. Le serveur PeerJS public ne sert qu'à la mise en relation —
aucune donnée de partie n'y passe.

L'alphabet des codes exclut `O/0` et `I/L/1` : un code doit pouvoir se dicter au
téléphone.

Fermer un onglet ne produit pas toujours un événement de fermeture côté WebRTC. Un
**battement de cœur** applicatif (3 s) fait donc autorité : sans signe de vie pendant
9 s, le joueur passe absent, ses tours sont joués automatiquement et il cesse d'être
distribué — il ne perd pas ses blindes pendant son absence et retrouve son tapis en
revenant. Un identifiant stable en `localStorage` lui rend son siège.

## Ce que l'hôte voit, ce que les autres voient

L'hôte détient le paquet et calcule tout. Il ne diffuse jamais l'état brut : chaque
invité reçoit un état **taillé pour lui**, contenant ses seules cartes. Les autres
sièges n'exposent qu'un nombre de cartes, et l'abattage ne révèle que les mains encore
en lice. L'identité d'un joueur est déduite de sa connexion, jamais du message reçu :
un invité ne peut donc pas agir à la place d'un autre.

**Limite assumée du pair-à-pair :** l'onglet de l'hôte contient nécessairement le
paquet en mémoire. Rien ne l'affiche, mais quelqu'un de déterminé pourrait l'inspecter
avec les outils de développement. Entre amis c'est sans conséquence ; pour une partie
avec enjeu il faudrait un serveur arbitre (les jetons sont fictifs, la question ne se
pose pas ici).

Corollaire : la partie vit dans l'onglet de l'hôte. S'il le ferme, la table se termine.

## Interface

Habillage branché sur les tokens du design system du portfolio (`ds.css`) : orange et
violet de marque, échelle typographique, rayons, ombres, thèmes clair et sombre. Aucune
couleur en dur hors des deux cas que le jeu impose — le rouge des cœurs et carreaux, le
vert des gains.

La table pivote autour du joueur local, toujours assis en bas : le voisin de gauche,
c'est-à-dire le suivant à parler, est toujours en bas à gauche de l'écran. Les mises
glissent vers le centre du tapis. En portrait, l'ellipse bascule à la verticale et les
sièges se resserrent sur les flancs.

## Développement

Le jeu utilise des **modules ES**, qui ne se chargent pas depuis `file://`. Contrairement
aux autres jeux du dossier, il faut donc un serveur local — n'importe lequel :

```bash
npx --yes serve sites/poker
```

En production, un hébergement statique suffit (GitHub Pages convient) : il n'y a rien à
construire, rien à exécuter côté serveur.

Le moteur est éprouvé hors navigateur par simulation — quelques milliers de mains à
2 à 6 joueurs avec actions aléatoires, en vérifiant à chaque coup que les jetons sont
conservés, qu'aucune carte n'est distribuée deux fois et que le pot est intégralement
redistribué.

Chez l'hôte, `window.__poker` expose la partie en console pour éprouver une situation ;
chez les invités, il ne donne que l'état déjà reçu.

Le banc d'essai est dans le dépôt :

```bash
node sites/poker/test-moteur.mjs
```
