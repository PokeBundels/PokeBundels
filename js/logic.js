// PokeBundels — pure rekenlogica (geen DOM, testbaar in Node)

export const DEFAULT_SETTINGS = {
  premiumSets: ['sv03.5', 'sv08.5', 'sv10'],
  setBundle: { size: 50, shiny: 5, price: 5 },
  premiumBundle: { size: 50, shiny: 5, price: 7.5 },
  randomBundle: { size: 50, shiny: 5, price: 4.5 },
  premiumRestToRandom: false,
  activeMode: 1,
  bonusThreshold: 25,
  mySets: [],
};

export const MODES = [
  { k: 1, label: 'Geen dubbels' },
  { k: 2, label: 'Max. 2×' },
  { k: 5, label: 'Max. 5×' },
];

/** Niet-blinkende kaart = rarity Common of Uncommon (in SV/ME zijn rares altijd holo). */
export function isNonShiny(card) {
  const r = (card.rarity || '').toLowerCase();
  return r === 'common' || r === 'uncommon';
}

/**
 * Hoogste aantal bundels B van n kaarten waarbij één kaart max. k keer per bundel voorkomt.
 * Haalbaar desda sum(min(c_i, k*B)) >= n*B.
 */
export function maxBundles(counts, n, k) {
  if (n <= 0) return 0;
  const total = counts.reduce((a, c) => a + c, 0);
  for (let B = Math.floor(total / n); B > 0; B--) {
    let s = 0;
    const cap = k * B;
    for (const c of counts) s += c < cap ? c : cap;
    if (s >= n * B) return B;
  }
  return 0;
}

/**
 * Stel één bundel samen uit een pool: telkens één exemplaar nemen van de kaart
 * met het hoogste resterende aantal die nog niet k keer in deze bundel zit.
 * pool: Map(id -> count) — wordt aangepast. Geeft [{id, count}] of null als het niet lukt.
 */
export function pickOne(pool, n, k, tiebreak) {
  const taken = new Map();
  for (let i = 0; i < n; i++) {
    let bestId = null;
    let bestC = 0;
    for (const [id, c] of pool) {
      if (c <= 0) continue;
      if ((taken.get(id) || 0) >= k) continue;
      if (c > bestC || (c === bestC && tiebreak && bestId !== null && tiebreak(id, bestId) < 0)) {
        bestC = c;
        bestId = id;
      }
    }
    if (bestId === null) {
      // terugdraaien
      for (const [id, t] of taken) pool.set(id, pool.get(id) + t);
      return null;
    }
    pool.set(bestId, bestC - 1);
    taken.set(bestId, (taken.get(bestId) || 0) + 1);
  }
  return [...taken].map(([id, count]) => ({ id, count }));
}

/** Verdeel zo veel mogelijk bundels uit een lijst kaarten [{id,count}]. */
export function allocate(cards, n, k, tiebreak) {
  const counts = cards.map((c) => c.count).filter((c) => c > 0);
  let B = maxBundles(counts, n, k);
  while (B > 0) {
    const pool = new Map(cards.filter((c) => c.count > 0).map((c) => [c.id, c.count]));
    const bundles = [];
    let ok = true;
    for (let b = 0; b < B; b++) {
      const one = pickOne(pool, n, k, tiebreak);
      if (!one) { ok = false; break; }
      bundles.push(one);
    }
    if (ok) {
      const leftover = [...pool].filter(([, c]) => c > 0).map(([id, count]) => ({ id, count }));
      return { bundles, leftover };
    }
    B--;
  }
  return { bundles: [], leftover: cards.filter((c) => c.count > 0).map((c) => ({ id: c.id, count: c.count })) };
}

const sum = (arr) => arr.reduce((a, c) => a + c.count, 0);

/**
 * Volledige analyse voor één modus k.
 * cards: [{id, setId, localId, name, rarity, category, count}] — alle kaarten in voorraad.
 * setNames: {setId: naam}
 */
