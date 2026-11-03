// PokeBundels — pure rekenlogica (geen DOM, testbaar in Node)

// Standaardteksten voor zoekertjes. {naam} = naam gekozen bij Maak (standaard de naam uit Instellingen),
// {pokemon} = gekozen Pokémon bij Maak. {cu} = gewone kaarten + energy samen. Invulvelden: {naam} {kaarten} {cu} {holo} {energy} {extras} {set} {prijs}
// {hashtag} {hashtagsoort} {hashtagset} {hashtagpokemon} {zoekwoorden}. Een regel waarin een invulveld leeg of 0 is, valt weg.
export const TEMPLATES = {
  tinTitle: '{naam} met {kaarten} Pokémon kaarten ({set})',
  tinText: [
    '{naam} gevuld met {kaarten} Engelse Pokémon kaarten uit {set}.',
    '• {cu} gewone kaarten',
    '• {holo} blinkende kaarten (holo/reverse)',
    '• Met o.a. {pokemon}',
    '• Extra: {extras}',
    'Geen dubbels in de tin.',
    '',
    'Zelf uit boosters getrokken, overschot van mijn eigen verzameling.',
    'Leuk als cadeautje of om een verzameling mee te beginnen.',
    '',
    '{hashtag} {hashtagsoort} {hashtagset} {hashtagpokemon}',
    '',
    '{zoekwoorden}',
  ].join('\n'),
  bundleTitle: 'Pokémon kaarten setje – {kaarten} kaarten {set}',
  bundleText: [
    'Setje van {kaarten} Engelse Pokémon kaarten uit {set}.',
    '• {cu} gewone kaarten',
    '• {holo} blinkende kaarten (holo/reverse)',
    '• Met o.a. {pokemon}',
    '• Extra: {extras}',
    'Geen dubbels in het setje.',
    '',
    'Zelf uit boosters getrokken, overschot van mijn eigen verzameling.',
    'Je krijgt de kaarten van de foto’s.',
    '',
    '{hashtag} {hashtagsoort} {hashtagset} {hashtagpokemon}',
    '',
    '{zoekwoorden}',
  ].join('\n'),
};

const pack = (id, kind, name, cu, shiny, price, source, extra = {}) => ({
  id, kind, name, cu, shiny, energy: 0, extras: '', source, price,
  stock: kind === 'tin' ? 0 : null,
  title: kind === 'tin' ? TEMPLATES.tinTitle : TEMPLATES.bundleTitle,
  text: kind === 'tin' ? TEMPLATES.tinText : TEMPLATES.bundleText,
  ...extra,
});

// Startwaarden voor tins (oktober 2026). "accessoires" = sticker, artkaartje, coin… (staan op de foto).
const TIN_DEFAULTS = [
  { id: 'mini', name: 'Mini tin', cu: 20, energy: 3, shiny: 2, price: 4.5, extras: 'accessoires' },
  { id: 'pen', name: 'Pennenzak tin', cu: 40, energy: 5, shiny: 5, price: 9.5, extras: 'accessoires' },
  { id: 'tin', name: 'Octagon tin', cu: 60, energy: 7, shiny: 8, price: 14.5, extras: 'accessoires' },
  { id: 'stack', name: 'Stack tin', cu: 60, energy: 7, shiny: 8, price: 14.5, extras: 'accessoires' },
  { id: 'map', name: 'Mapje', cu: 0, energy: 0, shiny: 0, price: 0, extras: '' },
];

/** Standaard verpakkingen. Tins krijgen altijd voorrang in de analyse, daarna bundels, in de volgorde van de lijst. */
export function defaultPacks() {
  return [
    ...TIN_DEFAULTS.map((t) => pack(t.id, 'tin', t.name, t.cu, t.shiny, t.price, 'mix', { energy: t.energy, extras: t.extras })),
    pack('set', 'bundle', 'Setbundel', 40, 5, 6, 'perset', { energy: 5 }),
    pack('random', 'bundle', 'Random bundel', 40, 5, 4.5, 'mix', { energy: 5 }),
  ];
}

