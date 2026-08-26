/* Confronte le calcul d'équité à trois sources indépendantes :
   — les équités préflop publiées, universellement connues ;
   — un cas dénombrable à la main ;
   — une énumération exhaustive refaite avec l'évaluateur de référence.
   Une erreur de raisonnement (égalités mal comptées, tirage avec remise,
   board mal reconstitué) déplacerait ces chiffres de plusieurs points. */
import { calculerEquite, equiteSynchrone } from "./js/equite.js";
import { evaluer } from "./js/mains.js";

const V = "23456789TJQKA", C = { s: 0, h: 1, d: 2, c: 3 };
const k = (s) => C[s[1]] * 13 + V.indexOf(s[0]);

let echecs = 0;

function mesurer(nom, mesCartes, board, adversaires) {
  return new Promise((resoudre) => {
    calculerEquite(
      { mesCartes: mesCartes.map(k), board: board.map(k), adversaires },
      (r) => { if (!r.partiel) resoudre({ nom, ...r }); }
    );
  });
}

function verifie(r, attendu, tolerance) {
  const pct = r.equite * 100;
  const ok = Math.abs(pct - attendu) <= tolerance;
  if (!ok) echecs++;
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${r.nom.padEnd(34)} ${pct.toFixed(2).padStart(6)} %` +
    `  (attendu ${attendu} ± ${tolerance})${r.exact ? "  [exact]" : ""}`
  );
}

/* ------------------------------------------------------------
   1. Équités préflop de référence, contre des mains au hasard.
   ------------------------------------------------------------ */
console.log("— Préflop, valeurs de référence —");
const preflop = [
  [["As", "Ah"], 1, 85.3, 1.5, "AA contre 1"],
  [["Ks", "Kh"], 1, 82.4, 1.5, "KK contre 1"],
  [["As", "Ks"], 1, 67.0, 1.5, "AK assortis contre 1"],
  [["7s", "2h"], 1, 34.6, 1.5, "72 dépareillé contre 1"],
  [["Ts", "Th"], 1, 75.1, 1.5, "TT contre 1"],
  [["As", "Ah"], 2, 73.4, 2.0, "AA contre 2"],
  [["As", "Ah"], 4, 55.9, 2.5, "AA contre 4"],
  [["As", "Ah"], 5, 49.3, 2.5, "AA contre 5"],
];
for (const [mes, adv, attendu, tol, nom] of preflop) {
  verifie(await mesurer(nom, mes, [], adv), attendu, tol);
}

/* ------------------------------------------------------------
   2. Un cas que l'on peut dénombrer de tête.
   Board K♠K♦K♣K♥Q♠ : tout le monde joue le carré de Rois, seul le
   kicker départage. Je tiens l'As, donc je gagne — sauf si l'adversaire
   en tient un aussi, auquel cas le pot est partagé.
   Mains adverses contenant un As parmi les 45 cartes inconnues :
   3 × 42 + C(3,2) = 129, sur C(45,2) = 990 mains possibles.
   Équité = (861 + 129/2) / 990 = 93,4848…
   ------------------------------------------------------------ */
console.log("— Cas dénombrable —");
const kickers = await mesurer("carré au board, kicker As", ["As", "2h"], ["Ks", "Kd", "Kc", "Kh", "Qs"], 1);
verifie(kickers, (861 + 129 / 2) / 990 * 100, 0.0001);
if (!kickers.exact) { echecs++; console.log("  FAIL la river en tête-à-tête doit être énumérée, pas échantillonnée"); }

/* ------------------------------------------------------------
   3. Contre-épreuve exhaustive avec l'évaluateur de référence.
   On refait le calcul à la main, avec `evaluer` et non `scoreRapide` :
   si les deux chemins s'accordent au centième près sur des boards tirés
   au hasard, c'est toute la mécanique qui est validée, pas seulement
   l'évaluateur.
   ------------------------------------------------------------ */
function equiteReference(mesCartes, board) {
  const connues = new Set([...mesCartes, ...board]);
  const restantes = [];
  for (let c = 0; c < 52; c++) if (!connues.has(c)) restantes.push(c);
  const monScore = evaluer([...mesCartes, ...board]).score;

  let total = 0, cas = 0;
  for (let i = 0; i < restantes.length; i++) {
    for (let j = i + 1; j < restantes.length; j++) {
      const son = evaluer([restantes[i], restantes[j], ...board]).score;
      if (son < monScore) total += 1;
      else if (son === monScore) total += 0.5;
      cas++;
    }
  }
  return total / cas;
}

console.log("— Contre-épreuve exhaustive (évaluateur de référence) —");
let graine = 4242;
const rnd = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };

for (let essai = 0; essai < 4; essai++) {
  const vues = new Set(); const tirage = [];
  while (tirage.length < 7) { const c = Math.floor(rnd() * 52); if (!vues.has(c)) { vues.add(c); tirage.push(c); } }
  const mes = tirage.slice(0, 2), board = tirage.slice(2);

  const attendu = equiteReference(mes, board) * 100;
  const obtenu = await new Promise((r) => calculerEquite({ mesCartes: mes, board, adversaires: 1 }, (x) => { if (!x.partiel) r(x); }));
  const pct = obtenu.equite * 100;
  const ok = Math.abs(pct - attendu) < 0.0001;
  if (!ok) echecs++;
  console.log(`  ${ok ? "OK  " : "FAIL"} board tiré au hasard n°${essai + 1} : ${pct.toFixed(4)} % contre ${attendu.toFixed(4)} % attendus`);
}

/* ------------------------------------------------------------
   4. Le chemin synchrone — celui qu'empruntent les bots.
   Il doit donner les mêmes chiffres que le chemin par tranches, et
   répondre assez vite pour qu'un bot ne fasse pas attendre la table.
   ------------------------------------------------------------ */
console.log("— Chemin synchrone (décisions des bots) —");
for (const [mes, adv, attendu, tol, nom] of preflop.slice(0, 4)) {
  const e = equiteSynchrone({ mesCartes: mes.map(k), board: [], adversaires: adv }, 8000) * 100;
  const ok = Math.abs(e - attendu) <= tol + 1;
  if (!ok) echecs++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${nom.padEnd(34)} ${e.toFixed(2).padStart(6)} %  (attendu ${attendu})`);
}

// La river en tête-à-tête doit rester exacte, même par le chemin synchrone.
const exact = equiteSynchrone(
  { mesCartes: ["As", "2h"].map(k), board: ["Ks", "Kd", "Kc", "Kh", "Qs"].map(k), adversaires: 1 },
) * 100;
const okExact = Math.abs(exact - (861 + 129 / 2) / 990 * 100) < 0.0001;
if (!okExact) echecs++;
console.log(`  ${okExact ? "OK  " : "FAIL"} ${"river énumérée".padEnd(34)} ${exact.toFixed(4)} %`);

// Coût d'une décision : c'est ce qui décide du confort de la table.
const t0 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) {
  equiteSynchrone({ mesCartes: ["As", "Kh"].map(k), board: ["7d", "2c", "9s"].map(k), adversaires: 5 }, 4000);
}
const parDecision = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
console.log(`  décision au flop contre 5 adversaires : ${parDecision.toFixed(1)} ms`);
if (parDecision > 120) { echecs++; console.log("  FAIL une décision de bot ne doit pas dépasser ~120 ms"); }

console.log(echecs === 0 ? "\nTous les tests passent." : `\n${echecs} écart(s).`);
process.exit(echecs === 0 ? 0 : 1);
