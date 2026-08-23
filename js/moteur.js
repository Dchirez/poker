/* ============================================================
   MOTEUR DE PARTIE — Texas Hold'em, cash game, 6 sièges
   Le moteur est pur : il ne connaît ni le réseau ni le DOM.
   L'hôte l'exécute, applique les actions reçues et diffuse
   l'état. C'est la seule source de vérité de la partie.
   ============================================================ */

import { paquetMelange, evaluer, nommer, nomCarte } from "./mains.js";

export const MAX_SIEGES = 6;

export function creerPartie(config = {}) {
  return {
    config: {
      petiteBlinde:    config.petiteBlinde    ?? 10,
      grosseBlinde:    config.grosseBlinde    ?? 20,
      tapisDepart:     config.tapisDepart     ?? 2000,
      secondesParTour: config.secondesParTour ?? 45,   // 0 = pas de pendule
      // Aide au jeu : chaque client calcule sa propre équité, en local.
      // Le moteur ne fait que transporter le réglage pour que la table
      // entière joue avec les mêmes règles du jeu.
      equite: config.equite ?? false,
    },
    sieges: Array(MAX_SIEGES).fill(null),
    bouton: -1,
    phase: "attente",       // attente | preflop | flop | turn | river
    board: [],
    paquet: [],
    pot: 0,
    pots: [],               // pots latéraux calculés en fin de main
    miseCourante: 0,
    relanceMin: 0,
    tour: -1,
    numeroMain: 0,
    echeance: 0,            // horodatage de fin du temps de réflexion
    journal: [],
    resultats: null,        // détail de l'abattage, affiché en fin de main
  };
}

/* ---------- Journal ---------- */

function noter(p, texte) {
  p.journal.push({ main: p.numeroMain, texte, t: Date.now() });
  if (p.journal.length > 200) p.journal.splice(0, p.journal.length - 200);
}

/* ---------- Sièges ---------- */

export function siegeDe(p, idJoueur) {
  return p.sieges.findIndex((j) => j && j.id === idJoueur);
}

export function asseoir(p, siege, idJoueur, nom) {
  if (siege < 0 || siege >= MAX_SIEGES) return { ok: false, raison: "Siège inexistant" };
  if (p.sieges[siege]) return { ok: false, raison: "Siège déjà occupé" };
  if (siegeDe(p, idJoueur) >= 0) return { ok: false, raison: "Vous êtes déjà assis" };

  p.sieges[siege] = {
    id: idJoueur, nom, tapis: p.config.tapisDepart, absent: false,
    enJeu: false, cartes: [], mise: 0, total: 0,
    couche: false, allin: false, aParle: false, derniereAction: "",
  };
  noter(p, nom + " prend le siège " + (siege + 1));
  return { ok: true };
}

export function lever(p, idJoueur) {
  const s = siegeDe(p, idJoueur);
  if (s < 0) return { ok: false, raison: "Vous n'êtes pas assis" };
  const j = p.sieges[s];
  const enPleineMain = j.enJeu && !j.couche && p.phase !== "attente";

  noter(p, j.nom + " quitte la table" + (enPleineMain ? " (main abandonnée)" : ""));
  // Quitter au milieu d'une main revient à se coucher : la mise reste au pot.
  // On couche le joueur avant de libérer le siège pour que la main puisse
  // se résoudre proprement, puis on relance l'enchaînement.
  if (enPleineMain) {
    j.couche = true;
    j.aParle = true;
    j.id = null;                 // le siège ne répond plus, mais reste dans les pots
    j.absent = true;
    j.nom = j.nom + " (parti)";
    if (p.tour === s) verifierFinDeTour(p);
    else verifierFinDeTour(p);
  } else {
    p.sieges[s] = null;
  }
  return { ok: true };
}

export function marquerAbsent(p, idJoueur, absent) {
  const s = siegeDe(p, idJoueur);
  if (s < 0) return;
  const j = p.sieges[s];
  if (j.absent === absent) return;
  j.absent = absent;
  noter(p, j.nom + (absent ? " s'est déconnecté" : " est de retour"));
  // Un joueur absent à qui c'est le tour ne doit pas bloquer la table.
  if (absent && p.tour === s && p.phase !== "attente") actionAutomatique(p, s);
}