export const DEFAULT_SETTINGS = {
  packs: defaultPacks(),
  activeMode: 1,
  packsVersion: 6,
  hashtag: 'pokebundelsbe',
  keywords: 'pokemon pokémon pokemonkaarten pokemoncards kaarten scarlet violet cadeau cadeautje cadeautip verjaardag verjaardagscadeau sinterklaas kerst verzamelen setje bundel tradingcards tcg',
  mySets: [],
  rareOk: [], // kaarten zonder common/uncommon die je bewust aan je voorraad toevoegde
};

/** Oude instellingen (setBundle/randomBundle/tins) omzetten naar packs. */
export function migrateSettings(saved) {
  const out = { ...structuredClone(DEFAULT_SETTINGS), ...(saved || {}) };
  if (!saved?.packs) {
    const packs = defaultPacks();
    const setB = packs.find((p) => p.id === 'set');
    const rndB = packs.find((p) => p.id === 'random');
    if (saved?.setBundle) Object.assign(setB, { energy: 0, cu: saved.setBundle.size - saved.setBundle.shiny, shiny: saved.setBundle.shiny, price: saved.setBundle.price });
    if (saved?.randomBundle) Object.assign(rndB, { energy: 0, cu: saved.randomBundle.size - saved.randomBundle.shiny, shiny: saved.randomBundle.shiny, price: saved.randomBundle.price });
    for (const t of saved?.tins || []) {
      packs.splice(packs.findIndex((p) => p.kind === 'bundle'), 0,
        pack(t.id, 'tin', t.name, Math.max(0, t.size - t.shiny), t.shiny, t.price, 'mix', { stock: t.stock }));
    }
    out.packs = packs;
  }
  if ((saved?.packsVersion || 0) < 2) {
    // nieuwe startwaarden voor de standaardtins; voorraad en bron blijven behouden
    for (const t of TIN_DEFAULTS) {
      const p = out.packs.find((x) => x.id === t.id);
      if (p) Object.assign(p, { name: t.name, cu: t.cu, energy: t.energy, shiny: t.shiny, price: t.price, extras: t.extras });
      else out.packs.splice(out.packs.filter((x) => x.kind === 'tin').length, 0, pack(t.id, 'tin', t.name, t.cu, t.shiny, t.price, 'mix', { energy: t.energy, extras: t.extras }));
    }
    const order = TIN_DEFAULTS.map((t) => t.id);
    const tins = out.packs.filter((x) => x.kind === 'tin').sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
    out.packs = [...tins, ...out.packs.filter((x) => x.kind !== 'tin')];
    out.packsVersion = 2;
  }
  if ((saved?.packsVersion || 0) < 3) {
    // energy niet apart in zoekertjes, "accessoires" zonder "van de tin", standaardprijzen €0,50 lager
    const oldPrice = { mini: 5, pen: 10, tin: 15, stack: 15, set: 6.5, random: 5 };
    for (const p of out.packs) {
      p.text = String(p.text || '').split('\n').filter((l) => !l.includes('{energy}')).join('\n')
        .replace('• {cu} gewone kaarten (common/uncommon)', '• {cu} gewone kaarten');
      if (p.extras === 'accessoires van de tin') p.extras = 'accessoires';
      if (oldPrice[p.id] !== undefined && p.price === oldPrice[p.id]) p.price = oldPrice[p.id] - 0.5;
    }
    out.packsVersion = 3;
  }
  if ((saved?.packsVersion || 0) < 4) {
    // regel voor gekozen Pokémon toevoegen onder de blinkende kaarten
    for (const p of out.packs) {
      const lines = String(p.text || '').split('\n');
      if (lines.some((l) => l.includes('{pokemon}'))) continue;
      const i = lines.findIndex((l) => l.includes('{holo}'));
      if (i >= 0) { lines.splice(i + 1, 0, '• Met o.a. {pokemon}'); p.text = lines.join('\n'); }
    }
    out.packsVersion = 4;
  }
  if ((saved?.packsVersion || 0) < 5) {
    // hashtags van de Pokémon in de tin/bundel achter de andere hashtags
    for (const p of out.packs) {
      if (String(p.text || '').includes('{hashtagpokemon}')) continue;
      p.text = String(p.text || '').replace('{hashtagset}', '{hashtagset} {hashtagpokemon}');
    }
    out.packsVersion = 5;
  }
  if ((saved?.packsVersion || 0) < 6) {
    // bundels: 45 gewone kaarten = 40 uit de inventaris + 5 energy (zoals de tins)
    for (const p of out.packs) {
      if (p.kind !== 'tin' && (p.energy || 0) === 0 && p.cu >= 5) { p.cu -= 5; p.energy = 5; }
    }
    out.packsVersion = 6;
  }
  for (const k of ['bonusThreshold', 'setBundle', 'randomBundle', 'tins', 'themeBundle', 'themes', 'themesFromPremium', 'premiumSets', 'premiumBundle', 'premiumRestToRandom']) delete out[k];
  return out;
}

