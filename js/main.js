/* ============================================================
   ORCHESTRATION
   L'hôte détient le moteur : il applique les actions reçues et
   rediffuse un état taillé pour chaque destinataire. Les invités
   n'ont qu'un état à afficher et des intentions à envoyer.
   ============================================================ */

import {
  creerPartie, asseoir, lever, recaver, agir, demarrerMain, peutDemarrer,
  marquerAbsent, actionAutomatique, etatPour, etatPublic, siegeDe,
} from "./moteur.js";
import {
  ouvrirTable, rejoindreTable, codeValide, monIdentifiant, LONGUEUR_CODE,
} from "./reseau.js";
import {
  rendre, rendrePendule, montrerEcran, erreurAccueil, etatReseau,
  montantRaccourci, majBoutonRelance, majSelectionRaccourci, afficherEquite,
} from "./vue.js";
import { calculerEquite } from "./equite.js";
import * as sons from "./sons.js";

const $ = (id) => document.getElementById(id);

/* ---------- État de la session ---------- */

const monId = monIdentifiant();
let monNom = "";
let salon = null;          // transport réseau
let partie = null;         // moteur, côté hôte uniquement
let etatCourant = null;    // dernier état connu, quel que soit le rôle
let estHote = false;

// Côté hôte : correspondance entre connexions et joueurs.
const joueurParConnexion = new Map();
const connexionParJoueur = new Map();
const nomParJoueur = new Map();
const dernierSigne = new Map();          // idJoueur -> horodatage du dernier message

let minuteurHote = null;
let minuteurPendule = null;
let minuteurDistribution = null;
let minuteurPouls = null;
let dernierSigneHote = 0;                // côté invité : dernier signe de vie de l'hôte

/* Fermer un onglet ne produit pas toujours un événement de fermeture côté
   WebRTC : la table ne verrait jamais partir le joueur. Chacun envoie donc
   un battement régulier, et l'absence de battement fait foi. */
const PERIODE_POULS = 3000;
const SEUIL_ABSENCE = 9000;

/* Un pseudo reste un pseudo : pas de retours à la ligne, pas de caractères
   de contrôle, longueur bornée. C'est le seul texte libre qui circule. */
function nettoyerNom(brut, defaut = "Joueur") {
  const nom = String(brut ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 14);
  return nom || defaut;
}

/* ============================================================
   DIFFUSION (hôte)
   ============================================================ */

function diffuser() {
  if (!estHote || !partie) return;
  etatCourant = etatPour(partie, monId);
  rendreTout();
  etatReseau("en-ligne", compterJoueurs());
  salon.diffuser((idConnexion) => {
    const idJoueur = joueurParConnexion.get(idConnexion);
    return { t: "etat", etat: idJoueur ? etatPour(partie, idJoueur) : etatPublic(partie) };
  });
}

function refuser(idConnexion, raison) {
  if (idConnexion === null) signaler(raison);
  else salon.envoyer(idConnexion, { t: "refus", raison });
}

/* Applique une intention de joueur. `idConnexion` vaut null pour l'hôte
   lui-même, qui court-circuite le réseau. */
function traiterIntention(idJoueur, message, idConnexion) {
  if (!partie) return;
  let r = { ok: true };

  switch (message.t) {
    case "asseoir":
      r = asseoir(partie, message.siege | 0, idJoueur, nomParJoueur.get(idJoueur) || "Joueur");
      break;
    case "action":
      r = agir(partie, idJoueur, message.action, Number(message.montant) || 0);
      break;
    case "lever":
      r = lever(partie, idJoueur);
      break;
    case "recaver":
      r = recaver(partie, idJoueur);
      break;
    case "distribuer":
      // Seul l'hôte lance une donne.
      if (idConnexion !== null) return;
      r = peutDemarrer(partie) ? demarrerMain(partie) : { ok: false, raison: "Impossible de distribuer" };
      break;
    default:
      return;
  }

  if (!r.ok) refuser(idConnexion, r.raison);
  programmerDistributionAuto();
  diffuser();
}

/* Une fois la main terminée, la suivante part toute seule après un temps
   d'observation — sinon l'hôte devrait cliquer entre chaque main. */