export function recaver(p, idJoueur) {
  const s = siegeDe(p, idJoueur);
  if (s < 0) return { ok: false, raison: "Vous n'êtes pas assis" };
  const j = p.sieges[s];
  if (j.enJeu && p.phase !== "attente") return { ok: false, raison: "Recave impossible pendant votre main" };
  if (j.tapis >= p.config.tapisDepart) return { ok: false, raison: "Votre tapis est déjà complet" };
  const montant = p.config.tapisDepart - j.tapis;
  j.tapis = p.config.tapisDepart;
  noter(p, j.nom + " recave " + montant);
  return { ok: true };
}

/* Joueurs capables de participer à la prochaine main. Un joueur déconnecté
   est mis en pause plutôt que distribué : il ne perd pas ses blindes pendant
   son absence et retrouve son tapis intact en revenant. */
function joueursPrets(p) {
  return p.sieges.map((j, i) => ({ j, i }))
    .filter((x) => x.j && x.j.tapis > 0 && x.j.id && !x.j.absent);
}

/* ---------- Parcours des sièges ---------- */

function suivantOccupe(p, depuis, filtre) {
  for (let k = 1; k <= MAX_SIEGES; k++) {
    const i = (depuis + k + MAX_SIEGES) % MAX_SIEGES;
    const j = p.sieges[i];
    if (j && filtre(j)) return i;
  }
  return -1;
}

const actifs   = (p) => p.sieges.map((j, i) => ({ j, i })).filter((x) => x.j && x.j.enJeu && !x.j.couche);
const parlants = (p) => actifs(p).filter((x) => !x.j.allin);

/* ---------- Démarrage d'une main ---------- */

export function peutDemarrer(p) {
  return p.phase === "attente" && joueursPrets(p).length >= 2;
}

export function demarrerMain(p) {
  if (!peutDemarrer(p)) return { ok: false, raison: "Il faut au moins deux joueurs avec des jetons" };

  p.numeroMain++;
  p.board = [];
  p.pot = 0;
  p.pots = [];
  p.miseCourante = 0;
  p.resultats = null;
  p.paquet = paquetMelange();
  p.phase = "preflop";

  // Les sièges libérés en cours de main précédente disparaissent maintenant.
  for (let i = 0; i < MAX_SIEGES; i++) if (p.sieges[i] && !p.sieges[i].id) p.sieges[i] = null;

  // Tous les sièges repartent à zéro, y compris ceux qui ne jouent pas la
  // main : un `total` oublié fausserait le calcul des pots latéraux.
  for (const j of p.sieges) {
    if (!j) continue;
    j.cartes = []; j.mise = 0; j.total = 0;
    j.couche = false; j.allin = false; j.aParle = false; j.derniereAction = "";
    j.enJeu = false;
  }
  // Seuls les joueurs présents et pourvus de jetons reçoivent des cartes.
  for (const { j } of joueursPrets(p)) j.enJeu = true;

  // Le bouton avance jusqu'au prochain joueur en jeu.
  p.bouton = suivantOccupe(p, p.bouton, (j) => j.enJeu);
  noter(p, "— Main #" + p.numeroMain + " —");

  const enJeu = actifs(p);
  const teteATete = enJeu.length === 2;
  const { petiteBlinde: sb, grosseBlinde: bb } = p.config;

  // Tête-à-tête : le bouton est petite blinde et parle en premier préflop,
  // en dernier ensuite. À trois joueurs ou plus, les blindes suivent le bouton.
  const siegeSB = teteATete ? p.bouton : suivantOccupe(p, p.bouton, (j) => j.enJeu);
  const siegeBB = suivantOccupe(p, siegeSB, (j) => j.enJeu);

  poserBlinde(p, siegeSB, sb, "petite blinde");
  poserBlinde(p, siegeBB, bb, "grosse blinde");
  p.miseCourante = bb;
  p.relanceMin = bb;

  // Deux cartes par joueur, distribuées une à une à partir de la petite blinde.
  for (let tour = 0; tour < 2; tour++) {
    let i = siegeSB;
    for (let k = 0; k < enJeu.length; k++) {
      p.sieges[i].cartes.push(p.paquet.pop());
      i = suivantOccupe(p, i, (j) => j.enJeu);
    }
  }

  // Préflop, la parole ouvre à gauche de la grosse blinde ; en tête-à-tête
  // c'est le bouton. La grosse blinde garde son option de relance : elle n'a
  // pas encore « parlé ».
  ouvrirTour(p, teteATete ? p.bouton : suivantOccupe(p, siegeBB, (j) => j.enJeu));
  return { ok: true };
}

