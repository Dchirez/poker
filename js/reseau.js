/* ============================================================
   RÉSEAU — WebRTC en étoile via PeerJS
   L'hôte ouvre un pair dont l'identifiant dérive du code de table ;
   les invités s'y connectent directement. Tout passe par l'hôte :
   personne ne parle à personne d'autre. Le serveur PeerJS public ne
   sert qu'à la mise en relation, aucune donnée de partie n'y transite.
   ============================================================ */

/* Préfixe d'identifiant : le serveur PeerJS est public et partagé, il faut
   un espace de noms qui n'entre pas en collision avec d'autres projets. */
const PREFIXE = "dchirez-poker-v1-";

/* Alphabet sans caractères ambigus (ni 0/O, ni 1/I/L) : un code doit
   pouvoir se dicter au téléphone sans hésitation. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LONGUEUR_CODE = 5;

export function codeAleatoire() {
  const tampon = new Uint8Array(LONGUEUR_CODE);
  crypto.getRandomValues(tampon);
  return [...tampon].map((n) => ALPHABET[n % ALPHABET.length]).join("");
}

export function codeValide(code) {
  const c = (code || "").toUpperCase().trim();
  return c.length === LONGUEUR_CODE && [...c].every((ch) => ALPHABET.includes(ch));
}

/* Identifiant de joueur stable, conservé d'une session à l'autre : c'est lui
   qui permet de retrouver son siège après une coupure de connexion. */
export function monIdentifiant() {
  const cle = "poker.identifiant";
  try {
    let id = localStorage.getItem(cle);
    if (!id) {
      id = "j-" + crypto.randomUUID().slice(0, 12);
      localStorage.setItem(cle, id);
    }
    return id;
  } catch (e) {
    return "j-" + Math.random().toString(36).slice(2, 14);
  }
}

function attendrePeerJS() {
  return new Promise((resoudre, rejeter) => {
    if (globalThis.Peer) return resoudre(globalThis.Peer);
    let restant = 100;                                  // ~10 s d'attente
    const tic = setInterval(() => {
      if (globalThis.Peer) { clearInterval(tic); resoudre(globalThis.Peer); }
      else if (--restant <= 0) {
        clearInterval(tic);
        rejeter(new Error("La bibliothèque PeerJS n'a pas pu être chargée."));
      }
    }, 100);
  });
}

/* ------------------------------------------------------------
   HÔTE
   `surMessage(idConnexion, message)` reçoit les actions des invités.
   `surDepart(idConnexion)` signale une déconnexion.
   ------------------------------------------------------------ */
export async function ouvrirTable({ surMessage, surArrivee, surDepart, surErreur }) {
  const Peer = await attendrePeerJS();
  const connexions = new Map();                         // idConnexion -> DataConnection

  let code = null;
  let pair = null;

  // On tente quelques codes : une collision sur le serveur public est rare
  // mais pas impossible, et elle se manifeste par une erreur d'identifiant.
  for (let essai = 0; essai < 6; essai++) {
    const candidat = codeAleatoire();
    try {
      pair = await new Promise((resoudre, rejeter) => {
        const p = new Peer(PREFIXE + candidat, { debug: 1 });
        const fin = (fn) => (arg) => { p.off("open", ouvert); p.off("error", echoue); fn(arg); };
        const ouvert = fin(() => resoudre(p))
          , echoue = fin((err) => { try { p.destroy(); } catch (e) {} rejeter(err); });
        p.on("open", ouvert);
        p.on("error", echoue);
      });
      code = candidat;
      break;
    } catch (err) {
      if (err && err.type === "unavailable-id") continue;               // code déjà pris
      throw new Error(messageErreur(err));
    }
  }
  if (!pair) throw new Error("Impossible d'ouvrir une table : tous les codes essayés étaient pris.");

  pair.on("connection", (conn) => {
    conn.on("open", () => {
      connexions.set(conn.connectionId, conn);
      surArrivee && surArrivee(conn.connectionId);
    });
    conn.on("data", (msg) => surMessage && surMessage(conn.connectionId, msg));
    const partir = () => {
      if (!connexions.has(conn.connectionId)) return;
      connexions.delete(conn.connectionId);
      surDepart && surDepart(conn.connectionId);
    };
    conn.on("close", partir);
    conn.on("error", partir);
  });

  pair.on("error", (err) => surErreur && surErreur(messageErreur(err)));
  // Une coupure du serveur de mise en relation n'interrompt pas les parties
  // déjà connectées, mais empêche les nouveaux venus : on se rebranche.
  pair.on("disconnected", () => { try { pair.reconnect(); } catch (e) {} });

  return {
    code,
    estHote: true,
    /* Envoie un message à une connexion précise. */
    envoyer(idConnexion, message) {
      const conn = connexions.get(idConnexion);
      if (conn && conn.open) { try { conn.send(message); } catch (e) {} }
    },
    /* `fabriquer(idConnexion)` compose un message propre à chaque destinataire :
       c'est ce qui permet de n'envoyer à chacun que ses propres cartes. */
    diffuser(fabriquer) {
      for (const [id, conn] of connexions) {
        if (!conn.open) continue;
        try { conn.send(fabriquer(id)); } catch (e) {}
      }
    },
    fermer(idConnexion) {
      const conn = connexions.get(idConnexion);
      if (conn) { try { conn.close(); } catch (e) {} connexions.delete(idConnexion); }
    },
    detruire() {
      for (const conn of connexions.values()) { try { conn.close(); } catch (e) {} }
      connexions.clear();
      try { pair.destroy(); } catch (e) {}
    },
  };
}