function programmerDistributionAuto() {
  clearTimeout(minuteurDistribution);
  if (!estHote || !partie) return;
  if (partie.phase !== "attente" || !peutDemarrer(partie)) return;
  if (partie.numeroMain === 0) return;            // la première donne reste manuelle
  minuteurDistribution = setTimeout(() => {
    if (partie && peutDemarrer(partie) && partie.phase === "attente") {
      demarrerMain(partie);
      diffuser();
    }
  }, 6500);
}

/* Boucle de l'hôte : détecte les joueurs muets, fait respecter la pendule et
   débloque la table quand un joueur déconnecté a la parole. */
function demarrerBoucleHote() {
  clearInterval(minuteurHote);
  minuteurHote = setInterval(() => {
    if (!partie) return;
    const maintenant = Date.now();
    let change = false;

    // Un joueur sans battement depuis trop longtemps passe absent.
    for (const joueur of partie.sieges) {
      if (!joueur || !joueur.id || joueur.id === monId) continue;
      const vu = dernierSigne.get(joueur.id) || 0;
      const muet = maintenant - vu > SEUIL_ABSENCE;
      if (muet !== joueur.absent) { marquerAbsent(partie, joueur.id, muet); change = true; }
    }

    if (partie.tour >= 0) {
      const joueur = partie.sieges[partie.tour];
      const tempsEcoule = partie.echeance > 0 && maintenant > partie.echeance;
      if (joueur && (joueur.absent || tempsEcoule)) {
        actionAutomatique(partie, partie.tour);
        change = true;
      }
    }

    if (change) { programmerDistributionAuto(); diffuser(); }
  }, 500);

  // Battement de l'hôte vers les invités : il prouve que la table vit même
  // quand rien ne bouge dans la partie.
  clearInterval(minuteurPouls);
  minuteurPouls = setInterval(() => {
    if (salon) salon.diffuser(() => ({ t: "pouls" }));
  }, PERIODE_POULS);
}

/* ============================================================
   MESSAGES REÇUS
   ============================================================ */

/* Côté hôte. L'identité du joueur vient de la connexion, jamais du message :
   un invité ne peut donc pas agir à la place d'un autre. */
function surMessageInvite(idConnexion, message) {
  if (!message || typeof message.t !== "string") return;

  if (message.t === "rejoindre") {
    const idJoueur = typeof message.id === "string" ? message.id.slice(0, 40) : null;
    if (!idJoueur) return;

    // Un même joueur qui revient reprend sa place : on ferme l'ancienne
    // connexion pour éviter deux canaux vivants sur le même siège.
    const ancienne = connexionParJoueur.get(idJoueur);
    if (ancienne && ancienne !== idConnexion) salon.fermer(ancienne);

    joueurParConnexion.set(idConnexion, idJoueur);
    connexionParJoueur.set(idJoueur, idConnexion);
    dernierSigne.set(idJoueur, Date.now());
    const siege = siegeDe(partie, idJoueur);
    // Un joueur qui revient sans pseudo garde le nom sous lequel la table le
    // connaît plutôt que de réapparaître en « Joueur ».
    nomParJoueur.set(idJoueur, nettoyerNom(message.nom, siege >= 0 ? partie.sieges[siege].nom : "Joueur"));
    if (siege >= 0) {
      partie.sieges[siege].nom = nomParJoueur.get(idJoueur);
      marquerAbsent(partie, idJoueur, false);
    }
    salon.envoyer(idConnexion, { t: "bienvenue", code: salon.code });
    diffuser();
    return;
  }

  const idJoueur = joueurParConnexion.get(idConnexion);
  if (!idJoueur) return;                        // connexion pas encore identifiée

  // Tout message vaut signe de vie, y compris un simple battement.
  dernierSigne.set(idJoueur, Date.now());
  if (message.t === "pouls") return;

  traiterIntention(idJoueur, message, idConnexion);
}

