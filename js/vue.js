/* ============================================================
   VUE — projection de l'état de la partie dans le DOM.
   La vue ne décide rien : elle reçoit un état déjà calculé et
   remonte les intentions du joueur via les rappels de `contexte`.
   ============================================================ */

import {
  VALEURS, COULEURS, CATEGORIES, couleurDe, estRouge,
  evaluerPartielle, nommer, cartesSignificatives,
} from "./mains.js";
import { MAX_SIEGES } from "./moteur.js";

const $ = (id) => document.getElementById(id);

const LIBELLE_PHASE = {
  attente: "", preflop: "Préflop", flop: "Le flop",
  turn: "Le turn", river: "La river",
};

/* Formatage des jetons : 12 400 plutôt que 12400. */
export const jetons = (n) => (n ?? 0).toLocaleString("fr-FR");

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
  if (options.combinee) el.classList.add("combinee");
  const v = document.createElement("span");
  v.className = "valeur"; v.textContent = VALEURS[carte % 13];
  const c = document.createElement("span");
  c.className = "couleur"; c.textContent = COULEURS[couleurDe(carte)];
  el.append(v, c);
  return el;
}

/* Carte commune qui vient d'être retournée : deux faces dans un pivot 3D,
   dos vers le joueur au départ. L'animation CSS fait le reste. */
function elementCarteRetournee(carte, options = {}, delai = 0) {
  const boite = document.createElement("div");
  boite.className = "carte-boite";
  const pivot = document.createElement("div");
  pivot.className = "carte-pivot";
  pivot.style.animationDelay = delai + "ms";

  const dos = elementCarte(null, { dos: true });
  dos.classList.add("face-dos");
  const avant = elementCarte(carte, options);
  avant.classList.add("face-avant");

  pivot.append(dos, avant);
  boite.append(pivot);
  return boite;
}

/* ---------- Cartes à mettre en valeur ---------- */

/* À l'abattage : seulement la combinaison gagnante. Prendre l'union des
   meilleures mains de tous les joueurs reviendrait à éclairer presque tout
   le tapis, ce qui ne dit plus rien. */
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

/* Votre meilleure main du moment, recalculée à chaque carte du centre.
   Le calcul est purement local : un client ne connaît que ses propres
   cartes, c'est précisément ce qui empêche de voir celles des autres. */
function maMeilleureMain(etat) {
  if (etat.monSiege < 0 || !etat.mesCartes || etat.mesCartes.length === 0) return null;
  const res = evaluerPartielle([...etat.mesCartes, ...etat.board]);
  if (!res) return null;
  return { res, cartes: new Set(cartesSignificatives(res)), libelle: nommer(res) };
}

/* ---------- Cartes communes ---------- */

/* Mémoire du nombre de cartes déjà retournées : le rendu se rejoue à chaque
   message reçu, il ne faut animer que les cartes réellement nouvelles. */
let boardVu = { main: -1, nb: 0 };

function rendreBoard(etat, mise) {
  const board = $("board");
  if (etat.numeroMain !== boardVu.main) boardVu = { main: etat.numeroMain, nb: 0 };

  board.replaceChildren();
  const enMain = etat.phase !== "attente" || etat.board.length > 0;
  const retenues = cartesGagnantes(etat);

  for (let i = 0; i < 5; i++) {
    const carte = etat.board[i];
    if (carte === undefined) {
      // Les cinq emplacements restent visibles : la progression de la
      // donne se lit d'un coup d'œil.
      if (enMain) board.append(elementCarte(null));
      continue;
    }
    const options = {
      retenue: retenues.has(carte),
      combinee: !etat.resultats && mise && mise.cartes.has(carte),
    };
    if (i >= boardVu.nb) board.append(elementCarteRetournee(carte, options, (i - boardVu.nb) * 130));
    else board.append(elementCarte(carte, options));
  }
  boardVu.nb = etat.board.length;
}

/* ============================================================
   JETONS — décor
   Deux effets, sans aucune incidence sur la partie : des jetons qui
   filent du siège vers le centre à chaque mise, et un tas qui grossit
   au milieu du tapis, derrière les cartes communes.
   ============================================================ */

const NB_COLONNES_TAS = 5;
const HAUTEUR_MAX_TAS = 7;   // jetons empilés par colonne avant d'en ouvrir une

/* Mises déjà vues, pour ne lancer une animation que sur ce qui vient
   réellement d'être misé. Le rendu se rejoue à chaque message reçu. */
let misesVues = { main: -1, parSiege: [] };

