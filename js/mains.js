/* ============================================================
   ÉVALUATEUR DE MAINS — Texas Hold'em
   Une carte est un entier 0..51 :
     valeur  = 2 + (carte % 13)      → 2..14 (14 = As)
     couleur = (carte / 13) | 0      → 0 ♠  1 ♥  2 ♦  3 ♣
   Le score d'une main est un entier comparable : plus il est
   grand, meilleure est la main. Deux mains de force identique
   produisent exactement le même score (indispensable pour les
   pots partagés).
   ============================================================ */

export const VALEURS = ["2","3","4","5","6","7","8","9","10","V","D","R","A"];
export const COULEURS = ["\u2660", "\u2665", "\u2666", "\u2663"];

export const valeurDe  = (c) => 2 + (c % 13);
export const couleurDe = (c) => (c / 13) | 0;
export const estRouge  = (c) => couleurDe(c) === 1 || couleurDe(c) === 2;

/* Noms des catégories, de la plus faible à la plus forte. */
export const CATEGORIES = [
  "Hauteur", "Paire", "Double paire", "Brelan", "Quinte",
  "Couleur", "Full", "Carr\u00e9", "Quinte flush", "Quinte flush royale"
];

/* Valeur au singulier / pluriel pour composer les libellés. */
const NOM_VALEUR = {
  2:"2", 3:"3", 4:"4", 5:"5", 6:"6", 7:"7", 8:"8", 9:"9", 10:"10",
  11:"Valet", 12:"Dame", 13:"Roi", 14:"As"
};
const NOM_VALEUR_PL = {
  2:"2", 3:"3", 4:"4", 5:"5", 6:"6", 7:"7", 8:"8", 9:"9", 10:"10",
  11:"Valets", 12:"Dames", 13:"Rois", 14:"As"
};

/* Un jeu de 52 cartes mélangé (Fisher-Yates, source cryptographique
   quand le navigateur la fournit — c'est la distribution d'une partie,
   autant ne pas dépendre de Math.random). */