/* Côté invité. */
function surMessageHote(message) {
  if (!message || typeof message.t !== "string") return;
  dernierSigneHote = Date.now();
  switch (message.t) {
    case "pouls":
      if ($("etatReseau").dataset.etat !== "en-ligne") etatReseau("en-ligne", "Connecté");
      break;
    case "etat":
      etatCourant = message.etat;
      rendreTout();
      break;
    case "bienvenue":
      etatReseau("en-ligne", "Connecté");
      break;
    case "refus":
      signaler(message.raison);
      break;
    case "table-fermee":
      signaler("L'hôte a fermé la table.");
      etatReseau("perdu", "Table fermée");
      break;
  }
}

/* ============================================================
   ACTIONS LOCALES
   ============================================================ */

/* Chemin unique pour toute intention du joueur local : l'hôte l'applique
   directement, l'invité l'envoie sur le fil. */
function envoyer(message) {
  if (estHote) traiterIntention(monId, message, null);
  else if (salon) salon.envoyer(message);
}

let minuteurMessage = null;
function signaler(texte) {
  const el = $("messageAction");
  if (!el) return;
  el.textContent = texte;
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => { if (etatCourant) rendreTout(); }, 3200);
}

/* ============================================================
   RENDU
   ============================================================ */

const contexteVue = {
  get estHote() { return estHote; },
  surAsseoir(siege) { envoyer({ t: "asseoir", siege }); },
};

function rendreTout() {
  if (!etatCourant) return;
  rendre(etatCourant, contexteVue);
  majEquite();
}

/* ---------- Équité ---------- */

let annulerEquite = () => {};
let signatureEquite = "";

function effacerEquite() {
  annulerEquite();
  annulerEquite = () => {};
  signatureEquite = "";
  afficherEquite(null);
}

/* Relance le calcul quand — et seulement quand — la situation change :
   nouvelle main, nouvelle carte au centre, ou adversaire qui se couche.
   Sans cette signature, chaque message reçu relancerait une simulation. */
function majEquite() {
  const e = etatCourant;
  if (!e || !e.config.equite || e.monSiege < 0 || e.phase === "attente") return effacerEquite();

  const moi = e.sieges[e.monSiege];
  if (!moi || moi.couche || !e.mesCartes || e.mesCartes.length !== 2) return effacerEquite();

  const adversaires = e.sieges.filter((j, i) => j && i !== e.monSiege && j.enJeu && !j.couche).length;
  if (adversaires < 1) return effacerEquite();

  const signature = [e.numeroMain, e.board.length, adversaires, e.mesCartes.join("-")].join("|");
  if (signature === signatureEquite) return;
  signatureEquite = signature;

  annulerEquite();
  afficherEquite({ calcul: true });
  annulerEquite = calculerEquite(
    { mesCartes: e.mesCartes, board: e.board, adversaires },
    (resultat) => afficherEquite(resultat),
  );
}

function demarrerPendule() {
  clearInterval(minuteurPendule);
  minuteurPendule = setInterval(() => rendrePendule(etatCourant), 250);
}

/* ============================================================
   OUVERTURE / FERMETURE DE TABLE
   ============================================================ */

function verrouillerAccueil(verrou, texte) {
  $("btnCreer").disabled = verrou;
  $("btnRejoindre").disabled = verrou;
  if (texte) $("btnCreer").textContent = texte;
}

async function creerTable() {
  monNom = nettoyerNom($("saisiePseudo").value);
  erreurAccueil("");
  verrouillerAccueil(true, "Ouverture…");
  etatReseau("attente", "Ouverture de la table…");

  try {
    const grosse = Number($("saisieBlindes").value) * 2;
    partie = creerPartie({
      petiteBlinde: Number($("saisieBlindes").value),
      grosseBlinde: grosse,
      tapisDepart: Number($("saisieTapis").value),
      secondesParTour: Number($("saisiePendule").value),
      equite: $("saisieEquite").checked,
    });

    salon = await ouvrirTable({
      surMessage: surMessageInvite,
      surArrivee: () => etatReseau("en-ligne", compterJoueurs()),
      surDepart: (idConnexion) => {
        const idJoueur = joueurParConnexion.get(idConnexion);
        joueurParConnexion.delete(idConnexion);
        if (idJoueur && connexionParJoueur.get(idJoueur) === idConnexion) {
          connexionParJoueur.delete(idJoueur);
          marquerAbsent(partie, idJoueur, true);
        }
        etatReseau("en-ligne", compterJoueurs());
        diffuser();
      },
      surErreur: (texte) => signaler(texte),
    });

    estHote = true;
    nomParJoueur.set(monId, monNom);
    // L'hôte s'installe d'office au premier siège.
    asseoir(partie, 0, monId, monNom);

    $("codeTable").textContent = salon.code;
    majUrlPartage(salon.code);
    montrerEcran("table");
    etatReseau("en-ligne", compterJoueurs());
    demarrerBoucleHote();
    demarrerPendule();
    diffuser();
  } catch (err) {
    erreurAccueil(err.message || "Impossible d'ouvrir la table.");
    etatReseau(null);
    verrouillerAccueil(false, "Ouvrir la table");
  }
}

