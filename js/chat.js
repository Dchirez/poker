/* ============================================================
   CHAT — messages entre joueurs
   Ce module ne connaît pas le réseau : il affiche les messages qu'on lui
   donne et remonte ceux que le joueur écrit. Le routage — diffusion à
   tous ou envoi privé — est l'affaire de l'hôte.

   Deux conventions d'écriture :
   — `@pseudo` cite un joueur, avec complétion pendant la frappe ;
   — `#pseudo` en tête de message l'envoie à ce seul joueur.
   ============================================================ */

const $ = (id) => document.getElementById(id);

export const LONGUEUR_MAX = 300;

/* Le texte vient d'un autre joueur : on retire les caractères de contrôle,
   on écrase les espaces multiples et on borne la longueur. Le rendu, lui,
   passe exclusivement par `textContent` — jamais de HTML interprété. */
export function nettoyerTexte(brut) {
  return String(brut ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LONGUEUR_MAX);
}

/* Repère un destinataire privé en tête de message : `#Léa salut`.
   On retient le pseudo le plus long qui corresponde, pour que « #Max »
   et « #Maxime » restent distinguables. `joueurs` est une liste
   d'objets { id, nom }. */
export function extraireDestinataire(texte, joueurs) {
  if (!texte.startsWith("#")) return { cible: null, corps: texte };
  const reste = texte.slice(1);
  const enMinuscule = reste.toLowerCase();

  const candidats = joueurs
    .filter((j) => enMinuscule.startsWith(j.nom.toLowerCase()))
    .sort((a, b) => b.nom.length - a.nom.length);
  if (!candidats.length) return { cible: null, corps: texte };

  const cible = candidats[0];
  const corps = reste.slice(cible.nom.length).trim();
  // « #Léa » tout seul n'est pas un message : on le laisse passer en clair
  // plutôt que d'envoyer un privé vide.
  return corps ? { cible, corps } : { cible: null, corps: texte };
}

/* ------------------------------------------------------------
   Affichage
   ------------------------------------------------------------ */

let contexte = { surEnvoi: () => {}, joueurs: () => [], monNom: () => "" };

/* Découpe le texte pour mettre les `@pseudo` en évidence. Tout est
   construit en `textContent` : un message reste du texte, jamais du
   balisage, quoi qu'un joueur y écrive. */
