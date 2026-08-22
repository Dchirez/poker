/* ============================================================
   VUE — projection de l'état de la partie dans le DOM.
   La vue ne décide rien : elle reçoit un état déjà calculé et
   remonte les intentions du joueur via les rappels de `contexte`.
   ============================================================ */

import { VALEURS, COULEURS, couleurDe, estRouge } from "./mains.js";
import { MAX_SIEGES } from "./moteur.js";

const $ = (id) => document.getElementById(id);

const LIBELLE_PHASE = {
  attente: "", preflop: "Préflop", flop: "Le flop",
  turn: "Le turn", river: "La river",
};

/* Formatage des jetons : 12 400 plutôt que 12400. */
export const jetons = (n) => (n ?? 0).toLocaleString("fr-FR");

/* Cartes à surligner à l'abattage : seulement celles de la combinaison
   gagnante. Prendre l'union des meilleures mains de tous les joueurs
   reviendrait à éclairer presque tout le tapis, ce qui ne dit plus rien. */
function cartesGagnantes(etat) {
  const retenues = new Set();
  const r = etat.resultats;
  if (!r || !r.abattage) return retenues;
  const vainqueurs = new Set(r.gains.map((g) => g.siege));
  for (const m of r.mains) {
    if (vainqueurs.has(m.siege)) for (const c of m.meilleures) retenues.add(c);
  }
  return retenues;
}

/* ---------- Cartes ---------- */

function elementCarte(carte, options = {}) {
  const el = document.createElement("div");
  el.className = "carte";
  if (carte === null || carte === undefined) {
    el.classList.add(options.dos ? "dos" : "vide");
    return el;
  }
  if (estRouge(carte)) el.classList.add("rouge");
  if (options.retenue) el.classList.add("retenue");
  const v = document.createElement("span");
  v.className = "valeur"; v.textContent = VALEURS[carte % 13];
  const c = document.createElement("span");
  c.className = "couleur"; c.textContent = COULEURS[couleurDe(carte)];
  el.append(v, c);
  return el;
}

/* ---------- Cartes communes ---------- */

function rendreBoard(etat) {
  const board = $("board");
  board.replaceChildren();
  // On garde les cinq emplacements visibles dès le début de la main :
  // la progression de la donne se lit d'un coup d'œil.
  const enMain = etat.phase !== "attente" || etat.board.length > 0;
  const retenues = cartesGagnantes(etat);
  for (let i = 0; i < 5; i++) {
    const carte = etat.board[i];
    if (carte === undefined) {
      if (enMain) board.append(elementCarte(null));
    } else {
      board.append(elementCarte(carte, { retenue: retenues.has(carte) }));
    }
  }
}

/* ---------- Sièges ---------- */

