/* ============================================================
   SONS — synthétisés, pas enregistrés
   Un claquement de carte et un choc de jetons sont des transitoires de
   bruit filtré : la Web Audio API les fabrique très bien, ce qui évite
   d'ajouter des fichiers audio à un projet qui n'a aucune dépendance.

   Le contexte audio ne démarre qu'après un geste du joueur — tous les
   navigateurs l'exigent. `eveiller()` doit donc être branché sur une
   première interaction.
   ============================================================ */

const VOLUME = 0.5;

let contexte = null;
let sortie = null;
let bruitBlanc = null;
let actif = true;

/* Un seul tampon de bruit, relu à des vitesses et avec des filtres
   différents : c'est ce qui donne des sons proches sans être identiques. */
function preparerBruit(ctx) {
  const n = Math.floor(ctx.sampleRate * 0.25);
  const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
  const donnees = tampon.getChannelData(0);
  for (let i = 0; i < n; i++) donnees[i] = Math.random() * 2 - 1;
  return tampon;
}

function assurerContexte() {
  if (contexte) return contexte;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  contexte = new Ctx();
  sortie = contexte.createGain();
  sortie.gain.value = VOLUME;
  sortie.connect(contexte.destination);
  bruitBlanc = preparerBruit(contexte);
  return contexte;
}

/* À brancher sur la première interaction : sans geste préalable, le
   navigateur laisse le contexte suspendu et rien ne s'entend. */
export function eveiller() {
  const ctx = assurerContexte();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

export function estActif() { return actif; }

export function basculer() {
  actif = !actif;
  try { localStorage.setItem("poker.son", actif ? "1" : "0"); } catch (e) {}
  if (actif) eveiller();
  return actif;
}

export function restaurerPreference() {
  try { actif = localStorage.getItem("poker.son") !== "0"; } catch (e) { actif = true; }
  return actif;
}

/* Peut-on jouer maintenant ? Un onglet en arrière-plan reste silencieux :
   l'onglet de l'hôte y passe le plus clair de son temps, et personne ne
   veut entendre une table qu'il ne regarde pas. */
function jouable() {
  if (!actif || document.hidden) return null;
  const ctx = assurerContexte();
  if (!ctx || ctx.state !== "running") return null;
  return ctx;
}

/* Une salve de bruit filtré, brève, avec attaque nette et chute rapide.
   C'est la brique commune aux deux sons. */
function salve(ctx, { debut, frequence, q, gain, duree, vitesse }) {
  const source = ctx.createBufferSource();
  source.buffer = bruitBlanc;
  source.playbackRate.value = vitesse;

  const filtre = ctx.createBiquadFilter();
  filtre.type = "bandpass";
  filtre.frequency.value = frequence;
  filtre.Q.value = q;

  const enveloppe = ctx.createGain();
  enveloppe.gain.setValueAtTime(0.0001, debut);
  enveloppe.gain.exponentialRampToValueAtTime(gain, debut + 0.005);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, debut + duree);

  source.connect(filtre).connect(enveloppe).connect(sortie);
  // Départ à un endroit quelconque du tampon : deux salves consécutives
  // ne sont jamais exactement le même bruit.
  source.start(debut, Math.random() * 0.15);
  source.stop(debut + duree + 0.02);
}

/* Carte que l'on retourne : un froissement mat, médium, qui s'éteint vite. */
export function carte(delaiMs = 0) {
  const ctx = jouable();
  if (!ctx) return;
  const debut = ctx.currentTime + delaiMs / 1000;
  salve(ctx, {
    debut,
    frequence: 1700 + Math.random() * 900,
    q: 0.8,
    gain: 1.15,
    duree: 0.10,
    vitesse: 0.9 + Math.random() * 0.3,
  });
}

/* Jetons : deux ou trois chocs très courts et aigus, légèrement décalés,
   plus un corps résonant grave qui leur donne du poids. */
export function jeton(delaiMs = 0) {
  const ctx = jouable();
  if (!ctx) return;
  const base = ctx.currentTime + delaiMs / 1000;
  const chocs = 2 + (Math.random() < 0.4 ? 1 : 0);

  for (let i = 0; i < chocs; i++) {
    salve(ctx, {
      debut: base + i * (0.022 + Math.random() * 0.018),
      frequence: 3600 + Math.random() * 2200,
      q: 1.6,
      gain: 0.85 - i * 0.18,
      duree: 0.045,
      vitesse: 1.1 + Math.random() * 0.5,
    });
  }

  const corps = ctx.createOscillator();
  corps.type = "triangle";
  corps.frequency.setValueAtTime(820 + Math.random() * 260, base);
  const enveloppe = ctx.createGain();
  enveloppe.gain.setValueAtTime(0.0001, base);
  enveloppe.gain.exponentialRampToValueAtTime(0.26, base + 0.004);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, base + 0.07);
  corps.connect(enveloppe).connect(sortie);
  corps.start(base);
  corps.stop(base + 0.09);
}