/* Donne la parole à `premier`. S'il ne peut pas parler — déjà à tapis en
   posant sa blinde, par exemple — la parole glisse au joueur suivant, et si
   personne ne peut miser la rue s'enchaîne d'elle-même. */
function ouvrirTour(p, premier) {
  p.tour = premier;
  const j = premier >= 0 ? p.sieges[premier] : null;
  if (j && j.enJeu && !j.couche && !j.allin) { armerPendule(p); return; }
  verifierFinDeTour(p);
}

function poserBlinde(p, siege, montant, libelle) {
  const j = p.sieges[siege];
  const delta = Math.min(montant, j.tapis);
  j.tapis -= delta; j.mise += delta; j.total += delta; p.pot += delta;
  if (j.tapis === 0) j.allin = true;
  j.derniereAction = libelle;
  noter(p, j.nom + " pose la " + libelle + " (" + delta + ")");
}

/* ---------- Actions ---------- */

export function actionsPossibles(p, idJoueur) {
  const s = siegeDe(p, idJoueur);
  if (s < 0 || p.tour !== s || p.phase === "attente") return null;
  const j = p.sieges[s];
  if (!j.enJeu || j.couche || j.allin) return null;

  const aSuivre = Math.min(p.miseCourante - j.mise, j.tapis);
  const maxi = j.mise + j.tapis;                        // mise totale si tapis
  const miniRelance = Math.min(p.miseCourante + p.relanceMin, maxi);

  return {
    coucher: true,
    checker: aSuivre === 0,
    suivre: aSuivre > 0 ? aSuivre : 0,
    // On ne peut relancer que s'il reste des jetons au-delà du simple suivi.
    peutRelancer: maxi > p.miseCourante,
    miniRelance,
    maxiRelance: maxi,
    miseCourante: p.miseCourante,
    maMise: j.mise,
    tapis: j.tapis,
    pot: p.pot,
  };
}