/** Thema-tins eerst (die reserveren hun Pokémon), dan de andere tins, dan bundels; binnen elk de volgorde uit de instellingen. */
export function orderedPacks(packs) {
  const themed = (p) => themeOf(p).n > 0;
  return [
    ...packs.filter((p) => p.kind === 'tin' && themed(p)),
    ...packs.filter((p) => p.kind === 'tin' && !themed(p)),
    ...packs.filter((p) => p.kind !== 'tin' && themed(p)),
    ...packs.filter((p) => p.kind !== 'tin' && !themed(p)),
  ];
}

/** Thema van een tin/bundel: namen (komma-gescheiden) en hoeveel daarvan er in elke tin/bundel moeten. */
export function themeOf(p) {
  const names = String(p.themeNames || '').split(',').map((t) => t.trim()).filter(Boolean);
  const n = names.length ? Math.max(0, Math.round(p.themeN || 0)) : 0;
  return { names, n };
}

/** Naam als los woord: "Eevee" vindt ook "Eevee ex", "Zorua" ook "N's Zorua", maar "Mew" niet "Mewtwo". */
export function nameMatches(cardName, names) {
  const n = String(cardName || '').toLowerCase();
  return names.some((q) => {
    const e = q.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return e && new RegExp(`(^|[^a-z0-9])${e}($|[^a-z0-9])`, 'i').test(n);
  });
}

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

/** Set-ID uit een kaart halen ("swsh1-12" -> "swsh1"). */
export function setIdOf(card) {
  if (card.setId) return card.setId;
  const id = String(card.id || '');
  return id.slice(0, id.lastIndexOf('-'));
}

/** Sets van vóór Scarlet & Violet. Daar bestaan niet-holo rares; vanaf SV is elke rare holo. */
export function isOldSet(setId) {
  return !/^(sv|me)/i.test(String(setId || ''));
}

/** Niet-holo rare: rarity precies "Rare" in een oudere set. */
export function isNonHoloRare(card) {
  return (card.rarity || '').toLowerCase() === 'rare' && isOldSet(setIdOf(card));
}

