/* Banc d'essai du moteur : joue des milliers de mains avec des actions
   aléatoires et vérifie les invariants de conservation des jetons. */
import {
  creerPartie, asseoir, demarrerMain, agir, actionsPossibles,
  peutDemarrer, siegeDe, construirePots, MAX_SIEGES,
} from "./js/moteur.js";

let echecs = 0;
const verifie = (cond, msg) => { if (!cond) { echecs++; console.log("FAIL " + msg); } };

/* Capital en circulation. Tant que la main court, le pot est « en l'air » et
   s'ajoute aux tapis. Une fois la main terminée, le moteur a reversé le pot
   dans les tapis mais garde `p.pot` affiché : il ne faut plus le compter. */
function jetonsTotaux(p) {
  let t = p.phase === "attente" ? 0 : p.pot;
  for (const j of p.sieges) if (j) t += j.tapis;
  return t;
}

function simuler(nbJoueurs, nbMains, graine) {
  // Générateur pseudo-aléatoire déterministe pour rejouer un scénario.
  let etat = graine;
  const rnd = () => { etat = (etat * 1103515245 + 12345) & 0x7fffffff; return etat / 0x7fffffff; };

  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 2000, secondesParTour: 0 });
  for (let i = 0; i < nbJoueurs; i++) asseoir(p, i, "j" + i, "Joueur " + i);

  const capitalInitial = jetonsTotaux(p);

  for (let main = 0; main < nbMains; main++) {
    if (!peutDemarrer(p)) break;
    const avant = jetonsTotaux(p);
    demarrerMain(p);
    verifie(jetonsTotaux(p) === avant, `main ${main}: jetons créés/perdus à la distribution`);

    // Chaque joueur en jeu doit avoir exactement 2 cartes.
    for (const j of p.sieges) if (j && j.enJeu) {
      verifie(j.cartes.length === 2, `main ${main}: ${j.nom} n'a pas 2 cartes (${j.cartes.length})`);
    }

    let gardeFou = 0;
    while (p.tour >= 0) {
      if (++gardeFou > 500) { verifie(false, `main ${main}: boucle infinie dans les enchères`); break; }
      const siege = p.tour;
      const j = p.sieges[siege];
      const o = actionsPossibles(p, j.id);
      verifie(!!o, `main ${main}: aucune action possible pour le joueur au tour`);
      if (!o) break;

      const tirage = rnd();
      let r;
      if (tirage < 0.12) {
        r = agir(p, j.id, "coucher");
      } else if (tirage < 0.72) {
        r = agir(p, j.id, o.checker ? "checker" : "suivre");
      } else if (o.peutRelancer) {
        // Relance quelque part entre le minimum légal et le tapis.
        const cible = Math.round(o.miniRelance + rnd() * (o.maxiRelance - o.miniRelance));
        r = agir(p, j.id, "relancer", cible);
      } else {
        r = agir(p, j.id, o.checker ? "checker" : "suivre");
      }
      verifie(r.ok, `main ${main}: action refusée — ${r.raison}`);
      if (!r.ok) break;

      verifie(jetonsTotaux(p) === avant, `main ${main}: jetons non conservés après une action`);
      for (const x of p.sieges) if (x) verifie(x.tapis >= 0, `main ${main}: tapis négatif (${x.nom})`);
    }

    // Fin de main : le pot doit être intégralement redistribué.
    verifie(p.phase === "attente", `main ${main}: la main ne s'est pas terminée (phase ${p.phase})`);
    verifie(p.board.length <= 5, `main ${main}: board de ${p.board.length} cartes`);

    const distribue = p.resultats.gains.reduce((s, g) => s + g.montant, 0);
    verifie(distribue === p.pot, `main ${main}: distribué ${distribue} pour un pot de ${p.pot}`);

    // Aucune carte ne doit apparaître deux fois.
    const vues = [...p.board];
    for (const j of p.sieges) if (j && j.cartes.length) vues.push(...j.cartes);
    verifie(new Set(vues).size === vues.length, `main ${main}: carte distribuée en double`);

    const apres = jetonsTotaux(p);
    verifie(apres === capitalInitial, `main ${main}: capital ${apres} au lieu de ${capitalInitial}`);
  }
}

console.log("— Simulations —");
for (let n = 2; n <= 6; n++) {
  for (let g = 1; g <= 40; g++) simuler(n, 30, g * 7919 + n);
  console.log(`  ${n} joueurs : 40 tables × 30 mains`);
}

/* --- Cas dirigés --- */
console.log("— Cas dirigés —");