function composerTexte(parent, texte, pseudos) {
  const morceaux = texte.split(/(@[^\s@#]{1,14})/g);
  for (const morceau of morceaux) {
    if (!morceau) continue;
    const estMention = morceau.startsWith("@")
      && pseudos.some((p) => p.toLowerCase() === morceau.slice(1).toLowerCase());
    if (estMention) {
      const span = document.createElement("span");
      span.className = "mention";
      span.textContent = morceau;
      parent.append(span);
    } else {
      parent.append(document.createTextNode(morceau));
    }
  }
}

export function ajouterMessage(message) {
  const liste = $("messagesChat");
  const monNom = contexte.monNom();
  const pseudos = contexte.joueurs().map((j) => j.nom);

  const li = document.createElement("li");
  li.className = "message-chat";
  if (message.prive) li.classList.add("prive");
  if (message.de === monNom) li.classList.add("de-moi");
  // Message qui me cite nommément : il doit sauter aux yeux.
  if (monNom && new RegExp("@" + monNom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(message.texte)) {
    li.classList.add("cite");
  }

  const entete = document.createElement("div");
  entete.className = "message-entete";
  const auteur = document.createElement("b");
  auteur.textContent = message.de;
  entete.append(auteur);

  if (message.prive) {
    const marque = document.createElement("span");
    marque.className = "marque-prive";
    // « privé → Léa » quand j'écris, « privé » quand je reçois.
    marque.textContent = message.de === monNom ? "privé → " + message.a : "privé";
    entete.append(marque);
  }

  const corps = document.createElement("div");
  corps.className = "message-corps";
  composerTexte(corps, message.texte, pseudos);

  li.append(entete, corps);
  liste.append(li);

  // On garde le fil borné : une longue soirée finirait par peser.
  while (liste.childElementCount > 120) liste.removeChild(liste.firstElementChild);
  liste.scrollTop = liste.scrollHeight;
}

export function viderMessages() {
  $("messagesChat").replaceChildren();
}

/* ------------------------------------------------------------
   Complétion des pseudos après « @ » ou « # »
   ------------------------------------------------------------ */

let choix = [];
let indice = -1;

/* Mot en cours de frappe juste avant le curseur, s'il commence par @ ou #. */
function motEnCours(champ) {
  const avant = champ.value.slice(0, champ.selectionStart);
  const m = avant.match(/([@#])([^\s@#]*)$/);
  if (!m) return null;
  // Le « # » ne désigne un destinataire qu'en tête de message.
  if (m[1] === "#" && avant.length !== m[0].length) return null;
  return { signe: m[1], debut: avant.length - m[0].length, saisi: m[2] };
}

function fermerSuggestions() {
  $("suggestionsChat").hidden = true;
  choix = []; indice = -1;
}

function majSuggestions() {
  const champ = $("saisieChat");
  const mot = motEnCours(champ);
  if (!mot) return fermerSuggestions();

  const saisi = mot.saisi.toLowerCase();
  choix = contexte.joueurs()
    .filter((j) => j.nom.toLowerCase().startsWith(saisi) && j.nom !== contexte.monNom())
    .slice(0, 6);
  if (!choix.length) return fermerSuggestions();

  indice = 0;
  const liste = $("suggestionsChat");
  liste.replaceChildren();
  choix.forEach((j, i) => {
    const li = document.createElement("li");
    li.className = "suggestion" + (i === indice ? " active" : "");
    li.setAttribute("role", "option");
    li.textContent = mot.signe + j.nom;
    if (mot.signe === "#") {
      const note = document.createElement("small");
      note.textContent = "en privé";
      li.append(note);
    }
    li.addEventListener("mousedown", (e) => { e.preventDefault(); appliquer(i); });
    liste.append(li);
  });
  liste.hidden = false;
}

function appliquer(i) {
  const champ = $("saisieChat");
  const mot = motEnCours(champ);
  if (!mot || !choix[i]) return;
  const avant = champ.value.slice(0, mot.debut);
  const apres = champ.value.slice(champ.selectionStart);
  const insere = mot.signe + choix[i].nom + " ";
  champ.value = avant + insere + apres;
  const curseur = (avant + insere).length;
  champ.setSelectionRange(curseur, curseur);
  fermerSuggestions();
  champ.focus();
}

function envoyer() {
  const champ = $("saisieChat");
  const texte = nettoyerTexte(champ.value);
  if (!texte) return;
  champ.value = "";
  fermerSuggestions();
  contexte.surEnvoi(texte);
}

/* ------------------------------------------------------------
   Branchement
   ------------------------------------------------------------ */

export function initChat({ surEnvoi, joueurs, monNom }) {
  contexte = { surEnvoi, joueurs, monNom };
  const champ = $("saisieChat");

  champ.addEventListener("input", majSuggestions);
  champ.addEventListener("blur", () => setTimeout(fermerSuggestions, 120));

  champ.addEventListener("keydown", (e) => {
    const ouvert = !$("suggestionsChat").hidden && choix.length;
    if (ouvert && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      indice = (indice + (e.key === "ArrowDown" ? 1 : choix.length - 1)) % choix.length;
      [...$("suggestionsChat").children].forEach((li, i) => li.classList.toggle("active", i === indice));
      return;
    }
    if (ouvert && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); appliquer(indice); return; }
    if (e.key === "Escape") { fermerSuggestions(); return; }
    if (e.key === "Enter") envoyer();
  });

  $("btnEnvoyerChat").addEventListener("click", envoyer);
}