function rendreSieges(etat, contexte) {
  const conteneur = $("sieges");
  conteneur.replaceChildren();

  const gainsParSiege = new Map();
  const mainsParSiege = new Map();
  if (etat.resultats) {
    for (const g of etat.resultats.gains) {
      gainsParSiege.set(g.siege, (gainsParSiege.get(g.siege) || 0) + g.montant);
      if (g.main) mainsParSiege.set(g.siege, g.main);
    }
    for (const m of etat.resultats.mains || []) mainsParSiege.set(m.siege, m.libelle);
  }
  const retenues = cartesGagnantes(etat);

  // La table pivote pour que le joueur local occupe toujours le bas.
  const ancre = etat.monSiege >= 0 ? etat.monSiege : 0;

  for (let siege = 0; siege < MAX_SIEGES; siege++) {
    const position = (siege - ancre + MAX_SIEGES) % MAX_SIEGES;
    const el = document.createElement("div");
    el.className = "siege pos-" + position;

    const joueur = etat.sieges[siege];

    if (!joueur) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "siege-libre";
      const dejaAssis = etat.monSiege >= 0;
      bouton.textContent = dejaAssis ? "Libre" : "S'asseoir";
      bouton.disabled = dejaAssis;
      if (!dejaAssis) bouton.addEventListener("click", () => contexte.surAsseoir(siege));
      el.append(bouton);
      conteneur.append(el);
      continue;
    }

    const cestMoi = siege === etat.monSiege;
    if (cestMoi) el.classList.add("moi");
    if (joueur.couche) el.classList.add("couche");
    if (joueur.absent) el.classList.add("absent");
    if (etat.tour === siege) el.classList.add("actif");
    if (gainsParSiege.get(siege) > 0) el.classList.add("gagnant");

    // Cartes : les miennes en clair, celles des autres face cachée,
    // sauf à l'abattage où le moteur révèle les mains encore en lice.
    const cartes = document.createElement("div");
    cartes.className = "siege-cartes";
    const visibles = cestMoi ? etat.mesCartes : joueur.cartes;
    if (visibles && visibles.length) {
      for (const c of visibles) cartes.append(elementCarte(c, { retenue: retenues.has(c) }));
    } else {
      for (let k = 0; k < joueur.nbCartes; k++) cartes.append(elementCarte(null, { dos: true }));
    }

    const boite = document.createElement("div");
    boite.className = "siege-boite";

    const nom = document.createElement("div");
    nom.className = "siege-nom";
    nom.textContent = joueur.nom;
    nom.title = joueur.nom;

    const tapis = document.createElement("div");
    tapis.className = "siege-tapis";
    tapis.textContent = joueur.allin && joueur.tapis === 0 ? "TAPIS" : jetons(joueur.tapis);

    boite.append(nom, tapis);

    if (etat.bouton === siege) {
      const jeton = document.createElement("span");
      jeton.className = "jeton-bouton";
      jeton.title = "Bouton du donneur";
      jeton.textContent = "D";
      boite.append(jeton);
    }

    const action = document.createElement("div");
    action.className = "siege-action";
    action.textContent = joueur.derniereAction || "";

    el.append(cartes, boite, action);

    if (joueur.mise > 0) {
      const mise = document.createElement("div");
      mise.className = "siege-mise";
      mise.textContent = jetons(joueur.mise);
      el.append(mise);
    }

    const gain = gainsParSiege.get(siege);
    if (gain > 0) {
      const g = document.createElement("div");
      g.className = "siege-gain";
      g.textContent = "+" + jetons(gain);
      el.append(g);
    }
    const libelleMain = mainsParSiege.get(siege);
    if (libelleMain) {
      const m = document.createElement("div");
      m.className = "siege-main";
      m.textContent = libelleMain;
      el.append(m);
    }

    conteneur.append(el);
  }
}

/* ---------- Centre du tapis ---------- */

function rendreCentre(etat) {
  const pot = $("pot");
  const annonce = $("annonce");

  const enMain = etat.phase !== "attente";
  pot.hidden = etat.pot <= 0;
  if (etat.pot > 0) {
    // En fin de main on affiche le détail des pots latéraux s'il y en a.
    const detail = (!enMain && etat.pots.length > 1)
      ? " (" + etat.pots.map((x) => jetons(x.montant)).join(" + ") + ")"
      : "";
    pot.innerHTML = "Pot <b>" + jetons(etat.pot) + "</b>" + detail;
  }

  if (etat.resultats && etat.resultats.gains.length) {
    // Plusieurs gagnants ne signifient pas forcément un pot partagé : avec des
    // pots latéraux, chacun remporte le sien. On annonce donc les montants.
    const g = etat.resultats.gains;
    annonce.textContent = g.length === 1
      ? g[0].nom + " remporte " + jetons(g[0].montant) + (g[0].main ? " — " + g[0].main : "")
      : g.map((x) => x.nom + " +" + jetons(x.montant)).join("  ·  ");
  } else if (enMain) {
    annonce.textContent = LIBELLE_PHASE[etat.phase] || "";
  } else {
    const assis = etat.sieges.filter(Boolean).length;
    annonce.textContent = assis < 2
      ? "En attente de joueurs"
      : "Prêt pour la main suivante";
  }
}

/* ---------- Journal ---------- */

let dernierJournal = 0;

function rendreJournal(etat) {
  const journal = $("journal");
  const empreinte = etat.journal.length ? etat.journal[etat.journal.length - 1].t : 0;
  if (empreinte === dernierJournal && journal.childElementCount) return;
  dernierJournal = empreinte;

  journal.replaceChildren();
  for (const ligne of etat.journal) {
    const li = document.createElement("li");
    li.textContent = ligne.texte;
    if (ligne.texte.startsWith("—")) li.className = "separateur";
    journal.append(li);
  }
  journal.scrollTop = journal.scrollHeight;
}