// Pot latéral : petit tapis all-in, deux gros joueurs continuent.
{
  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 1000, secondesParTour: 0 });
  asseoir(p, 0, "a", "A"); asseoir(p, 1, "b", "B"); asseoir(p, 2, "c", "C");
  p.sieges[2].tapis = 100;                       // C est court
  demarrerMain(p);
  // C fait tapis dès qu'il parle ; A et B suivent, puis se disputent un pot
  // latéral en misant encore au flop — c'est ce qui crée la seconde couche.
  let garde = 0;
  while (p.tour >= 0 && garde++ < 200) {
    const j = p.sieges[p.tour];
    const o = actionsPossibles(p, j.id);
    if (!o) { verifie(false, "pot latéral : joueur au tour sans action possible"); break; }
    let r;
    if (j.id === "c") {
      r = o.peutRelancer ? agir(p, j.id, "relancer", o.maxiRelance) : agir(p, j.id, "suivre");
    } else if (p.phase !== "preflop" && o.peutRelancer && o.miniRelance <= o.tapis + o.maMise) {
      r = agir(p, j.id, o.suivre > 0 ? "suivre" : "relancer", o.miniRelance);
    } else {
      r = agir(p, j.id, o.suivre > 0 ? "suivre" : "checker");
    }
    if (!r.ok) { verifie(false, "pot latéral : action refusée — " + r.raison); break; }
  }
  verifie(!!p.resultats, "pot latéral : la main doit se terminer");
  if (!p.resultats) throw new Error("main non terminée");
  const total = p.resultats.gains.reduce((s, g) => s + g.montant, 0);
  verifie(total === p.pot, `pot latéral : ${total} distribué pour un pot de ${p.pot}`);
  verifie(p.pots.length >= 2, `pot latéral : ${p.pots.length} pot(s), au moins 2 attendus`);
  // C ne peut jamais gagner plus que 100 × 3.
  const gainC = p.resultats.gains.filter((g) => g.siege === 2).reduce((s, g) => s + g.montant, 0);
  verifie(gainC <= 300, `pot latéral : C gagne ${gainC}, plafond 300`);
  console.log(`  pots latéraux : ${p.pots.map((x) => x.montant).join(" + ")} = ${p.pot}`);
}

// Tête-à-tête : le bouton est petite blinde et parle en premier préflop.
{
  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 1000, secondesParTour: 0 });
  asseoir(p, 0, "a", "A"); asseoir(p, 1, "b", "B");
  demarrerMain(p);
  verifie(p.tour === p.bouton, "tête-à-tête : le bouton doit parler en premier préflop");
  verifie(p.sieges[p.bouton].total === 10, "tête-à-tête : le bouton doit poser la petite blinde");
  agir(p, p.sieges[p.tour].id, "suivre");
  agir(p, p.sieges[p.tour].id, "checker");
  verifie(p.phase === "flop", `tête-à-tête : phase ${p.phase} au lieu de flop`);
  verifie(p.tour !== p.bouton, "tête-à-tête : le bouton parle en dernier postflop");
  console.log("  tête-à-tête : ordre de parole correct");
}

// Relance minimum refusée.
{
  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 1000, secondesParTour: 0 });
  asseoir(p, 0, "a", "A"); asseoir(p, 1, "b", "B"); asseoir(p, 2, "c", "C");
  demarrerMain(p);
  const j = p.sieges[p.tour];
  const r = agir(p, j.id, "relancer", 30);       // 30 < 20 + 20
  verifie(!r.ok, "relance sous le minimum : doit être refusée");
  const r2 = agir(p, j.id, "relancer", 40);
  verifie(r2.ok, "relance à 40 (minimum légal) : doit être acceptée");
  console.log("  relance minimum : " + (r.ok ? "KO" : "refus correct") + ", 40 accepté");
}

// Option de la grosse blinde : elle doit pouvoir relancer après des suivis.
{
  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 1000, secondesParTour: 0 });
  asseoir(p, 0, "a", "A"); asseoir(p, 1, "b", "B"); asseoir(p, 2, "c", "C");
  demarrerMain(p);
  const bb = (p.bouton + 2) % 3;
  agir(p, p.sieges[p.tour].id, "suivre");        // UTG = bouton suit
  agir(p, p.sieges[p.tour].id, "suivre");        // SB complète
  verifie(p.tour === bb, `option BB : le tour est au siège ${p.tour}, attendu ${bb}`);
  verifie(p.phase === "preflop", "option BB : on doit encore être préflop");
  console.log("  option de la grosse blinde : respectée");
}

// Tapis inférieur à une relance complète : ne rouvre pas les enchères.
{
  const p = creerPartie({ petiteBlinde: 10, grosseBlinde: 20, tapisDepart: 1000, secondesParTour: 0 });
  asseoir(p, 0, "a", "A"); asseoir(p, 1, "b", "B"); asseoir(p, 2, "c", "C");
  demarrerMain(p);
  const utg = p.sieges[p.tour];
  agir(p, utg.id, "relancer", 100);              // relance pleine à 100
  const court = p.sieges[p.tour];
  court.tapis = 130 - court.mise;                // il ne peut aller qu'à 130
  agir(p, court.id, "relancer", 130);            // tapis à 130, incrément de 30 < 80
  // Le relanceur initial ne doit pas avoir à reparler : il a déjà « parlé »
  // et son aParle ne doit pas avoir été réinitialisé.
  verifie(utg.aParle === true, "tapis court : les enchères ne doivent pas se rouvrir");
  console.log("  tapis inférieur à une relance : n'ouvre pas de nouveau tour");
}

console.log(echecs === 0 ? "\nTous les tests passent." : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
