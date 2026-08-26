/* ============================================================
   BOTS — joueurs tenus par l'hôte
   Un bot n'est qu'un siège dont les décisions sont calculées au lieu
   d'arriver par le réseau. Les autres joueurs ne voient aucune
   différence : l'état diffusé est le même.

   RÈGLE CARDINALE : un bot décide à partir de ses deux cartes et du
   board, rien d'autre. L'hôte détient pourtant tout le paquet — c'est
   donc une contrainte volontaire, pas une impossibilité technique. Elle
   tient à la signature de `decider`, qui ne reçoit jamais que la main
   du bot concerné.

   La méthode est classique : comparer son équité à la cote du pot.
   Si la probabilité de gagner dépasse la part du pot qu'il faut payer,
   suivre est rentable ; bien au-delà, relancer l'est aussi.
   ============================================================ */

import { equiteSynchrone } from "./equite.js";

const ECHANTILLONS = 4000;   // ~3 ms par décision, imperceptible

/* Quelques noms courts, pour que la table reste lisible. */
export const NOMS = [
  "Ada", "Turing", "Hopper", "Nim", "Pascal", "Gauss", "Fermat", "Noether",
];

/* Trois tempéraments, pour que plusieurs bots ne jouent pas comme un seul.
   `seuilSuivi` et `seuilRelance` s'expriment en multiples de la cote du
   pot : 1,0 signifie « suivre dès que c'est tout juste rentable ». */
const PROFILS = [
  { nom: "prudent", seuilSuivi: 1.12, seuilRelance: 1.60, bluff: 0.03, taille: 0.50, marge: 0.15 },
  { nom: "posé",    seuilSuivi: 0.98, seuilRelance: 1.38, bluff: 0.07, taille: 0.62, marge: 0.11 },
  { nom: "large",   seuilSuivi: 0.84, seuilRelance: 1.20, bluff: 0.13, taille: 0.78, marge: 0.07 },
];

export function profilAuHasard() {
  return PROFILS[Math.floor(Math.random() * PROFILS.length)];
}

/* Le temps qu'il « réfléchit ». Un bot qui répond dans l'instant casse le
   rythme de la table et donne l'impression d'un automate ; une décision
   gratuite se prend plus vite qu'une décision qui coûte. */
export function delaiReflexion(options) {
  const base = 600 + Math.random() * 1000;
  return Math.round(options.checker ? base * 0.65 : base);
}

/* Taille de mise : une fraction du pot, d'autant plus grande que la main
   est bonne et le tempérament agressif. */
function tailleDeMise(options, profil, equite) {
  const fraction = profil.taille * (0.65 + equite * 0.7);
  const potApresSuivi = options.pot + options.suivre;
  let cible = options.maMise + options.suivre + Math.round(potApresSuivi * fraction);

  if (equite > 0.9 && Math.random() < 0.45) {
    // Main écrasante : le tapis devient une option, sans être systématique —
    // sinon le bot devient lisible.
    cible = options.maxiRelance;
  } else if (equite < 0.75) {
    // Une main ordinaire n'engage pas tout le tapis. Sans ce plafond, les
    // relances taille-du-pot s'enchaînent sur un pot qui grossit et
    // finissent invariablement à tapis.
    const moitieDuTapis = options.maMise + Math.round((options.tapis + options.maMise) * 0.5);
    cible = Math.min(cible, moitieDuTapis);
  }

  return Math.max(options.miniRelance, Math.min(options.maxiRelance, cible));
}

/* ------------------------------------------------------------
   La décision. `mesCartes` sont les seules cartes privées connues :
   celles du bot qui parle.
   ------------------------------------------------------------ */
export function decider({ mesCartes, board, adversaires, options, profil }) {
  const equite = equiteSynchrone({ mesCartes, board, adversaires }, ECHANTILLONS);

  // Sans équité calculable (cas dégénéré), on ne prend aucun risque.
  if (equite === null) return { action: options.checker ? "checker" : "coucher" };

  // --- Rien à payer : on checke ou on ouvre ---
  // Le seuil d'ouverture se mesure par rapport à la part équitable du pot,
  // pas dans l'absolu : à six joueurs elle ne vaut qu'un sixième, et exiger
  // une équité de 58 % reviendrait à ne jamais miser.
  const partEquitable = 1 / (adversaires + 1);
  if (options.checker) {
    const ouvre = equite > partEquitable + profil.marge || Math.random() < profil.bluff;
    if (ouvre && options.peutRelancer) {
      return { action: "relancer", montant: tailleDeMise(options, profil, equite), equite };
    }
    return { action: "checker", equite };
  }

  // --- Il faut payer : on compare l'équité à la cote du pot ---
  // Cote du pot = part du pot final que représente la mise à payer, donc
  // l'équité minimale au-delà de laquelle suivre rapporte.
  const coteDuPot = options.suivre / (options.pot + options.suivre);
  const rapport = equite / coteDuPot;

  // Sur-relancer une grosse mise demande bien plus qu'un léger avantage :
  // c'est ce qui empêche deux bots de s'entraîner dans une escalade.
  const miseDejaGrosse = options.suivre > options.pot * 0.6;
  const seuilRelance = profil.seuilRelance * (miseDejaGrosse ? 1.45 : 1);

  if (rapport >= seuilRelance && options.peutRelancer) {
    return { action: "relancer", montant: tailleDeMise(options, profil, equite), equite };
  }

  // On ne se couche pas pour une poussière quand il reste un gros tapis :
  // payer deux jetons pour voir une carte n'a pas besoin d'être rentable.
  const partDuTapis = options.suivre / Math.max(1, options.tapis + options.maMise);
  if (rapport >= profil.seuilSuivi || partDuTapis < 0.02) {
    return { action: "suivre", equite };
  }

  // Bluff occasionnel, seulement une fois le board ouvert : bluffer à
  // l'aveugle préflop ne raconte aucune histoire crédible.
  if (board.length >= 3 && options.peutRelancer && Math.random() < profil.bluff) {
    return { action: "relancer", montant: tailleDeMise(options, profil, equite), equite };
  }

  return { action: "coucher", equite };
}
