// Moteur Arpegiator : pur, sans DOM, testable dans Node.
// Entrée  : des notes MIDI tenues (l'accord) + un motif de pas + des options.
// Sortie  : une liste d'événements {t, dur, pitch, vel} en noires.

// Modes d'ordonnancement des notes de l'accord.
const ORDERS = ["up", "down", "updown", "downup", "random", "as-played", "chord"];

// Les subdivisions disponibles, en noires par pas.
// 1/4 = 1.0, 1/8 = 0.5, 1/8T = 1/3, 1/16 = 0.25, 1/16T = 1/6, 1/32 = 0.125.
const RATES = {
  "1/4":   1,
  "1/8":   1 / 2,
  "1/8T":  1 / 3,
  "1/16":  1 / 4,
  "1/16T": 1 / 6,
  "1/32":  1 / 8,
};

// Petit PRNG déterministe basé sur une graine entière.
function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return function rand() {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// Construit la séquence des notes à parcourir, selon l'ordre choisi.
// Les notes « as-played » sont dans l'ordre où l'utilisateur les a tenues.
function orderNotes(notes, order) {
  if (!notes.length) return [];
  const asc = [...notes].sort((a, b) => a - b);
  const desc = [...asc].reverse();
  switch (order) {
    case "up":       return asc;
    case "down":     return desc;
    case "updown":   return asc.length > 1 ? [...asc, ...desc.slice(1, -1)] : asc;
    case "downup":   return desc.length > 1 ? [...desc, ...asc.slice(1, -1)] : desc;
    case "as-played":return notes.slice();
    case "chord":    return [asc]; // cas spécial : un seul « pas » qui joue toutes les notes.
    case "random":   // on tire au vol dans renderPattern, ici on rend l'ordre asc par défaut.
    default:         return asc;
  }
}

// Convertit un index de pas (0..) en index dans la séquence de notes,
// en appliquant la direction. Pour "random" on passe un `rand()`.
function pickFromSequence(seq, i, order, rand) {
  if (order === "random") return seq[Math.floor(rand() * seq.length)];
  const n = seq.length;
  return seq[((i % n) + n) % n];
}

// Rend la séquence d'événements pour un motif de pas et un accord donné.
// pattern = tableau de { on, degree, octave, vel, gate, tie, prob } de longueur `steps`.
// opts    = { rate, order, steps, seed, octaves, swing } — swing en 0..1 sur les pas pairs.
function renderPattern(notes, pattern, opts) {
  const rate   = RATES[opts.rate] ?? RATES["1/16"];
  const order  = ORDERS.includes(opts.order) ? opts.order : "up";
  const steps  = opts.steps ?? pattern.length;
  const octaves = Math.max(1, opts.octaves ?? 1);
  const swing  = Math.min(0.9, Math.max(0, opts.swing ?? 0));
  const rand   = rngFrom(opts.seed ?? 1);

  // Pour "chord", chaque pas joue l'accord entier ; sinon on déplie sur `octaves`.
  const base = orderNotes(notes, order);
  let seq;
  if (order === "chord") {
    seq = base; // [[n1,n2,...]]
  } else {
    seq = [];
    for (let o = 0; o < octaves; o++) {
      for (const n of base) seq.push(n + 12 * o);
    }
  }

  // `offset` permet au scheduler d'appeler renderPattern pas par pas tout en
  // conservant la progression dans la séquence de l'accord.
  const offset = opts.offset ?? 0;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const st = pattern[i % pattern.length];
    if (!st || !st.on) continue;
    if (st.prob != null && rand() > st.prob) continue;
    if (!seq.length) continue;

    // Position temporelle : swing décale les pas impairs.
    const t0 = i * rate + ((i % 2) ? swing * rate * 0.5 : 0);

    // Longueur de la note : `len` en pas (par défaut 1), + pas « tie » consécutifs.
    // La longueur reste alignée sur la grille, la vraie durée sonore est `gate * len`.
    const len = Math.max(0.25, st.len ?? 1);
    let span = len;
    while (st.tie && i + Math.ceil(span) < steps && pattern[(i + Math.ceil(span)) % pattern.length]?.tie) {
      span += (pattern[(i + Math.ceil(span)) % pattern.length]?.len ?? 1);
    }
    const dur = Math.max(0.02, span * rate * (st.gate ?? 0.8));

    // Note du pas : soit tirée aléatoirement dans la séquence si `rand`,
    // soit l'index courant (dans la séquence) décalé par `degree`.
    const absIdx = offset + i;
    const seqIdx = st.rand ? Math.floor(rand() * seq.length) : absIdx + (st.degree ?? 0);
    const pitched = pickFromSequence(seq, seqIdx, st.rand ? "up" : order, rand);
    const addOct = 12 * (st.octave ?? 0);
    const vel = Math.max(1, Math.min(127, Math.round((st.vel ?? 100))));

    if (Array.isArray(pitched)) {
      for (const p of pitched) out.push({ t: t0, dur, pitch: p + addOct, vel, glide: !!st.glide });
    } else {
      out.push({ t: t0, dur, pitch: pitched + addOct, vel, glide: !!st.glide });
    }
  }
  return out;
}

// Écrit un fichier Standard MIDI (format 0) à partir d'une liste d'événements.
// bpm donne l'horloge ; ppq = ticks par noire.
function toSMF(events, { bpm = 120, ppq = 480 } = {}) {
  // Convertit les événements en messages (note on/off) datés en ticks, triés.
  const msgs = [];
  for (const e of events) {
    const tOn  = Math.round(e.t * ppq);
    const tOff = Math.round((e.t + e.dur) * ppq);
    msgs.push({ t: tOn,  type: 0x90, data: [e.pitch & 0x7f, e.vel & 0x7f] });
    msgs.push({ t: tOff, type: 0x80, data: [e.pitch & 0x7f, 0] });
  }
  msgs.sort((a, b) => a.t - b.t || (a.type === 0x80 ? -1 : 1));

  const varlen = (v) => {
    const b = [v & 0x7f];
    v >>= 7;
    while (v > 0) { b.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return b;
  };
  const track = [];
  // Tempo meta.
  const mpqn = Math.round(60_000_000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);

  let last = 0;
  for (const m of msgs) {
    const d = m.t - last; last = m.t;
    track.push(...varlen(d), m.type, ...m.data);
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track.

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const len = track.length;
  const trkHdr = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trkHdr, ...track]);
}

// Pattern par défaut : 16 pas tous activés, degré croissant, gate 0.8.
function defaultPattern(steps = 16) {
  return Array.from({ length: steps }, (_, i) => ({
    on: true, degree: 0, octave: 0, vel: 100, gate: 0.8, len: 1, tie: false, rand: false, glide: false, prob: 1,
  }));
}

if (typeof module !== "undefined") {
  module.exports = { ORDERS, RATES, rngFrom, orderNotes, renderPattern, toSMF, defaultPattern };
}
if (typeof window !== "undefined") {
  window.Engine = { ORDERS, RATES, rngFrom, orderNotes, renderPattern, toSMF, defaultPattern };
}
