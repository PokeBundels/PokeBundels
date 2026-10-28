// Setgegevens ophalen bij TCGdex (Engelse kaarten) en lokaal bewaren

import { db } from './db.js';

const API = 'https://api.tcgdex.net/v2/en';
const SERIES = ['sv', 'me'];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TCGdex gaf ${res.status} voor ${url}`);
  return res.json();
}

/** Lijst van beschikbare sets (Scarlet & Violet + Mega Evolution), nieuwste eerst. */
export async function listSets(force = false) {
  const cached = await db.get('setlist');
  if (cached && !force && Date.now() - cached.at < 7 * 864e5) return cached.sets;
  const all = [];
  for (const s of SERIES) {
    try {
      const serie = await getJson(`${API}/series/${s}`);
      for (const set of serie.sets || []) {
        all.push({ id: set.id, name: set.name, serie: serie.name, cardCount: set.cardCount?.official ?? set.cardCount?.total ?? null });
      }
    } catch (e) {
      if (s === 'sv') throw e; // ME bestaat misschien (nog) niet in TCGdex
    }
  }
  all.reverse();
  await db.set('setlist', { at: Date.now(), sets: all });
  return all;
}

/**
 * Volledige setgegevens met per kaart naam, nummer, zeldzaamheid en categorie.
 * TCGdex geeft de zeldzaamheid niet in de setlijst, dus elke kaart wordt één keer opgehaald
 * en daarna lokaal bewaard. onProgress(gedaan, totaal)
 */
export async function getSet(setId, { force = false, onProgress } = {}) {
  const key = `set:${setId}`;
  const cached = await db.get(key);
  if (cached && !force && cached.complete) return cached;

  const set = await getJson(`${API}/sets/${encodeURIComponent(setId)}`);
  const briefs = set.cards || [];
  const old = new Map((cached?.cards || []).map((c) => [c.id, c]));
  const cards = new Array(briefs.length);
  let done = 0;
  let failed = 0;
  const queue = briefs.map((b, i) => ({ b, i }));

  async function worker() {
    while (queue.length) {
      const { b, i } = queue.shift();
      const prev = old.get(b.id);
      if (prev && prev.rarity && !force) {
        cards[i] = prev;
      } else {
        try {
          const d = await getJson(`${API}/cards/${encodeURIComponent(b.id)}`);
          cards[i] = {
            id: d.id, localId: String(d.localId), name: d.name,
            rarity: d.rarity || '', category: d.category || '',
            image: d.image || b.image || null,
          };
        } catch {
          failed++;
          cards[i] = { id: b.id, localId: String(b.localId), name: b.name, rarity: '', category: '', image: b.image || null };
        }
      }
      done++;
      onProgress?.(done, briefs.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const result = {
    id: set.id, name: set.name, serie: set.serie?.name || '',
    cards, complete: failed === 0, fetchedAt: Date.now(),
  };
  await db.set(key, result);
  return result;
}

export function imageUrl(card, quality = 'low') {
  return card?.image ? `${card.image}/${quality}.webp` : null;
}