async function rejoindre() {
  const code = $("saisieCode").value.toUpperCase().trim();
  monNom = nettoyerNom($("saisiePseudo").value);
  erreurAccueil("");

  if (!codeValide(code)) {
    erreurAccueil("Le code doit contenir " + LONGUEUR_CODE + " caractères, sans O, 0, I, L ni 1.");
    return;
  }

  verrouillerAccueil(true);
  $("btnRejoindre").textContent = "Connexion…";
  etatReseau("attente", "Connexion…");

  try {
    salon = await rejoindreTable({
      code,
      surMessage: surMessageHote,
      surOuverture: () => {
        etatReseau("en-ligne", "Connecté");
        dernierSigneHote = Date.now();
        salon.envoyer({ t: "rejoindre", id: monId, nom: monNom });
      },
      surFermeture: ({ definitive, tentative }) => {
        if (definitive) {
          etatReseau("perdu", "Connexion perdue");
          signaler("Connexion à la table perdue. L'hôte a peut-être fermé son onglet.");
        } else {
          etatReseau("attente", "Reconnexion… (" + tentative + "/3)");
        }
      },
      surErreur: (texte) => {
        if ($("ecranTable").hidden) {
          erreurAccueil(texte);
          etatReseau(null);
          verrouillerAccueil(false);
          $("btnRejoindre").textContent = "Rejoindre";
        } else {
          signaler(texte);
        }
      },
    });

    estHote = false;
    $("codeTable").textContent = salon.code;
    majUrlPartage(salon.code);
    montrerEcran("table");
    demarrerPendule();
    demarrerPoulsInvite();
  } catch (err) {
    erreurAccueil(err.message || "Impossible de rejoindre la table.");
    etatReseau(null);
    verrouillerAccueil(false);
    $("btnRejoindre").textContent = "Rejoindre";
  }
}

/* Battement de l'invité vers l'hôte, doublé d'une surveillance : si l'hôte
   se tait, c'est que son onglet est parti avec la table. */
function demarrerPoulsInvite() {
  clearInterval(minuteurPouls);
  minuteurPouls = setInterval(() => {
    if (!salon || estHote) return;
    salon.envoyer({ t: "pouls" });
    if (dernierSigneHote && Date.now() - dernierSigneHote > SEUIL_ABSENCE) {
      etatReseau("perdu", "Hôte injoignable");
    }
  }, PERIODE_POULS);
}

/* Nombre de joueurs réellement présents à la table. */
function compterJoueurs() {
  if (!partie) return "1 joueur";
  const n = partie.sieges.filter((j) => j && j.id && !j.absent).length;
  return n + (n > 1 ? " joueurs" : " joueur");
}

function quitter() {
  if (!confirm("Quitter la table ?" + (estHote ? "\n\nVous êtes l'hôte : la partie prendra fin pour tout le monde." : ""))) return;
  if (estHote && salon) salon.diffuser(() => ({ t: "table-fermee" }));
  fermerSession();
}

function fermerSession() {
  clearInterval(minuteurHote);
  clearInterval(minuteurPendule);
  clearInterval(minuteurPouls);
  clearTimeout(minuteurDistribution);
  effacerEquite();
  if (salon) salon.detruire();
  salon = null; partie = null; etatCourant = null; estHote = false;
  joueurParConnexion.clear(); connexionParJoueur.clear();
  nomParJoueur.clear(); dernierSigne.clear();
  montrerEcran("accueil");
  etatReseau(null);
  verrouillerAccueil(false, "Ouvrir la table");
  $("btnRejoindre").textContent = "Rejoindre";
  history.replaceState(null, "", location.pathname);
}