/* On n'anime ni quand le joueur a demandé moins de mouvement, ni quand
   l'onglet est en arrière-plan — l'onglet de l'hôte y passe le plus clair
   de son temps, et les animations y sont suspendues. */
function animationsUtiles() {
  return !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Un jeton qui part d'un point du tapis et rejoint le pot, avec une
   légère cloche pour que la trajectoire ne soit pas une simple droite. */
function lancerJeton(depuis, vers, delai) {
  const tapis = $("tapis");
  const jeton = document.createElement("div");
  jeton.className = "jeton-vol";
  jeton.style.left = depuis.x + "px";
  jeton.style.top = depuis.y + "px";
  tapis.append(jeton);

  const dx = vers.x - depuis.x;
  const dy = vers.y - depuis.y;
  const animation = jeton.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 26}px)) scale(1.1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9)`, opacity: 1 },
    ],
    { duration: 520, delay: delai, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
  );
  // Filet de sécurité : si l'animation est suspendue (onglet masqué en
  // cours de vol, économie d'énergie), `onfinish` ne viendra jamais et le
  // jeton resterait sur le tapis. Le minuteur, lui, finit toujours.
  const retirer = () => jeton.remove();
  animation.onfinish = retirer;
  animation.oncancel = retirer;
  setTimeout(retirer, delai + 900);
}

/* Compare les mises à celles du rendu précédent et anime la différence. */
function animerMises(etat) {
  if (etat.numeroMain !== misesVues.main) {
    misesVues = { main: etat.numeroMain, parSiege: [] };
  }

  const tapis = $("tapis").getBoundingClientRect();
  const cible = { x: tapis.width / 2, y: tapis.height / 2 + tapis.height * 0.06 };
  const anime = animationsUtiles();

  for (let siege = 0; siege < MAX_SIEGES; siege++) {
    const joueur = etat.sieges[siege];
    const mise = joueur ? joueur.mise : 0;
    const avant = misesVues.parSiege[siege] || 0;
    misesVues.parSiege[siege] = mise;
    if (!anime || mise <= avant) continue;

    const el = $("sieges").querySelector(`.siege[data-siege="${siege}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const depuis = { x: r.left + r.width / 2 - tapis.left, y: r.top + r.height / 2 - tapis.top };

    // Trois jetons décalés : une mise se lit mieux qu'avec un seul disque.
    const nb = mise - avant >= etat.config.grosseBlinde * 4 ? 3 : 2;
    for (let i = 0; i < nb; i++) lancerJeton(depuis, cible, i * 70);
  }
}

/* Le tas au centre : sa taille suit le pot, en échelle logarithmique pour
   qu'un gros pot ne déborde pas du tapis. Purement indicatif. */
function rendrePileJetons(etat) {
  const pile = $("pileJetons");
  const bb = etat.config.grosseBlinde || 20;
  const nb = etat.pot > 0 ? Math.min(NB_COLONNES_TAS * HAUTEUR_MAX_TAS, Math.round(Math.log2(1 + etat.pot / bb) * 5)) : 0;

  // Le tas s'appuie sur le bas des cartes communes : les premiers jetons
  // dépassent en dessous, les suivants s'empilent derrière elles.
  const board = $("board");
  pile.style.top = (board.offsetTop + board.offsetHeight + 2) + "px";

  if (Number(pile.dataset.nb) === nb) return;   // rien de neuf à dessiner
  pile.dataset.nb = nb;
  pile.replaceChildren();

  for (let i = 0; i < nb; i++) {
    const colonne = i % NB_COLONNES_TAS;
    const etage = Math.floor(i / NB_COLONNES_TAS);
    const jeton = document.createElement("i");
    jeton.className = "jeton-tas t" + (i % 3);
    // Colonnes réparties de part et d'autre du centre, empilées vers le haut.
    jeton.style.left = (colonne - (NB_COLONNES_TAS - 1) / 2) * 20 + "px";
    jeton.style.top = -(etage * 5) + "px";
    jeton.style.zIndex = String(HAUTEUR_MAX_TAS - etage);
    pile.append(jeton);
  }
}

/* ---------- Sièges ---------- */