export function agir(p, idJoueur, action, montant = 0) {
  const s = siegeDe(p, idJoueur);
  if (s < 0) return { ok: false, raison: "Vous n'êtes pas à la table" };
  if (p.tour !== s) return { ok: false, raison: "Ce n'est pas votre tour" };
  const opts = actionsPossibles(p, idJoueur);
  if (!opts) return { ok: false, raison: "Aucune action possible" };
  const j = p.sieges[s];

  switch (action) {
    case "coucher":
      j.couche = true; j.derniereAction = "Couche";
      noter(p, j.nom + " se couche");
      break;

    case "checker":
      if (!opts.checker) return { ok: false, raison: "Impossible de checker, il y a une mise" };
      j.derniereAction = "Check";
      noter(p, j.nom + " checke");
      break;

    case "suivre": {
      if (opts.suivre <= 0) return { ok: false, raison: "Rien à suivre" };
      const paye = engager(p, j, p.miseCourante);
      j.derniereAction = j.allin ? "Tapis" : "Suit " + paye;
      noter(p, j.nom + (j.allin ? " suit à tapis (" + paye + ")" : " suit (" + paye + ")"));
      break;
    }

    case "relancer": {
      if (!opts.peutRelancer) return { ok: false, raison: "Relance impossible" };
      let cible = Math.round(montant);
      if (cible > opts.maxiRelance) cible = opts.maxiRelance;
      const estTapis = cible >= opts.maxiRelance;
      if (!estTapis && cible < opts.miniRelance) {
        return { ok: false, raison: "Relance minimum : " + opts.miniRelance };
      }
      if (cible <= p.miseCourante && !estTapis) {
        return { ok: false, raison: "La relance doit dépasser la mise courante" };
      }
      const increment = cible - p.miseCourante;
      const ouvrait = p.miseCourante === 0;
      engager(p, j, cible);

      // Un tapis inférieur à une relance complète ne rouvre pas les enchères :
      // ceux qui ont déjà suivi ne reprennent pas la parole.
      if (increment >= p.relanceMin) {
        p.relanceMin = increment;
        for (const { j: autre } of parlants(p)) if (autre !== j) autre.aParle = false;
      }
      if (cible > p.miseCourante) p.miseCourante = cible;
      j.derniereAction = j.allin ? "Tapis " + cible : (ouvrait ? "Mise " + cible : "Relance à " + cible);
      noter(p, j.nom + " " + (j.allin ? "fait tapis à " + cible : (ouvrait ? "mise " + cible : "relance à " + cible)));
      break;
    }

    default:
      return { ok: false, raison: "Action inconnue" };
  }

  j.aParle = true;
  verifierFinDeTour(p);
  return { ok: true };
}

/* Porte la mise d'un joueur à `cible` (bornée par son tapis) et retourne
   ce qu'il vient effectivement de payer. */
function engager(p, j, cible) {
  const delta = Math.min(cible - j.mise, j.tapis);
  j.tapis -= delta; j.mise += delta; j.total += delta; p.pot += delta;
  if (j.tapis === 0) j.allin = true;
  return delta;
}

/* Action jouée à la place d'un joueur absent ou à court de temps :
   on checke si c'est gratuit, sinon on se couche. */
export function actionAutomatique(p, siege) {
  const j = p.sieges[siege];
  if (!j || !j.id || p.tour !== siege) return;
  const opts = actionsPossibles(p, j.id);
  if (!opts) return;
  agir(p, j.id, opts.checker ? "checker" : "coucher");
}

/* ---------- Enchaînement des rues ---------- */

function tourTermine(p) {
  const debout = parlants(p);
  if (debout.length === 0) return true;
  return debout.every((x) => x.j.aParle && x.j.mise === p.miseCourante);
}

function verifierFinDeTour(p) {
  // Tout le monde s'est couché sauf un : la main s'arrête là.
  if (actifs(p).length <= 1) return terminerMain(p);

  if (!tourTermine(p)) {
    // On cherche le prochain joueur qui doit parler : soit il n'a pas encore
    // parlé, soit une relance l'oblige à compléter sa mise.
    const cible = suivantOccupe(p, p.tour, (j) =>
      j.enJeu && !j.couche && !j.allin && (!j.aParle || j.mise < p.miseCourante));
    if (cible >= 0) { p.tour = cible; armerPendule(p); return; }
  }

  rueSuivante(p);
}

function rueSuivante(p) {
  // Les mises sont déjà dans le pot : on remet seulement les compteurs de rue à zéro.
  for (const j of p.sieges) if (j) { j.mise = 0; j.aParle = false; }
  p.miseCourante = 0;
  p.relanceMin = p.config.grosseBlinde;

  // S'il reste au plus un joueur capable de miser, plus personne ne parle :
  // on déroule le board d'un coup jusqu'à l'abattage.
  const encoreDesEncheres = parlants(p).length >= 2;

  if (p.phase === "preflop") {
    p.paquet.pop();                                   // carte brûlée
    p.board.push(p.paquet.pop(), p.paquet.pop(), p.paquet.pop());
    p.phase = "flop";
  } else if (p.phase === "flop") {
    p.paquet.pop(); p.board.push(p.paquet.pop()); p.phase = "turn";
  } else if (p.phase === "turn") {
    p.paquet.pop(); p.board.push(p.paquet.pop()); p.phase = "river";
  } else {
    return terminerMain(p);
  }

  noter(p, p.phase.toUpperCase() + " : " + p.board.map(nomCarte).join(" "));

  if (!encoreDesEncheres) { p.tour = -1; return rueSuivante(p); }

  for (const j of p.sieges) if (j) j.derniereAction = "";
  // Postflop, la parole ouvre à gauche du bouton — en tête-à-tête, cela
  // place le bouton en dernier, comme il se doit.
  ouvrirTour(p, suivantOccupe(p, p.bouton, (j) => j.enJeu && !j.couche && !j.allin));
}