function majUrlPartage(code) {
  history.replaceState(null, "", location.pathname + "?table=" + code);
}

/* ============================================================
   BRANCHEMENT DE L'INTERFACE
   ============================================================ */

$("btnCreer").addEventListener("click", creerTable);
$("btnRejoindre").addEventListener("click", rejoindre);
$("saisieCode").addEventListener("keydown", (e) => { if (e.key === "Enter") rejoindre(); });
$("saisieCode").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
$("saisiePseudo").addEventListener("input", (e) => {
  try { localStorage.setItem("poker.pseudo", e.target.value); } catch (err) {}
});

$("btnQuitter").addEventListener("click", quitter);
$("btnSeLever").addEventListener("click", () => {
  if (confirm("Quitter votre siège ? Vos jetons restent sur la table jusqu'à votre retour.")) {
    envoyer({ t: "lever" });
  }
});
$("btnRecaver").addEventListener("click", () => envoyer({ t: "recaver" }));
$("btnDistribuer").addEventListener("click", () => envoyer({ t: "distribuer" }));

$("btnCoucher").addEventListener("click", () => envoyer({ t: "action", action: "coucher" }));
$("btnPasser").addEventListener("click", () => envoyer({ t: "action", action: "checker" }));
$("btnSuivre").addEventListener("click", () => envoyer({ t: "action", action: "suivre" }));

/* Le montant est choisi puis validé : le bouton affiche la somme engagée,
   il n'y a plus d'étape « ouvrir le curseur ». */
$("btnRelancer").addEventListener("click", () => {
  const o = etatCourant && etatCourant.mesActions;
  if (!o) return;
  envoyer({ t: "action", action: "relancer", montant: Number($("saisieMise").value) });
});

/* Curseur, saisie numérique et raccourcis décrivent le même montant :
   toucher l'un met les autres à jour, ainsi que le bouton de validation. */
function majMontant(valeur) {
  const o = etatCourant && etatCourant.mesActions;
  if (!o) return;
  const borne = Math.max(o.miniRelance, Math.min(o.maxiRelance, Math.round(Number(valeur) || 0)));
  $("saisieMise").value = borne;
  $("curseurMise").value = borne;
  majSelectionRaccourci();
  majBoutonRelance(o);
}

$("curseurMise").addEventListener("input", (e) => majMontant(e.target.value));
$("saisieMise").addEventListener("input", (e) => {
  // On ne borne pas pendant la frappe, sinon impossible d'effacer le champ.
  $("curseurMise").value = e.target.value;
  majSelectionRaccourci();
  majBoutonRelance(etatCourant && etatCourant.mesActions);
});
$("saisieMise").addEventListener("change", (e) => majMontant(e.target.value));
$("saisieMise").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnRelancer").click(); });

/* Raccourcis de mise : chaque bouton propose une somme déjà calculée. */
for (const bouton of $("raccourcis").children) {
  bouton.addEventListener("click", () => {
    const o = etatCourant && etatCourant.mesActions;
    if (!o) return;
    majMontant(montantRaccourci(o, bouton.dataset.fraction));
  });
}

/* Panneaux latéraux : repliables, et en tiroir sur petit écran.
   Sur grand écran on masque par `visibility` et non par `display` : la
   colonne reste réservée, si bien que replier un panneau laisse un vide
   sans déplacer ni redimensionner le tapis.
   La bascule part de la visibilité réelle plutôt que d'un compteur interne :
   sinon, changer la taille de la fenêtre désynchronise l'état supposé et
   l'état affiché, et le panneau refuse de revenir. */