export function analyse(cards, settings, k, setNames = {}) {
  const premium = new Set(settings.premiumSets || []);
  const eligible = cards.filter((c) => c.count > 0 && isNonShiny(c));
  const byId = new Map(eligible.map((c) => [c.id, c]));
  const order = (a, b) => {
    const A = byId.get(a), Bc = byId.get(b);
    if (!A || !Bc) return 0;
    if (A.setId !== Bc.setId) return A.setId < Bc.setId ? -1 : 1;
    return String(A.localId).localeCompare(String(Bc.localId), undefined, { numeric: true });
  };

  const setPools = {};
  for (const c of eligible) (setPools[c.setId] ||= []).push({ id: c.id, count: c.count });

  const randomPool = [];
  const premiumRest = [];
  const pushRest = (list) => {
    for (const x of list) {
      const card = byId.get(x.id);
      if (premium.has(card.setId) && !settings.premiumRestToRandom) premiumRest.push(x);
      else randomPool.push(x);
    }
  };

  // 1. Sets
  const setRes = {};
  for (const [setId, pool] of Object.entries(setPools)) {
    const isPrem = premium.has(setId);
    const cfg = isPrem ? settings.premiumBundle : settings.setBundle;
    const n = cfg.size - cfg.shiny;
    const { bundles, leftover } = allocate(pool, n, k, order);
    setRes[setId] = {
      setId, name: setNames[setId] || setId, premium: isPrem, bundles,
      unique: pool.length, total: sum(pool), rest: sum(leftover),
      price: cfg.price, shiny: cfg.shiny, size: cfg.size,
    };
    pushRest(leftover);
  }

  // 2. Random (overschot uit gewone sets)
  const rb = settings.randomBundle;
  // zelfde kaart kan uit meerdere restlijsten komen → samenvoegen
  const merged = new Map();
  for (const x of randomPool) merged.set(x.id, (merged.get(x.id) || 0) + x.count);
  const randomCards = [...merged].map(([id, count]) => ({ id, count }));
  const rnd = allocate(randomCards, rb.size - rb.shiny, k, order);
  const randomRes = {
    bundles: rnd.bundles, unique: randomCards.length, total: sum(randomCards), rest: sum(rnd.leftover),
    price: rb.price, shiny: rb.shiny, size: rb.size,
    shinyBySet: {},
  };
  // uit welke sets komen de random-kaarten (voor de holo/reverse-tip)
  for (const b of rnd.bundles) for (const x of b) {
    const s = byId.get(x.id).setId;
    randomRes.shinyBySet[s] = (randomRes.shinyBySet[s] || 0) + x.count;
  }

  // Samenvatting
  const shinyNeed = {}; // setId -> aantal
  let bundleCount = 0, revenue = 0;
  for (const s of Object.values(setRes)) {
    if (!s.bundles.length) continue;
    shinyNeed[s.setId] = (shinyNeed[s.setId] || 0) + s.bundles.length * s.shiny;
    bundleCount += s.bundles.length;
    revenue += s.bundles.length * s.price;
  }
  const randomShiny = rnd.bundles.length * rb.shiny;
  bundleCount += rnd.bundles.length;
  revenue += rnd.bundles.length * rb.price;

  return {
    k, sets: setRes, random: randomRes,
    premiumRest: sum(premiumRest),
    summary: {
      bundleCount, revenue, shinyNeed, randomShiny,
      shinyTotal: Object.values(shinyNeed).reduce((a, c) => a + c, 0) + randomShiny,
    },
  };
}

/** Kaartnummers vergelijken los van voorloopnullen ("007" == "7", "TG05" == "tg5"). */
export function normNr(x) {
  return String(x ?? '').trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
}

/** Controleer en normaliseer een importbestand van Claude. */
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Geen geldige JSON.'); }
  const list = Array.isArray(data) ? data : data.cards;
  if (!Array.isArray(list)) throw new Error('Geen "cards"-lijst gevonden.');
  const out = [];
  for (const [i, r] of list.entries()) {
    const setId = String(r.setId || r.set || '').trim();
    const localId = String(r.localId ?? r.number ?? r.nr ?? '').trim();
    const count = Number(r.count ?? r.aantal ?? 1);
    if (!setId || !localId) throw new Error(`Regel ${i + 1}: setId of localId ontbreekt.`);
    if (!Number.isFinite(count) || count < 0) throw new Error(`Regel ${i + 1}: ongeldig aantal.`);
    out.push({ setId, localId, name: r.name || '', count: Math.round(count) });
  }
  return { mode: data.mode === 'set' ? 'set' : 'add', cards: out };
}