/* ---------- Pots latéraux ---------- */

/* Découpe le pot en couches selon les tapis engagés : chaque couche n'est
   disputable que par ceux qui l'ont payée intégralement. */
export function construirePots(p) {
  const engages = p.sieges.map((j, i) => ({ j, i })).filter((x) => x.j && x.j.total > 0);
  if (engages.length === 0) return [];

  const paliers = [...new Set(engages.map((x) => x.j.total))].sort((a, b) => a - b);
  const couches = [];
  let precedent = 0;

  for (const palier of paliers) {
    const tranche = palier - precedent;
    const payeurs = engages.filter((x) => x.j.total >= palier);
    const montant = tranche * payeurs.length;
    const eligibles = payeurs.filter((x) => !x.j.couche).map((x) => x.i);
    if (montant > 0) couches.push({ montant, eligibles });
    precedent = palier;
  }

  // Deux couches successives ouvertes aux mêmes joueurs forment un seul pot.
  // Une couche que plus personne ne dispute (tous ses payeurs se sont couchés)
  // est reversée à la couche du dessous plutôt que d'être perdue.
  const pots = [];
  for (const couche of couches) {
    const dernier = pots[pots.length - 1];
    const memeLot = dernier
      && dernier.eligibles.length === couche.eligibles.length
      && dernier.eligibles.every((s, k) => s === couche.eligibles[k]);
    if (couche.eligibles.length === 0 && dernier) dernier.montant += couche.montant;
    else if (memeLot) dernier.montant += couche.montant;
    else pots.push({ ...couche });
  }
  return pots;
}

/* ---------- Fin de main ---------- */

/* Rend au joueur ce que personne n'a couvert. Si vous misez 500 face à un
   adversaire qui ne peut suivre que 300, les 200 excédentaires n'ont jamais
   été disputés : ils retournent à votre tapis avant le partage du pot. */
function rendreMisesNonSuivies(p) {
  const engages = p.sieges.map((j, i) => ({ j, i })).filter((x) => x.j && x.j.total > 0);
  if (engages.length < 2) {
    // Cas limite : un seul joueur a mis des jetons, il les récupère.
    for (const { j } of engages) { j.tapis += j.total; p.pot -= j.total; j.total = 0; }
    return;
  }
  const totaux = engages.map((x) => x.j.total).sort((a, b) => b - a);
  const plafond = totaux[1];                    // le deuxième plus gros engagement
  for (const { j } of engages) {
    if (j.total <= plafond) continue;
    const surplus = j.total - plafond;
    j.tapis += surplus; j.total -= surplus; p.pot -= surplus;
    if (j.mise >= surplus) j.mise -= surplus;
    noter(p, j.nom + " récupère " + surplus + " (mise non suivie)");
  }
}