/* ---------- Barre d'action ---------- */

function rendreActions(etat, contexte) {
  const zone = $("actionsJeu");
  const message = $("messageAction");
  const o = etat.mesActions;
  const monTour = !!o;

  zone.hidden = !monTour;

  if (!monTour) {
    if (etat.monSiege < 0) {
      message.textContent = "Vous regardez la partie. Choisissez un siège libre pour jouer.";
    } else if (etat.phase === "attente") {
      message.textContent = etat.peutDemarrer
        ? (contexte.estHote ? "À vous de distribuer." : "En attente de l'hôte…")
        : "Il faut au moins deux joueurs avec des jetons.";
    } else if (etat.tour >= 0 && etat.sieges[etat.tour]) {
      message.textContent = "Au tour de " + etat.sieges[etat.tour].nom + "…";
    } else {
      message.textContent = "";
    }
    return;
  }

  message.textContent = "À vous de parler.";

  $("btnPasser").hidden = !o.checker;
  $("btnSuivre").hidden = o.suivre <= 0;
  $("btnSuivre").textContent = "Suivre " + jetons(o.suivre);
  $("btnRelancer").hidden = !o.peutRelancer;
  // Ouvrir les enchères ne s'appelle pas « relancer ».
  $("btnRelancer").textContent = o.miseCourante === 0 ? "Miser" : "Relancer";

  // Le curseur de mise est borné par la relance minimum et le tapis.
  const curseur = $("curseurMise");
  const saisie = $("saisieMise");
  const memeContexte = curseur.min === String(o.miniRelance) && curseur.max === String(o.maxiRelance);
  curseur.min = o.miniRelance; curseur.max = o.maxiRelance;
  saisie.min = o.miniRelance; saisie.max = o.maxiRelance;
  curseur.step = Math.max(1, Math.round(etat.config.grosseBlinde / 2));
  if (!memeContexte) {
    curseur.value = o.miniRelance;
    saisie.value = o.miniRelance;
  }
  // Pas de curseur quand la seule relance possible est le tapis.
  curseur.disabled = o.miniRelance >= o.maxiRelance;
}

/* ---------- Rendu complet ---------- */

export function rendre(etat, contexte) {
  rendreBoard(etat);
  rendreSieges(etat, contexte);
  rendreCentre(etat);
  rendreJournal(etat);
  rendreActions(etat, contexte);

  $("infoBlindes").textContent =
    "Blindes " + jetons(etat.config.petiteBlinde) + " / " + jetons(etat.config.grosseBlinde);
  $("infoMain").textContent = etat.numeroMain > 0 ? "Main n°" + etat.numeroMain : "Table ouverte";

  // Boutons hors partie
  const moi = etat.monSiege >= 0 ? etat.sieges[etat.monSiege] : null;
  $("actionsHote").hidden = !(contexte.estHote && etat.phase === "attente" && etat.peutDemarrer);
  $("btnRecaver").hidden = !(moi && etat.phase === "attente" && moi.tapis < etat.config.tapisDepart);
  $("btnSeLever").hidden = !moi;
}

/* ---------- Pendule ---------- */

export function rendrePendule(etat) {
  const pendule = $("pendule");
  const barre = $("penduleBarre");
  const actif = etat && etat.mesActions && etat.echeance > 0;
  pendule.hidden = !actif;
  if (!actif) return;

  const total = etat.config.secondesParTour * 1000;
  const restant = Math.max(0, etat.echeance - Date.now());
  const part = Math.max(0, Math.min(1, restant / total));
  barre.style.width = (part * 100).toFixed(1) + "%";
  pendule.classList.toggle("urgent", part < 0.25);
}

/* ---------- Écrans et messages ---------- */

export function montrerEcran(nom) {
  $("ecranAccueil").hidden = nom !== "accueil";
  $("ecranTable").hidden = nom !== "table";
}

export function erreurAccueil(texte) {
  const el = $("erreurAccueil");
  el.hidden = !texte;
  el.textContent = texte || "";
}

export function etatReseau(etat, texte) {
  const el = $("etatReseau");
  el.hidden = !etat;
  if (!etat) return;
  el.dataset.etat = etat;
  el.querySelector("span").textContent = texte;
}