/** Komt in bundels: common/uncommon, of een andere kaart die je bij het toevoegen bevestigd hebt. */
export function isBundleCard(card, rareOk = []) {
  return isNonShiny(card) || rareOk.includes(card.id);
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
 * Bij gelijke stand wint de laagste rang (rank: Map id -> getal; zonder rank: volgorde van de pool).
 * pool: Map(id -> count) — wordt aangepast. Geeft [{id, count}] of null als het niet lukt.
 */
export function pickOne(pool, n, k, rank = null) {
  const ids = [];
  const cnt = [];
  for (const [id, c] of pool) if (c > 0) { ids.push(id); cnt.push(c); }
  const rk = ids.map((id, i) => (rank ? (rank.get(id) ?? i) : i));
  const taken = new Array(ids.length).fill(0);
  const out = [];
  for (let step = 0; step < n; step++) {
    let best = -1;
    for (let i = 0; i < ids.length; i++) {
      const c = cnt[i] - taken[i];
      if (c <= 0 || taken[i] >= k) continue;
      if (best < 0) { best = i; continue; }
      const bc = cnt[best] - taken[best];
      if (c > bc || (c === bc && rk[i] < rk[best])) best = i;
    }
    if (best < 0) return null; // pool blijft ongewijzigd
    if (taken[best] === 0) out.push(best);
    taken[best]++;
  }
  for (const i of out) pool.set(ids[i], cnt[i] - taken[i]);
  return out.map((i) => ({ id: ids[i], count: taken[i] }));
}

/**
 * Eén bundel voor een pakbon, met zo veel mogelijk variatie:
 * willekeurige kaarten, en liefst geen kaarten die al in `avoid` zitten
 * (bv. bundels van dezelfde set die nog niet verkocht zijn, voor kopers die er meerdere nemen).
 * Voorwaarde: met wat overblijft moeten nog B-1 bundels te maken zijn, zodat je er geen verliest.
 * cards: [{id,count}], avoid: Set van kaart-ids. Geeft [{id,count}] of null.
 */
export function pickVaried(cards, n, k, B, avoid = new Set(), rnd = Math.random, check = null) {
  if (B <= 0) return null;
  const base = cards.filter((c) => c.count > 0);
  const r = new Map(base.map((c) => [c.id, rnd()]));
  const av = (id) => (avoid.has(id) ? 1 : 0);
  const fits = (bundle) => {
    if (!bundle) return false;
    const taken = new Map(bundle.map((x) => [x.id, x.count]));
    const rest = base.map((c) => c.count - (taken.get(c.id) || 0));
    if (!(B - 1 === 0 || maxBundles(rest, n, k) >= B - 1)) return false;
    return !check || check(bundle);
  };
  // Vaste volgorde aflopen: k exemplaren per kaart zolang de bundel niet vol is.
  const byOrder = (order) => {
    const out = [];
    let left = n;
    for (const c of order) {
      if (!left) break;
      const t = Math.min(c.count, k, left);
      if (t > 0) { out.push({ id: c.id, count: t }); left -= t; }
    }
    return left ? null : out;
  };
  const tries = [
    // 1. volledig willekeurig, al gebruikte kaarten achteraan
    () => byOrder([...base].sort((a, b) => av(a.id) - av(b.id) || r.get(a.id) - r.get(b.id))),
    // 2. al gebruikte kaarten achteraan, daarna de grootste stapels eerst
    () => byOrder([...base].sort((a, b) => av(a.id) - av(b.id) || b.count - a.count || r.get(a.id) - r.get(b.id))),
    // 3. grootste stapels eerst (haalt altijd het maximum), bij gelijke stand variatie
    () => pickOne(new Map(base.map((c) => [c.id, c.count])), n, k, new Map(base.map((c) => [c.id, av(c.id) * 2 + r.get(c.id)]))),
  ];
  for (const t of tries) {
    const b = t();
    if (fits(b)) return b;
  }
  return null;
}

/** Verdeel zo veel mogelijk bundels uit een lijst kaarten [{id,count}]. */
export function allocate(cards, n, k, rank = null, cap = Infinity) {
  const counts = cards.map((c) => c.count).filter((c) => c > 0);
  let B = Math.min(cap, maxBundles(counts, n, k));
  while (B > 0) {
    const pool = new Map(cards.filter((c) => c.count > 0).map((c) => [c.id, c.count]));
    const bundles = [];
    let ok = true;
    for (let b = 0; b < B; b++) {
      const one = pickOne(pool, n, k, rank);
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

/** "1 sticker, 2 coins" -> [{name:'sticker', n:1}, {name:'coins', n:2}] */
export function parseExtras(text) {
  return String(text || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\d+)\s*[x×]?\s*(.+)$/i);
    return m ? { name: m[2].trim(), n: Number(m[1]), label: `${m[1]} ${m[2].trim()}` } : { name: t, n: 1, label: t };
  });
}

/**
 * Plan voor één modus k (max. k keer dezelfde kaart per tin/bundel).
 * Tins eerst (zoveel als er op voorraad zijn), daarna bundels, in de volgorde uit de instellingen.
 * Bron per verpakking: 'mix' (alle sets samen), 'perset' (per set apart) of een set-ID.
 * cards: [{id, setId, localId, name, rarity, count}]
 * Geeft {k, units:[{key, packId, kind, ref, name, label, count, bundles, pool, n, ...}], leftover, summary}.
 */
export function analysePlan(cards, settings, k, setNames = {}) {
  const eligible = cards.filter((c) => c.count > 0 && isBundleCard(c, settings.rareOk || []));
  const byId = new Map(eligible.map((c) => [c.id, c]));
  const remaining = new Map(eligible.map((c) => [c.id, c.count]));
  // vaste volgorde bij gelijke stand: set, dan kaartnummer (één keer sorteren, daarna enkel getallen vergelijken)
  const order = new Map([...eligible]
    .sort((A, Bc) => (A.setId !== Bc.setId ? (A.setId < Bc.setId ? -1 : 1)
      : String(A.localId).localeCompare(String(Bc.localId), undefined, { numeric: true })))
    .map((c, i) => [c.id, i]));
  const setIds = [...new Set(eligible.map((c) => c.setId))].sort((a, b) => (setNames[a] || a).localeCompare(setNames[b] || b));
  const poolOf = (src) => [...remaining]
    .filter(([id, c]) => c > 0 && (src === 'mix' || byId.get(id).setId === src))
    .map(([id, count]) => ({ id, count }));

  const units = [];
  for (const p of orderedPacks(settings.packs || [])) {
    const n = Math.max(0, Math.round(p.cu || 0));
    let cap = p.kind === 'tin' ? Math.max(0, Math.round(p.stock || 0)) : Infinity;
    const sources = p.source === 'perset' ? setIds : [p.source || 'mix'];
    const theme = themeOf(p);
    const tn = Math.min(theme.n, n);
    for (const src of sources) {
      const pool = n > 0 ? poolOf(src) : [];
      let bundles = [];
      let themePool = [];
      let otherPool = pool;
      if (n > 0 && cap > 0 && tn > 0) {
        // thema-kaarten apart: elke tin/bundel krijgt er precies tn, de rest komt uit de andere kaarten
        themePool = pool.filter((c) => nameMatches(byId.get(c.id)?.name, theme.names));
        const tIds = new Set(themePool.map((c) => c.id));
        otherPool = pool.filter((c) => !tIds.has(c.id));
        const counts = (list) => list.map((c) => c.count);
        const B = Math.min(cap, maxBundles(counts(themePool), tn, k), n - tn > 0 ? maxBundles(counts(otherPool), n - tn, k) : Infinity);
        if (B > 0) {
          const a1 = allocate(themePool, tn, k, order, B).bundles;
          const a2 = n - tn > 0 ? allocate(otherPool, n - tn, k, order, a1.length).bundles : a1.map(() => []);
          const m = Math.min(a1.length, a2.length);
          bundles = a1.slice(0, m).map((t, i) => [...t, ...a2[i]]);
        }
      } else if (n > 0 && cap > 0) {
        bundles = allocate(pool, n, k, order, cap).bundles;
      }
      for (const b of bundles) for (const x of b) remaining.set(x.id, remaining.get(x.id) - x.count);
      if (cap !== Infinity) cap -= bundles.length;
      const setName = src === 'mix' ? '' : (setNames[src] || src);
      units.push({
        key: `${p.id}|${src}`, packId: p.id, kind: p.kind, ref: src, name: p.name, setName,
        // setnaam er alleen bij als die nog niet in de naam van de tin/bundel staat
        label: setName && !p.name.toLowerCase().includes(setName.toLowerCase()) ? `${p.name} · ${setName}` : p.name,
        count: bundles.length, bundles, pool, n,
        themeN: tn, themeNames: theme.names, themePool, otherPool,
        shiny: p.shiny || 0, energy: p.energy || 0, extras: p.extras || '', price: p.price || 0,
        size: n + (p.shiny || 0) + (p.energy || 0),
      });
    }
  }

  const leftover = [...remaining].reduce((a, [, c]) => a + c, 0);
  const total = eligible.reduce((a, c) => a + c.count, 0);
  const extras = {};
  let tins = 0, bundlesN = 0, revenue = 0, shiny = 0, energy = 0;
  for (const u of units) {
    if (!u.count) continue;
    if (u.kind === 'tin') tins += u.count; else bundlesN += u.count;
    revenue += u.count * u.price;
    shiny += u.count * u.shiny;
    energy += u.count * u.energy;
    for (const x of parseExtras(u.extras)) extras[x.name] = (extras[x.name] || 0) + x.n * u.count;
  }
  return {
    k, units, leftover,
    summary: { tins, bundles: bundlesN, revenue, shiny, energy, extras, total, used: total - leftover, leftover },
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