/* ------------------------------------------------------------
   INVITÉ
   ------------------------------------------------------------ */
export async function rejoindreTable({ code, surMessage, surOuverture, surFermeture, surErreur }) {
  const Peer = await attendrePeerJS();
  const cible = PREFIXE + code.toUpperCase();

  const pair = await new Promise((resoudre, rejeter) => {
    const p = new Peer({ debug: 1 });
    p.on("open", () => resoudre(p));
    p.on("error", (err) => rejeter(new Error(messageErreur(err))));
  });

  let conn = null;
  let vivant = true;
  let tentatives = 0;

  function brancher() {
    conn = pair.connect(cible, { reliable: true, metadata: { jeu: "poker" } });

    // PeerJS ne signale pas toujours l'absence de l'hôte : au bout de 12 s
    // sans ouverture on considère que la table n'existe pas.
    const minuteur = setTimeout(() => {
      if (conn && !conn.open) {
        try { conn.close(); } catch (e) {}
        surErreur && surErreur("Aucune table ne répond à ce code. Vérifiez-le avec l'hôte.");
      }
    }, 12000);

    conn.on("open", () => {
      clearTimeout(minuteur);
      tentatives = 0;
      surOuverture && surOuverture();
    });
    conn.on("data", (msg) => surMessage && surMessage(msg));
    conn.on("close", () => {
      clearTimeout(minuteur);
      if (!vivant) return;
      // Trois tentatives de reconnexion espacées avant d'abandonner.
      if (++tentatives <= 3) {
        surFermeture && surFermeture({ definitive: false, tentative: tentatives });
        setTimeout(() => { if (vivant) brancher(); }, 1200 * tentatives);
      } else {
        surFermeture && surFermeture({ definitive: true });
      }
    });
    conn.on("error", (err) => surErreur && surErreur(messageErreur(err)));
  }

  pair.on("error", (err) => surErreur && surErreur(messageErreur(err)));
  pair.on("disconnected", () => { if (vivant) { try { pair.reconnect(); } catch (e) {} } });
  brancher();

  return {
    code: code.toUpperCase(),
    estHote: false,
    envoyer(message) {
      if (conn && conn.open) { try { conn.send(message); } catch (e) {} }
    },
    detruire() {
      vivant = false;
      try { conn && conn.close(); } catch (e) {}
      try { pair.destroy(); } catch (e) {}
    },
  };
}

/* Traduit les erreurs PeerJS en messages compréhensibles. */
function messageErreur(err) {
  const type = err && err.type;
  switch (type) {
    case "peer-unavailable":
      return "Aucune table ne répond à ce code. Vérifiez-le avec l'hôte.";
    case "unavailable-id":
      return "Ce code de table est déjà utilisé.";
    case "browser-incompatible":
      return "Ce navigateur ne gère pas WebRTC. Essayez Chrome, Edge ou Firefox à jour.";
    case "network":
    case "server-error":
      return "Le service de mise en relation est injoignable. Réessayez dans un instant.";
    case "webrtc":
      return "La connexion directe a échoué. Un pare-feu ou un VPN peut la bloquer.";
    case "disconnected":
      return "Connexion au service de mise en relation perdue.";
    default:
      return (err && err.message) || "Erreur de connexion inattendue.";
  }
}
