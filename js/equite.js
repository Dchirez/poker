/* ============================================================
   ÉQUITÉ — probabilité de gagner la main en cours
   Le calcul n'utilise que vos deux cartes et le board public : il tourne
   entièrement en local, sans que rien ne transite par le réseau. C'est la
   même propriété qui permet déjà d'annoncer votre meilleure main sans
   jamais exposer celle des autres.

   Deux régimes :
   — à la river en tête-à-tête, les 990 mains adverses possibles sont
     énumérées : le résultat est exact ;
   — partout ailleurs, on tire des scénarios au hasard (Monte-Carlo). Le
     travail est découpé en tranches qui rendent la main au navigateur,
     pour qu'un téléphone lent ne gèle pas l'interface.

   Ce que le chiffre dit, et surtout ce qu'il ne dit pas : il suppose des
   adversaires tenant des cartes tirées au hasard. Quelqu'un qui vient de
   suivre une relance n'a pas une main quelconque, donc le pourcentage est
   structurellement optimiste face à un joueur sélectif.
   ============================================================ */

import { scoreRapide } from "./mains.js";

const ECHANTILLONS = 20000;   // ±0,7 % environ, largement assez pour un entier
const TRANCHE_MS = 10;        // temps de calcul avant de rendre la main

/* Tampons réutilisés : à 20 000 tirages, allouer à chaque tour coûterait
   plus cher que l'évaluation elle-même. */
const _pioche = new Uint8Array(52);
const _maMain = new Uint8Array(7);
const _sonMain = new Uint8Array(7);

/* Nombre de cartes à tirer pour compléter un scénario. */
const aTirer = (board, adversaires) => (5 - board.length) + 2 * adversaires;

/* ------------------------------------------------------------
   Un scénario : on complète le board et on distribue aux adversaires,
   puis on compare. Retourne la part du pot revenant au joueur —
   1 s'il gagne seul, 1/n en cas d'égalité à n, 0 s'il perd.
   ------------------------------------------------------------ */
function partDuPot(monScore, board, complement, adversaires) {
  // Les cartes du complément sont rangées ainsi : d'abord les cartes
  // manquantes du board, puis deux cartes par adversaire.
  const manquantes = 5 - board.length;
  let mieux = 0, egaux = 0;

  for (let a = 0; a < adversaires; a++) {
    const base = manquantes + a * 2;
    _sonMain[0] = complement[base];
    _sonMain[1] = complement[base + 1];
    for (let i = 0; i < board.length; i++) _sonMain[2 + i] = board[i];
    for (let i = 0; i < manquantes; i++) _sonMain[2 + board.length + i] = complement[i];

    const son = scoreRapide(_sonMain);
    if (son > monScore) { mieux++; break; }
    if (son === monScore) egaux++;
  }

  if (mieux) return 0;
  return 1 / (1 + egaux);
}

/* ------------------------------------------------------------
   Lance un calcul. Retourne une fonction d'annulation : la vue peut
   interrompre un calcul devenu obsolète (nouvelle carte, joueur couché)
   sans attendre qu'il se termine.
   ------------------------------------------------------------ */
/* Les tampons ci-dessus sont partagés : deux calculs qui se chevaucheraient
   se corrompraient l'un l'autre. Un numéro de génération garantit qu'une
   tranche appartenant à un calcul dépassé s'arrête net, même si l'appelant
   a oublié de l'annuler. */
let generation = 0;

export function calculerEquite({ mesCartes, board, adversaires }, surResultat) {
  const moi = ++generation;
  if (!mesCartes || mesCartes.length !== 2 || adversaires < 1) return () => {};

  // Cartes encore possibles : le paquet moins les miennes et le board.
  const connues = new Set([...mesCartes, ...board]);
  let nbInconnues = 0;
  for (let c = 0; c < 52; c++) if (!connues.has(c)) _pioche[nbInconnues++] = c;

  const besoin = aTirer(board, adversaires);
  if (besoin > nbInconnues) return () => {};

  // Ma main est fixe dès que le board est complet ; sinon elle dépend du
  // tirage, on la recompose à chaque scénario.
  _maMain[0] = mesCartes[0]; _maMain[1] = mesCartes[1];

  let annule = false;
  const complement = new Uint8Array(besoin);

  /* --- River en tête-à-tête : énumération exacte des 990 mains --- */
  if (board.length === 5 && adversaires === 1) {
    for (let i = 0; i < 5; i++) _maMain[2 + i] = board[i];
    const monScore = scoreRapide(_maMain);
    let total = 0, cas = 0;
    for (let i = 0; i < nbInconnues; i++) {
      for (let j = i + 1; j < nbInconnues; j++) {
        complement[0] = _pioche[i]; complement[1] = _pioche[j];
        total += partDuPot(monScore, board, complement, 1);
        cas++;
      }
    }
    surResultat({ equite: total / cas, exact: true, adversaires });
    return () => {};
  }

  /* --- Ailleurs : tirages successifs, par tranches --- */
  let faits = 0, total = 0;

  function tranche() {
    if (annule || moi !== generation) return;
    const limite = performance.now() + TRANCHE_MS;
    while (faits < ECHANTILLONS && performance.now() < limite) {
      // Tirage sans remise, à la Fisher-Yates partiel : on ne mélange que
      // les `besoin` premières cases, le reste du paquet ne bouge pas.
      for (let i = 0; i < besoin; i++) {
        const j = i + ((Math.random() * (nbInconnues - i)) | 0);
        const t = _pioche[i]; _pioche[i] = _pioche[j]; _pioche[j] = t;
        complement[i] = _pioche[i];
      }
      const manquantes = 5 - board.length;
      for (let i = 0; i < board.length; i++) _maMain[2 + i] = board[i];
      for (let i = 0; i < manquantes; i++) _maMain[2 + board.length + i] = complement[i];

      total += partDuPot(scoreRapide(_maMain), board, complement, adversaires);
      faits++;
    }

    if (faits >= ECHANTILLONS) surResultat({ equite: total / faits, exact: false, adversaires });
    else {
      // Résultat intermédiaire : le chiffre se stabilise sous les yeux
      // plutôt que d'apparaître d'un coup après un blanc.
      surResultat({ equite: total / faits, exact: false, adversaires, partiel: true });
      setTimeout(tranche, 0);
    }
  }

  setTimeout(tranche, 0);
  return () => { annule = true; };
}
