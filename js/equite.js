/* ============================================================
   ÉQUITÉ — probabilité de gagner la main en cours
   Le calcul n'utilise que deux cartes privées et le board public : il
   tourne entièrement en local, sans que rien ne transite par le réseau.
   C'est la même propriété qui permet d'annoncer sa meilleure main sans
   jamais exposer celle des autres — et c'est elle qui rend les bots
   honnêtes : ils décident avec leurs seules cartes.

   Deux points d'entrée :
   — `calculerEquite` découpe le travail en tranches et rend la main au
     navigateur ; c'est l'affichage du joueur ;
   — `equiteSynchrone` répond d'un bloc, pour une décision de bot.

   Les deux partagent la même mécanique de tirage, mais chacun a ses
   propres tampons : un bot qui réfléchit pendant que l'affichage du
   joueur s'affine ne doit pas corrompre son calcul.

   Ce que le chiffre dit, et surtout ce qu'il ne dit pas : il suppose des
   adversaires tenant des cartes tirées au hasard. Quelqu'un qui vient de
   suivre une relance n'a pas une main quelconque, donc le pourcentage est
   structurellement optimiste face à un joueur sélectif.
   ============================================================ */

import { scoreRapide } from "./mains.js";

const ECHANTILLONS = 20000;   // ±0,7 % environ, largement assez pour un entier
const TRANCHE_MS = 10;        // temps de calcul avant de rendre la main

/* ------------------------------------------------------------
   Contexte de tirage — tampons propres à un calcul
   ------------------------------------------------------------ */
function creerContexte(mesCartes, board, adversaires) {
  if (!mesCartes || mesCartes.length !== 2 || adversaires < 1) return null;

  const connues = new Set([...mesCartes, ...board]);
  const pioche = new Uint8Array(52);
  let nbInconnues = 0;
  for (let c = 0; c < 52; c++) if (!connues.has(c)) pioche[nbInconnues++] = c;

  const manquantes = 5 - board.length;
  const besoin = manquantes + 2 * adversaires;
  if (besoin > nbInconnues) return null;

  const maMain = new Uint8Array(7);
  maMain[0] = mesCartes[0];
  maMain[1] = mesCartes[1];
  for (let i = 0; i < board.length; i++) maMain[2 + i] = board[i];

  return {
    board, adversaires, manquantes, besoin, nbInconnues, pioche, maMain,
    sonMain: new Uint8Array(7),
    complement: new Uint8Array(besoin),
  };
}

/* Part du pot revenant au joueur pour un scénario donné : 1 s'il gagne
   seul, 1/n en cas d'égalité à n, 0 s'il perd. */
function partDuPot(ctx, monScore) {
  const { board, manquantes, complement, sonMain } = ctx;
  let egaux = 0;

  for (let a = 0; a < ctx.adversaires; a++) {
    const base = manquantes + a * 2;
    sonMain[0] = complement[base];
    sonMain[1] = complement[base + 1];
    for (let i = 0; i < board.length; i++) sonMain[2 + i] = board[i];
    for (let i = 0; i < manquantes; i++) sonMain[2 + board.length + i] = complement[i];

    const son = scoreRapide(sonMain);
    if (son > monScore) return 0;
    if (son === monScore) egaux++;
  }
  return 1 / (1 + egaux);
}

/* Un scénario tiré au hasard : on complète le board et on distribue aux
   adversaires, sans remise. */
function unTirage(ctx) {
  const { pioche, complement, besoin, nbInconnues, maMain, board, manquantes } = ctx;
  // Fisher-Yates partiel : on ne mélange que les `besoin` premières cases.
  for (let i = 0; i < besoin; i++) {
    const j = i + ((Math.random() * (nbInconnues - i)) | 0);
    const t = pioche[i]; pioche[i] = pioche[j]; pioche[j] = t;
    complement[i] = pioche[i];
  }
  for (let i = 0; i < manquantes; i++) maMain[2 + board.length + i] = complement[i];
  return partDuPot(ctx, scoreRapide(maMain));
}

/* ------------------------------------------------------------
   Énumération exacte — river en tête-à-tête, 990 mains possibles
   ------------------------------------------------------------ */
function exacteRiverTeteATete(ctx) {
  const monScore = scoreRapide(ctx.maMain);
  let total = 0, cas = 0;
  for (let i = 0; i < ctx.nbInconnues; i++) {
    for (let j = i + 1; j < ctx.nbInconnues; j++) {
      ctx.complement[0] = ctx.pioche[i];
      ctx.complement[1] = ctx.pioche[j];
      total += partDuPot(ctx, monScore);
      cas++;
    }
  }
  return total / cas;
}

const estRiverTeteATete = (board, adversaires) => board.length === 5 && adversaires === 1;

/* ------------------------------------------------------------
   Point d'entrée synchrone — décision de bot
   Répond d'un bloc. Quelques milliers de tirages suffisent pour choisir
   entre suivre et se coucher, et le coût se compte en millisecondes.
   ------------------------------------------------------------ */
export function equiteSynchrone({ mesCartes, board, adversaires }, echantillons = 4000) {
  const ctx = creerContexte(mesCartes, board, adversaires);
  if (!ctx) return null;
  if (estRiverTeteATete(board, adversaires)) return exacteRiverTeteATete(ctx);

  let total = 0;
  for (let i = 0; i < echantillons; i++) total += unTirage(ctx);
  return total / echantillons;
}

/* ------------------------------------------------------------
   Point d'entrée par tranches — affichage du joueur
   Retourne une fonction d'annulation : la vue peut interrompre un calcul
   devenu obsolète (nouvelle carte, joueur couché) sans l'attendre.
   ------------------------------------------------------------ */
export function calculerEquite({ mesCartes, board, adversaires }, surResultat) {
  const ctx = creerContexte(mesCartes, board, adversaires);
  if (!ctx) return () => {};

  if (estRiverTeteATete(board, adversaires)) {
    surResultat({ equite: exacteRiverTeteATete(ctx), exact: true, adversaires });
    return () => {};
  }

  let annule = false;
  let faits = 0, total = 0;

  function tranche() {
    if (annule) return;
    const limite = performance.now() + TRANCHE_MS;
    while (faits < ECHANTILLONS && performance.now() < limite) {
      total += unTirage(ctx);
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