function rendreSieges(etat, contexte, mise) {
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
    el.dataset.siege = siege;          // repère pour l'animation des jetons

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

    // Cartes : les miennes en clair, celles des autres face cachée, sauf à
    // l'abattage où le moteur révèle les mains encore en lice.
    const cartes = document.createElement("div");
    cartes.className = "siege-cartes";
    const visibles = cestMoi ? etat.mesCartes : joueur.cartes;
    if (visibles && visibles.length) {
      for (const c of visibles) {
        cartes.append(elementCarte(c, {
          retenue: retenues.has(c),
          combinee: cestMoi && !etat.resultats && mise && mise.cartes.has(c),
        }));
      }
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

    el.append(cartes, boite);

    // Le jeton de mise dit déjà le montant engagé : afficher en plus
    // « MISE 120 » juste au-dessus ferait doublon et volerait une ligne.
    if (joueur.mise > 0) {
      const m = document.createElement("div");
      m.className = "siege-mise";
      m.textContent = jetons(joueur.mise);
      el.append(m);
    } else if (joueur.derniereAction) {
      const action = document.createElement("div");
      action.className = "siege-action";
      action.textContent = joueur.derniereAction;
      el.append(action);
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
      const lm = document.createElement("div");
      lm.className = "siege-main";
      lm.textContent = libelleMain;
      el.append(lm);
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
    const detail = (!enMain && etat.pots.length > 1)
      ? " (" + etat.pots.map((x) => jetons(x.montant)).join(" + ") + ")"
      : "";
    pot.innerHTML = "Pot <b>" + jetons(etat.pot) + "</b>" + detail;
  }

  if (etat.resultats && etat.resultats.gains.length) {
    // Plusieurs gagnants ne signifient pas forcément un pot partagé : avec
    // des pots latéraux, chacun remporte le sien. On annonce les montants.
    const g = etat.resultats.gains;
    annonce.textContent = g.length === 1
      ? g[0].nom + " remporte " + jetons(g[0].montant) + (g[0].main ? " — " + g[0].main : "")
      : g.map((x) => x.nom + " +" + jetons(x.montant)).join("  ·  ");
  } else if (enMain) {
    annonce.textContent = LIBELLE_PHASE[etat.phase] || "";
  } else {
    const assis = etat.sieges.filter(Boolean).length;
    annonce.textContent = assis < 2 ? "En attente de joueurs" : "Prêt pour la main suivante";
  }
}

/* ---------- Panneau « force des mains » ---------- */

/* Index d'une carte : couleur × 13 + (valeur − 2). 0 ♠, 1 ♥, 2 ♦, 3 ♣. */
const carte = (valeur, couleur) => couleur * 13 + (valeur - 2);

/* Un exemple parlant pour chaque combinaison, de la plus forte à la plus
   faible. Les cartes qui portent la combinaison viennent en premier. */
const EXEMPLES = [
  { cat: 9, cartes: [carte(14, 0), carte(13, 0), carte(12, 0), carte(11, 0), carte(10, 0)] },
  { cat: 8, cartes: [carte(9, 1), carte(8, 1), carte(7, 1), carte(6, 1), carte(5, 1)] },
  { cat: 7, cartes: [carte(9, 0), carte(9, 1), carte(9, 2), carte(9, 3), carte(13, 0)] },
  { cat: 6, cartes: [carte(12, 0), carte(12, 1), carte(12, 2), carte(7, 0), carte(7, 1)] },
  { cat: 5, cartes: [carte(14, 2), carte(11, 2), carte(9, 2), carte(5, 2), carte(3, 2)] },
  { cat: 4, cartes: [carte(9, 0), carte(8, 1), carte(7, 2), carte(6, 3), carte(5, 0)] },
  { cat: 3, cartes: [carte(9, 0), carte(9, 1), carte(9, 2), carte(13, 0), carte(5, 1)] },
  { cat: 2, cartes: [carte(13, 0), carte(13, 1), carte(8, 2), carte(8, 3), carte(5, 0)] },
  { cat: 1, cartes: [carte(13, 0), carte(13, 1), carte(9, 2), carte(6, 3), carte(3, 0)] },
  { cat: 0, cartes: [carte(14, 0), carte(11, 1), carte(8, 2), carte(6, 3), carte(3, 0)] },
];

let forceConstruite = false;

function construireForce() {
  if (forceConstruite) return;
  const liste = $("listeForce");
  liste.replaceChildren();

  EXEMPLES.forEach((ex, i) => {
    const li = document.createElement("li");
    li.className = "rang-main";
    li.dataset.categorie = ex.cat;

    const titre = document.createElement("div");
    titre.className = "rang-titre";
    const num = document.createElement("span");
    num.className = "rang-num"; num.textContent = i + 1;
    const nom = document.createElement("b");
    nom.textContent = CATEGORIES[ex.cat];
    titre.append(num, nom);

    const cartes = document.createElement("div");
    cartes.className = "rang-cartes";
    for (const c of ex.cartes) cartes.append(elementCarte(c));

    li.append(titre, cartes);
    liste.append(li);
  });
  forceConstruite = true;
}

/* Met en avant la combinaison que le joueur tient réellement. */
function rendreForce(mise) {
  construireForce();
  const courante = mise ? String(mise.res.categorie) : null;
  for (const li of $("listeForce").children) {
    li.classList.toggle("courante", li.dataset.categorie === courante);
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

/* ---------- Montants proposés ---------- */

/* Relance « pot » au sens usuel : on suit d'abord, puis on mise le pot ainsi
   constitué. Le résultat est borné par la relance minimum et par le tapis. */
export function montantRaccourci(o, fraction) {
  const brut = fraction === "max"
    ? o.maxiRelance
    : o.maMise + o.suivre + Math.round((o.pot + o.suivre) * Number(fraction));
  return Math.max(o.miniRelance, Math.min(o.maxiRelance, brut));
}

/* ---------- Barre d'action ---------- */

/* La barre reste en place en permanence, seulement grisée quand ce n'est pas
   votre tour : elle ne doit jamais disparaître ni changer de hauteur, sinon
   tout le bas de l'écran sursaute à chaque action d'un adversaire. */
function rendreActions(etat, contexte) {
  const message = $("messageAction");
  const o = etat.mesActions;
  const monTour = !!o;

  $("actionsJeu").classList.toggle("inactive", !monTour);

  if (monTour) {
    message.textContent = "À vous de parler.";
  } else if (etat.monSiege < 0) {
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

  // Les quatre actions restent affichées ; celles qui ne s'appliquent pas
  // sont désactivées plutôt que masquées, pour que la barre garde sa forme.
  $("btnCoucher").disabled = !monTour;
  $("btnPasser").disabled = !monTour || !o.checker;
  $("btnSuivre").disabled = !monTour || o.suivre <= 0;
  $("btnSuivre").textContent = monTour && o.suivre > 0 ? "Suivre " + jetons(o.suivre) : "Suivre";

  const peutMiser = monTour && o.peutRelancer;
  $("btnRelancer").disabled = !peutMiser;

  const curseur = $("curseurMise");
  const saisie = $("saisieMise");
  saisie.disabled = !peutMiser;
  curseur.disabled = !peutMiser || o.miniRelance >= o.maxiRelance;

  if (!peutMiser) {
    // Hors tour, aucun montant n'a de sens : on ne laisse pas traîner les
    // chiffres du coup précédent, qui se liraient comme une proposition.
    for (const bouton of $("raccourcis").children) {
      bouton.disabled = true;
      bouton.querySelector("span").textContent = "—";
      bouton.setAttribute("aria-pressed", "false");
      delete bouton.dataset.montant;
    }
    saisie.value = "";
    $("btnRelancer").textContent = "Relancer";
    return;
  }

  // Le curseur est borné par la relance minimum et le tapis. On ne le
  // réinitialise que si le contexte de mise a changé, pour ne pas effacer
  // la saisie du joueur à chaque message reçu.
  const memeContexte = curseur.min === String(o.miniRelance) && curseur.max === String(o.maxiRelance);
  curseur.min = o.miniRelance; curseur.max = o.maxiRelance;
  saisie.min = o.miniRelance; saisie.max = o.maxiRelance;
  curseur.step = Math.max(1, Math.round(etat.config.grosseBlinde / 2));
  if (!memeContexte || saisie.value === "") {
    curseur.value = o.miniRelance;
    saisie.value = o.miniRelance;
  }

  // Chaque raccourci affiche la somme qu'il propose, en jetons. Les petites
  // fractions butent souvent sur la relance minimum et proposent alors toutes
  // le même montant : on neutralise les doublons plutôt que d'aligner cinq
  // boutons identiques.
  const dejaVus = new Set();
  for (const bouton of $("raccourcis").children) {
    const montant = montantRaccourci(o, bouton.dataset.fraction);
    bouton.querySelector("span").textContent = jetons(montant);
    bouton.dataset.montant = montant;
    bouton.disabled = dejaVus.has(montant);
    dejaVus.add(montant);
  }
  majSelectionRaccourci();
  majBoutonRelance(o);
}

/* Le bouton de validation annonce le montant : plus de « relancer » à
   l'aveugle, on voit ce qu'on engage avant de cliquer. */
export function majBoutonRelance(o) {
  if (!o || !o.peutRelancer) { $("btnRelancer").textContent = "Relancer"; return; }
  const montant = Number($("saisieMise").value) || o.miniRelance;
  const bouton = $("btnRelancer");
  bouton.textContent = montant >= o.maxiRelance
    ? "Tapis " + jetons(o.maxiRelance)
    : (o.miseCourante === 0 ? "Miser " : "Relancer à ") + jetons(montant);
}

/* Souligne le raccourci qui correspond au montant courant, s'il y en a un. */
export function majSelectionRaccourci() {
  const valeur = String(Number($("saisieMise").value));
  for (const bouton of $("raccourcis").children) {
    bouton.setAttribute("aria-pressed", bouton.dataset.montant === valeur ? "true" : "false");
  }
}

/* ---------- Bandeau « votre main » ---------- */

function rendreMaMain(etat, mise) {
  const el = $("maMain");
  const enMain = etat.phase !== "attente" || (etat.resultats && etat.monSiege >= 0);
  const moi = etat.monSiege >= 0 ? etat.sieges[etat.monSiege] : null;

  if (!mise || !enMain || !moi || moi.couche) { el.hidden = true; return; }
  el.hidden = false;
  el.replaceChildren();
  const legende = document.createElement("small");
  legende.textContent = "Votre main";
  const texte = document.createElement("span");
  texte.textContent = mise.libelle;
  el.append(legende, texte);
}

/* ---------- Équité ---------- */

/* `info` vaut null pour effacer, { calcul: true } pendant le calcul, sinon
   { equite, exact, adversaires, partiel }. */
export function afficherEquite(info) {
  const el = $("monEquite");
  if (!info) { el.hidden = true; return; }
  el.hidden = false;

  if (info.calcul) {
    el.replaceChildren(Object.assign(document.createElement("small"), { textContent: "Équité" }),
                       Object.assign(document.createElement("span"), { textContent: "…" }));
    el.removeAttribute("title");
    return;
  }

  const pourcent = Math.round(info.equite * 100);
  const legende = document.createElement("small");
  legende.textContent = "Équité";
  const valeur = document.createElement("span");
  // Le préfixe « ≈ » distingue l'estimation par tirage de l'énumération
  // exacte, possible seulement à la river en tête-à-tête.
  valeur.textContent = (info.exact ? "" : "≈ ") + pourcent + " %";
  el.replaceChildren(legende, valeur);
  el.classList.toggle("provisoire", !!info.partiel);

  const contre = info.adversaires === 1 ? "un adversaire" : info.adversaires + " adversaires";
  el.title =
    "Probabilité de remporter la main face à " + contre + " tenant des cartes au hasard"
    + (info.exact ? ", calculée sur les 990 mains adverses possibles." : ", estimée sur 20 000 tirages.")
    + "\n\nUn joueur qui vient de suivre une relance ne détient pas des cartes au hasard :"
    + " le chiffre est optimiste face à un adversaire sélectif.";
}

/* ---------- Rendu complet ---------- */

export function rendre(etat, contexte) {
  const mise = maMeilleureMain(etat);

  rendreBoard(etat, mise);
  rendreSieges(etat, contexte, mise);
  rendreCentre(etat);
  rendrePileJetons(etat);
  // Après le rendu des sièges : l'animation part de leur position réelle.
  animerMises(etat);
  rendreForce(mise);
  rendreMaMain(etat, mise);
  rendreJournal(etat);
  rendreActions(etat, contexte);

  $("infoBlindes").textContent =
    "Blindes " + jetons(etat.config.petiteBlinde) + " / " + jetons(etat.config.grosseBlinde);
  $("infoMain").textContent = etat.numeroMain > 0 ? "Main n°" + etat.numeroMain : "Table ouverte";

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
  // La pendule s'efface sans disparaître : la retirer du flux ferait sauter
  // toute la barre d'action de quelques pixels à chaque changement de tour.
  pendule.classList.toggle("vide", !actif);
  if (!actif) { barre.style.width = "0%"; return; }

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
  // En partie, la page se comporte comme une application plein écran.
  document.body.classList.toggle("en-table", nom === "table");
  if (nom === "table") construireForce();
  else {
    // Quitter la table remet les compteurs à zéro : sans cela, la partie
    // suivante rejouerait les animations des mises déjà vues.
    misesVues = { main: -1, parSiege: [] };
    boardVu = { main: -1, nb: 0 };
  }
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
