/* Vérifie que `scoreRapide` — le chemin sans allocation utilisé par le calcul
   d'équité — donne exactement le même entier que `evaluer(...).score`, qui est
   la référence lisible. Deux implémentations, une seule vérité. */
import { evaluer, scoreRapide, nommer, nomCarte } from "./js/mains.js";

let echecs = 0;
const verifie = (cond, msg) => { if (!cond) { echecs++; if (echecs <= 10) console.log("FAIL " + msg); } };

/* Générateur déterministe, pour qu'un échec soit rejouable. */
let graine = 20260822;
const rnd = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };

function mainAleatoire(taille) {
  const vues = new Set();
  const main = [];
  while (main.length < taille) {
    const c = Math.floor(rnd() * 52);
    if (!vues.has(c)) { vues.add(c); main.push(c); }
  }
  return main;
}

console.log("— Concordance scoreRapide / evaluer —");
for (const taille of [5, 6, 7]) {
  const tours = taille === 7 ? 400000 : 100000;
  let vus = 0;
  for (let i = 0; i < tours; i++) {
    const main = mainAleatoire(taille);
    const attendu = evaluer(main).score;
    const obtenu = scoreRapide(main);
    if (attendu !== obtenu) {
      verifie(false, `${taille} cartes ${main.map(nomCarte).join(" ")} : ${obtenu} au lieu de ${attendu} (${nommer(evaluer(main))})`);
    }
    vus++;
  }
  console.log(`  ${taille} cartes : ${vus.toLocaleString("fr-FR")} mains comparées`);
}

/* Cas limites explicitement construits — ceux que le tirage aléatoire
   rencontre trop rarement pour qu'on s'y fie. */
console.log("— Cas limites —");
const V = "23456789TJQKA", C = { s: 0, h: 1, d: 2, c: 3 };
const k = (s) => C[s[1]] * 13 + V.indexOf(s[0]);
const cas = [
  ["quinte flush royale", ["As","Ks","Qs","Js","Ts","2h","3d"]],
  ["quinte flush roue",   ["As","2s","3s","4s","5s","Kh","Qd"]],
  ["carre + couleur",     ["9s","9h","9d","9c","5s","2s","7s"]],
  ["deux brelans",        ["9s","9h","9d","Ks","Kh","Kd","2c"]],
  ["trois paires",        ["Ks","Kh","8d","8c","5s","5h","2d"]],
  ["couleur 6 cartes",    ["As","Ks","9s","5s","3s","2s","7h"]],
  ["quinte + couleur non alignees", ["9s","8s","7s","6h","5d","2s","3s"]],
  ["roue avec couleur partielle",   ["As","2h","3d","4c","5s","Ks","Qs"]],
  ["full sur brelan+paire", ["Qs","Qh","Qd","7c","7s","2h","3d"]],
  ["quinte haute As",     ["As","Kh","Qd","Jc","Ts","2h","3d"]],
];
for (const [nom, cartes] of cas) {
  const main = cartes.map(k);
  const attendu = evaluer(main).score, obtenu = scoreRapide(main);
  const ok = attendu === obtenu;
  verifie(ok, `${nom} : ${obtenu} au lieu de ${attendu}`);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${nom.padEnd(30)} ${nommer(evaluer(main))}`);
}

/* Débit : c'est lui qui décide du nombre de tirages qu'on peut se permettre. */
console.log("— Débit —");
const echantillon = [];
for (let i = 0; i < 2000; i++) echantillon.push(mainAleatoire(7));
for (const fn of [["evaluer", (m) => evaluer(m).score], ["scoreRapide", scoreRapide]]) {
  const nb = fn[0] === "evaluer" ? 100000 : 2000000;
  const t0 = process.hrtime.bigint();
  let somme = 0;
  for (let i = 0; i < nb; i++) somme += fn[1](echantillon[i % 2000]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${fn[0].padEnd(12)} ${Math.round(nb / (ms / 1000)).toLocaleString("fr-FR")} mains/s`);
}

console.log(echecs === 0 ? "\nTous les tests passent." : `\n${echecs} écart(s).`);
process.exit(echecs === 0 ? 0 : 1);