function terminerMain(p) {
  p.tour = -1;
  p.echeance = 0;
  rendreMisesNonSuivies(p);
  const pots = construirePots(p);
  p.pots = pots;
  const restants = actifs(p);
  const resultats = { abattage: restants.length > 1, mains: [], gains: [], board: [...p.board] };

  if (restants.length <= 1) {
    // Victoire sans abattage : les cartes ne sont pas montrées.
    const total = pots.reduce((s, x) => s + x.montant, 0);
    if (restants.length === 1) {
      const gagnant = restants[0];
      gagnant.j.tapis += total;
      resultats.gains.push({ siege: gagnant.i, nom: gagnant.j.nom, montant: total, main: "" });
      noter(p, gagnant.j.nom + " remporte " + total + " (tous les autres se sont couchés)");
    }
  } else {
    // Force de chaque main encore en lice.
    const forces = new Map();
    for (const { j, i } of restants) {
      const res = evaluer([...j.cartes, ...p.board]);
      forces.set(i, res);
      resultats.mains.push({
        siege: i, nom: j.nom, cartes: [...j.cartes],
        libelle: nommer(res), meilleures: res.cartes,
      });
    }

    for (const pot of pots) {
      const candidats = pot.eligibles.filter((s) => forces.has(s));
      if (candidats.length === 0) continue;
      const meilleur = Math.max(...candidats.map((s) => forces.get(s).score));
      const vainqueurs = candidats.filter((s) => forces.get(s).score === meilleur);

      const part = Math.floor(pot.montant / vainqueurs.length);
      let reste = pot.montant - part * vainqueurs.length;
      const beneficiaireReste = premierApresBouton(p, vainqueurs);
      for (const s of vainqueurs) {
        let gain = part;
        // Les jetons non divisibles vont au premier joueur à gauche du bouton.
        if (reste > 0 && s === beneficiaireReste) { gain += reste; reste = 0; }
        p.sieges[s].tapis += gain;
        resultats.gains.push({ siege: s, nom: p.sieges[s].nom, montant: gain, main: nommer(forces.get(s)) });
        noter(p, p.sieges[s].nom + " remporte " + gain + " avec " + nommer(forces.get(s)));
      }
    }
  }

  p.resultats = resultats;
  p.phase = "attente";
  for (const j of p.sieges) if (j) { j.enJeu = false; j.mise = 0; j.aParle = false; }
}

function premierApresBouton(p, sieges) {
  for (let k = 1; k <= MAX_SIEGES; k++) {
    const i = (p.bouton + k) % MAX_SIEGES;
    if (sieges.includes(i)) return i;
  }
  return sieges[0];
}

/* ---------- Pendule ---------- */

function armerPendule(p) {
  p.echeance = p.config.secondesParTour > 0
    ? Date.now() + p.config.secondesParTour * 1000
    : 0;
}

/* ---------- État diffusé ---------- */

/* État public : identique pour tout le monde, sans aucune carte privée.
   Les cartes du destinataire sont ajoutées par `etatPour`. */
export function etatPublic(p) {
  const abattage = !!(p.resultats && p.resultats.abattage);
  const montres = abattage ? new Set(p.resultats.mains.map((m) => m.siege)) : new Set();

  return {
    config: p.config,
    phase: p.phase,
    board: [...p.board],
    pot: p.pot,
    pots: p.pots.map((x) => ({ montant: x.montant, eligibles: [...x.eligibles] })),
    miseCourante: p.miseCourante,
    relanceMin: p.relanceMin,
    bouton: p.bouton,
    tour: p.tour,
    numeroMain: p.numeroMain,
    echeance: p.echeance,
    resultats: p.resultats,
    journal: p.journal.slice(-40),
    sieges: p.sieges.map((j, i) => j && {
      nom: j.nom, tapis: j.tapis, mise: j.mise, total: j.total,
      couche: j.couche, allin: j.allin, enJeu: j.enJeu, absent: j.absent,
      derniereAction: j.derniereAction,
      nbCartes: j.cartes.length,
      // Seul l'abattage révèle des cartes, et uniquement celles encore en lice.
      cartes: montres.has(i) ? [...j.cartes] : null,
    }),
  };
}

export function etatPour(p, idJoueur) {
  const etat = etatPublic(p);
  const s = siegeDe(p, idJoueur);
  etat.monSiege = s;
  etat.mesCartes = s >= 0 ? [...p.sieges[s].cartes] : [];
  etat.mesActions = s >= 0 ? actionsPossibles(p, idJoueur) : null;
  etat.peutDemarrer = peutDemarrer(p);
  return etat;
}