function basculerPanneau(bouton, panneau, classe) {
  const estVisible = (el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  bouton.addEventListener("click", () => {
    const ouvrir = !estVisible(panneau);
    panneau.classList.toggle("replie", !ouvrir);
    // Sur petit écran, la classe fait passer le panneau en tiroir par-dessus
    // le tapis ; sur grand écran elle ne change rien, la poser est sans effet.
    document.querySelector(".plateau").classList.toggle(classe, ouvrir);
    bouton.setAttribute("aria-pressed", String(ouvrir));
  });
}
basculerPanneau($("btnBasculerForce"), $("panneauForce"), "force-ouverte");
basculerPanneau($("btnBasculerJournal"), $("panneauJournal"), "journal-ouvert");

/* Son : coupure mémorisée d'une partie à l'autre. */
const btnSon = $("btnSon");
function majBoutonSon(actif) {
  btnSon.textContent = actif ? "🔊" : "🔇";
  btnSon.title = actif ? "Couper le son" : "Rétablir le son";
  btnSon.setAttribute("aria-label", btnSon.title);
  btnSon.setAttribute("aria-pressed", String(actif));
}
btnSon.addEventListener("click", () => majBoutonSon(sons.basculer()));

/* Aucun navigateur ne laisse démarrer l'audio sans geste préalable : on
   éveille le contexte à la première interaction, quelle qu'elle soit. */
addEventListener("pointerdown", sons.eveiller, { once: true });
addEventListener("keydown", sons.eveiller, { once: true });

/* Plein écran : la table gagne toute la hauteur disponible. */
$("btnPleinEcran").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (e) {
    signaler("Le plein écran a été refusé par le navigateur.");
  }
});
document.addEventListener("fullscreenchange", () => {
  $("btnPleinEcran").textContent = document.fullscreenElement ? "⛶" : "⛶";
  $("btnPleinEcran").title = document.fullscreenElement ? "Quitter le plein écran" : "Plein écran";
});

/* Copie du lien d'invitation. */
$("btnCopier").addEventListener("click", async () => {
  const lien = location.origin + location.pathname + "?table=" + $("codeTable").textContent;
  try {
    await navigator.clipboard.writeText(lien);
    $("btnCopier").textContent = "Lien copié";
  } catch (e) {
    // Le presse-papiers peut être refusé hors contexte sécurisé : on montre
    // alors le lien pour que le joueur le copie lui-même.
    prompt("Copiez ce lien et envoyez-le à vos amis :", lien);
  }
  setTimeout(() => { $("btnCopier").textContent = "Copier le lien"; }, 2000);
});

/* Règles */
$("btnRegles").addEventListener("click", () => {
  $("voileRegles").hidden = false;
  $("btnFermerRegles").focus();
});
$("btnFermerRegles").addEventListener("click", () => { $("voileRegles").hidden = true; });
$("voileRegles").addEventListener("click", (e) => {
  if (e.target === $("voileRegles")) $("voileRegles").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("voileRegles").hidden = true;
});

/* Thème : la table s'ouvre en sombre, mais la préférence est conservée. */
const btnTheme = $("btnTheme");
function appliquerTheme(theme) {
  document.documentElement.dataset.theme = theme;
  btnTheme.textContent = theme === "dark" ? "◐" : "◑";
  try { localStorage.setItem("poker.theme", theme); } catch (e) {}
}
btnTheme.addEventListener("click", () => {
  appliquerTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

/* L'hôte qui ferme son onglet emporte la table : on prévient. */
addEventListener("beforeunload", (e) => {
  if (estHote && connexionParJoueur.size > 0) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- Amorçage ---------- */

(function initialiser() {
  try {
    majBoutonSon(sons.restaurerPreference());
    appliquerTheme(localStorage.getItem("poker.theme") || "dark");
    const pseudo = localStorage.getItem("poker.pseudo");
    if (pseudo) $("saisiePseudo").value = pseudo;
  } catch (e) {
    appliquerTheme("dark");
  }

  // Lien d'invitation : le code est pré-rempli, il ne reste qu'à cliquer.
  const code = new URLSearchParams(location.search).get("table");
  if (code && codeValide(code)) {
    $("saisieCode").value = code.toUpperCase();
    $("btnRejoindre").focus();
  } else if (!$("saisiePseudo").value) {
    $("saisiePseudo").focus();
  }

  montrerEcran("accueil");
})();

// Le moteur reste accessible en console pour éprouver une situation,
// mais seulement chez l'hôte — et sans exposer les cartes des invités.
Object.defineProperty(window, "__poker", { get: () => (estHote ? { partie, salon } : { etat: etatCourant }) });