export function paquetMelange() {
  const p = Array.from({ length: 52 }, (_, i) => i);
  const alea = (n) => {
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      // Tirage sans biais : on rejette les valeurs qui dépassent le
      // dernier multiple entier de n.
      const max = Math.floor(0xffffffff / n) * n;
      const tampon = new Uint32Array(1);
      let v;
      do { globalThis.crypto.getRandomValues(tampon); v = tampon[0]; } while (v >= max);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  };
  for (let i = p.length - 1; i > 0; i--) {
    const j = alea(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/* ------------------------------------------------------------
   Évaluation d'une main de 5 cartes exactement.
   Retourne { score, categorie, valeurs } où `valeurs` liste les
   rangs par ordre d'importance (départage compris).
   ------------------------------------------------------------ */
function evaluer5(cartes) {
  const vals = cartes.map(valeurDe).sort((a, b) => b - a);
  const cous = cartes.map(couleurDe);
  const couleur = cous.every((s) => s === cous[0]);

  // Regroupement par valeur, trié par (nombre d'occurrences, puis valeur).
  const compte = new Map();
  for (const v of vals) compte.set(v, (compte.get(v) || 0) + 1);
  const groupes = [...compte.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const formes = groupes.map((g) => g[1]).join("");   // "32" = full, "41" = carré…
  const rangs  = groupes.map((g) => g[0]);

  // Quinte : 5 valeurs distinctes qui se suivent. Cas particulier de
  // la « roue » A-2-3-4-5, où l'As compte pour 1 et la quinte vaut 5.
  let hauteurQuinte = 0;
  if (groupes.length === 5) {
    if (vals[0] - vals[4] === 4) hauteurQuinte = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) hauteurQuinte = 5;
  }

  let categorie, valeurs;
  if (couleur && hauteurQuinte) {
    categorie = hauteurQuinte === 14 ? 9 : 8;
    valeurs = [hauteurQuinte];
  } else if (formes === "41") {
    categorie = 7; valeurs = rangs;
  } else if (formes === "32") {
    categorie = 6; valeurs = rangs;
  } else if (couleur) {
    categorie = 5; valeurs = vals;
  } else if (hauteurQuinte) {
    categorie = 4; valeurs = [hauteurQuinte];
  } else if (formes === "311") {
    categorie = 3; valeurs = rangs;
  } else if (formes === "221") {
    categorie = 2; valeurs = rangs;
  } else if (formes === "2111") {
    categorie = 1; valeurs = rangs;
  } else {
    categorie = 0; valeurs = vals;
  }

  // Score positionnel en base 15 : la catégorie domine, puis chaque
  // rang de départage dans l'ordre.
  let score = categorie;
  for (let i = 0; i < 5; i++) score = score * 15 + (valeurs[i] || 0);

  return { score, categorie, valeurs };
}

/* ------------------------------------------------------------
   Meilleure main de 5 parmi 5, 6 ou 7 cartes.
   Retourne { score, categorie, valeurs, cartes } — `cartes` étant
   les 5 cartes retenues, pour pouvoir les surligner à l'abattage.
   ------------------------------------------------------------ */
export function evaluer(cartes) {
  if (cartes.length < 5) throw new Error("Il faut au moins 5 cartes pour \u00e9valuer une main");
  if (cartes.length === 5) return { ...evaluer5(cartes), cartes: [...cartes] };

  let meilleur = null;
  const n = cartes.length;
  const combo = [0, 0, 0, 0, 0];
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            combo[0] = cartes[a]; combo[1] = cartes[b]; combo[2] = cartes[c];
            combo[3] = cartes[d]; combo[4] = cartes[e];
            const r = evaluer5(combo);
            if (!meilleur || r.score > meilleur.score) {
              meilleur = { ...r, cartes: [...combo] };
            }
          }
  return meilleur;
}

/* ------------------------------------------------------------
   Meilleure main avec moins de cinq cartes — le cas du préflop, où le
   joueur n'a que ses deux cartes. `evaluer` exige cinq cartes ; ici on
   se contente de la paire ou de la carte haute, dans le même format,
   pour pouvoir annoncer sa main dès le début de la donne.
   ------------------------------------------------------------ */
export function evaluerPartielle(cartes) {
  if (cartes.length >= 5) return evaluer(cartes);
  if (cartes.length === 0) return null;

  const compte = new Map();
  for (const c of cartes) {
    const v = valeurDe(c);
    if (!compte.has(v)) compte.set(v, []);
    compte.get(v).push(c);
  }
  // Meilleur groupe : d'abord le plus nombreux, puis le plus fort.
  const groupes = [...compte.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const [rang, retenues] = groupes[0];
  const categorie = retenues.length >= 4 ? 7
    : retenues.length === 3 ? 3
    : retenues.length === 2 ? 1 : 0;

  // Sans paire, la main se résume à ses cartes hautes ; on ne retient
  // alors que la plus forte pour la mise en valeur.
  const valeurs = categorie === 0
    ? cartes.map(valeurDe).sort((a, b) => b - a)
    : [rang, ...groupes.slice(1).map((g) => g[0])];
  const contribuent = categorie === 0
    ? [cartes.reduce((a, b) => (valeurDe(b) > valeurDe(a) ? b : a))]
    : [...retenues];

  let score = categorie;
  for (let i = 0; i < 5; i++) score = score * 15 + (valeurs[i] || 0);

  return { score, categorie, valeurs, cartes: contribuent, partielle: true };
}

/* ------------------------------------------------------------
   Libellé lisible d'une main évaluée : « Full aux Dames par les 7 »,
   « Couleur \u2660 \u00e0 l'As », « Double paire Rois et 8 »…
   ------------------------------------------------------------ */
export function nommer(res) {
  const v = res.valeurs;
  const n  = (r) => NOM_VALEUR[r];
  const np = (r) => NOM_VALEUR_PL[r];
  const de = (r) => (r === 14 ? "\u00e0 l'As" : "au" + (r >= 11 ? " " : " ") + n(r));

  switch (res.categorie) {
    case 9: return "Quinte flush royale";
    case 8: return "Quinte flush " + de(v[0]);
    case 7: return "Carr\u00e9 de " + np(v[0]);
    case 6: return "Full aux " + np(v[0]) + " par les " + np(v[1]);
    case 5: {
      const c = COULEURS[couleurDe(res.cartes[0])];
      return "Couleur " + c + " " + de(v[0]);
    }
    case 4: return "Quinte " + de(v[0]);
    case 3: return "Brelan de " + np(v[0]);
    case 2: return "Double paire " + np(v[0]) + " et " + np(v[1]);
    case 1: return "Paire de " + np(v[0]);
    default: return "Hauteur " + n(v[0]);
  }
}

/* Libellé court d'une carte, pour le journal de partie : « A\u2660 ». */
/* ------------------------------------------------------------
   Les cartes qui *font* la combinaison, kickers exclus. Surligner les
   cinq cartes d'une simple paire allumerait presque tout le tapis et ne
   dirait plus rien ; on ne garde donc que les cartes porteuses.
   Quinte, couleur et full mobilisent réellement leurs cinq cartes.
   ------------------------------------------------------------ */
export function cartesSignificatives(res) {
  if (!res) return [];
  if (res.partielle) return res.cartes;          // déjà réduit à l'essentiel

  // Nombre de rangs porteurs, pour les combinaisons fondées sur des groupes.
  const rangsPorteurs = { 0: 1, 1: 1, 2: 2, 3: 1, 7: 1 }[res.categorie];
  if (rangsPorteurs === undefined) return res.cartes;   // quinte, couleur, full…

  if (res.categorie === 0) {
    const haute = Math.max(...res.cartes.map(valeurDe));
    return res.cartes.filter((c) => valeurDe(c) === haute).slice(0, 1);
  }
  const gardes = new Set(res.valeurs.slice(0, rangsPorteurs));
  return res.cartes.filter((c) => gardes.has(valeurDe(c)));
}

/* ============================================================
   SCORE RAPIDE — chemin dédié à la simulation
   `evaluer` énumère les 21 combinaisons de 5 cartes et alloue à chaque
   tour : très lisible, mais ~46 000 mains/seconde, ce qui interdit tout
   calcul d'équité en direct. Cette version ne fait aucune allocation et
   ne renvoie que le score entier — pas les cartes retenues.

   Elle produit EXACTEMENT le même entier que `evaluer(...).score`, ce
   qui se vérifie par comparaison sur des millions de mains tirées au
   hasard (voir test-mains.mjs). C'est ce qui permet d'avoir deux
   implémentations sans avoir deux vérités.
   ============================================================ */

const _compte = new Uint8Array(15);        // occurrences par valeur (2..14)
const _nbCouleur = new Uint8Array(4);      // occurrences par couleur
const _masqueCouleur = new Uint16Array(4); // valeurs présentes, par couleur
const _valeurs = new Uint8Array(5);        // rangs de départage

/* Hauteur de la meilleure quinte contenue dans un masque de valeurs,
   0 s'il n'y en a pas. L'As sert aussi de 1 pour la roue A-2-3-4-5. */
function quinteDansMasque(masque) {
  const m = masque | (((masque >> 14) & 1) << 1);
  for (let haut = 14; haut >= 5; haut--) {
    if (((m >> (haut - 4)) & 0b11111) === 0b11111) return haut;
  }
  return 0;
}

export function scoreRapide(cartes) {
  _compte.fill(0); _nbCouleur.fill(0); _masqueCouleur.fill(0);
  _valeurs.fill(0);
  let masque = 0;

  for (let i = 0; i < cartes.length; i++) {
    const c = cartes[i];
    const v = 2 + (c % 13);
    const s = (c / 13) | 0;
    _compte[v]++;
    _nbCouleur[s]++;
    _masqueCouleur[s] |= 1 << v;
    masque |= 1 << v;
  }

  let couleur = -1;
  for (let s = 0; s < 4; s++) if (_nbCouleur[s] >= 5) { couleur = s; break; }

  let categorie = -1;

  // Quinte flush — la seule main qui batte un carré.
  if (couleur >= 0) {
    const haut = quinteDansMasque(_masqueCouleur[couleur]);
    if (haut) { categorie = haut === 14 ? 9 : 8; _valeurs[0] = haut; }
  }

  // Carré, puis full : deux mains fondées sur les groupes de valeurs.
  if (categorie < 0) {
    let carre = 0, brelan = 0, brelan2 = 0, paire = 0, paire2 = 0;
    for (let v = 14; v >= 2; v--) {
      const n = _compte[v];
      if (n === 4 && !carre) carre = v;
      else if (n === 3) { if (!brelan) brelan = v; else if (!brelan2) brelan2 = v; }
      else if (n === 2) { if (!paire) paire = v; else if (!paire2) paire2 = v; }
    }

    if (carre) {
      categorie = 7; _valeurs[0] = carre;
      for (let v = 14; v >= 2; v--) if (v !== carre && _compte[v]) { _valeurs[1] = v; break; }
    } else if (brelan && (brelan2 || paire)) {
      // Deux brelans : le second sert de paire.
      categorie = 6; _valeurs[0] = brelan;
      _valeurs[1] = brelan2 > paire ? brelan2 : paire;
    } else if (couleur >= 0) {
      categorie = 5;
      let n = 0;
      for (let v = 14; v >= 2 && n < 5; v--) if ((_masqueCouleur[couleur] >> v) & 1) _valeurs[n++] = v;
    } else {
      const haut = quinteDansMasque(masque);
      if (haut) { categorie = 4; _valeurs[0] = haut; }
      else if (brelan) {
        categorie = 3; _valeurs[0] = brelan;
        let n = 1;
        for (let v = 14; v >= 2 && n < 3; v--) if (v !== brelan && _compte[v]) _valeurs[n++] = v;
      } else if (paire && paire2) {
        categorie = 2; _valeurs[0] = paire; _valeurs[1] = paire2;
        // Le kicker peut être une troisième paire restée de côté.
        for (let v = 14; v >= 2; v--) if (v !== paire && v !== paire2 && _compte[v]) { _valeurs[2] = v; break; }
      } else if (paire) {
        categorie = 1; _valeurs[0] = paire;
        let n = 1;
        for (let v = 14; v >= 2 && n < 4; v--) if (v !== paire && _compte[v]) _valeurs[n++] = v;
      } else {
        categorie = 0;
        let n = 0;
        for (let v = 14; v >= 2 && n < 5; v--) if (_compte[v]) _valeurs[n++] = v;
      }
    }
  }

  let score = categorie;
  for (let i = 0; i < 5; i++) score = score * 15 + _valeurs[i];
  return score;
}

export function nomCarte(c) {
  return VALEURS[c % 13] + COULEURS[couleurDe(c)];
}
