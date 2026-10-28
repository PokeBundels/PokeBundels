// PokeBundels — app

import { db, persist } from './db.js';
import { listSets, getSet, imageUrl } from './tcgdex.js';
import {
  THEMES, DEFAULT_SETTINGS, MODES, analyse, isNonShiny, themeOf, normNr, parseImport,
} from './logic.js';

const VERSION = '1.0.0';
const DAC7 = { sales: 30, revenue: 2000 };
const PLATFORMS = ['Vinted', '2dehands', 'Anders'];

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  inventory: {},      // cardId -> aantal
  bundles: [],        // gemaakte/verkochte bundels
  sales: [],
  sets: {},           // setId -> setgegevens (uit cache)
  view: 'inv',
  invSet: null,
  invFilter: { all: false, owned: false, q: '' },
  mode: 1,
  pick: new Set(),    // geselecteerde bundels om te verkopen
  invVersion: 0,
  analysisCache: {},
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => '€' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(',00', '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- opslag ----------

async function load() {
  const [settings, inventory, bundles, sales] = await Promise.all([
    db.get('settings'), db.get('inventory'), db.get('bundles'), db.get('sales'),
  ]);
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) };
  for (const k of ['setBundle', 'premiumBundle', 'themeBundle', 'randomBundle', 'themes']) {
    state.settings[k] = { ...DEFAULT_SETTINGS[k], ...(settings?.[k] || {}) };
  }
  state.inventory = inventory || {};
  state.bundles = bundles || [];
  state.sales = sales || [];
  state.mode = state.settings.activeMode || 1;
  for (const id of state.settings.mySets) {
    const s = await db.get(`set:${id}`);
    if (s) state.sets[id] = s;
  }
}

const save = {
  settings: () => db.set('settings', state.settings),
  inventory: () => { state.invVersion++; state.analysisCache = {}; return db.set('inventory', state.inventory); },
  bundles: () => db.set('bundles', state.bundles),
  sales: () => db.set('sales', state.sales),
};

// ---------- helpers ----------

function cardIndex() {
  const map = new Map();
  for (const s of Object.values(state.sets)) for (const c of s.cards) map.set(c.id, { ...c, setId: s.id, setName: s.name });
  return map;
}

function inventoryCards() {
  const out = [];
  for (const s of Object.values(state.sets)) {
    for (const c of s.cards) {
      const count = state.inventory[c.id] || 0;
      if (count > 0) out.push({ ...c, setId: s.id, count });
    }
  }
  return out;
}

function setNames() {
  return Object.fromEntries(Object.values(state.sets).map((s) => [s.id, s.name]));
}

function getAnalysis(k) {
  const key = `${k}:${state.invVersion}:${JSON.stringify(state.settings)}`;
  if (!state.analysisCache[key]) state.analysisCache[key] = analyse(inventoryCards(), state.settings, k, setNames());
  return state.analysisCache[key];
}

function isPremium(setId) { return state.settings.premiumSets.includes(setId); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openSheet(html, onMount) {
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">
    <button class="icon-btn sheet-close" data-action="close-sheet" aria-label="Sluiten"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${html}</div>`;
  root.hidden = false;
  document.body.classList.add('noscroll');
  onMount?.(root.querySelector('.sheet'));
}
function closeSheet() {
  const root = $('#sheet');
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('noscroll');
}

const ICONS = {
  inv: '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/><path d="M4 12h16"/>',
  ana: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bun: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14"/><path d="M12 12l1 2 2 .3-1.5 1.4.4 2.1L12 17l-1.9 1 .4-2.1L9 14.3l2-.3z"/>',
  sale: '<path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  spark: '<path d="M12 2c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8z"/>',
};
const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- render ----------

function render() {
  const nav = [
    ['inv', 'Inventaris'], ['ana', 'Analyse'], ['bun', 'Bundels'], ['sale', 'Verkoop'], ['set', 'Instellingen'],
  ];
  $('#nav').innerHTML = nav.map(([id, label]) => `
    <button class="nav-btn ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}" aria-label="${label}" ${state.view === id ? 'aria-current="page"' : ''}>
      ${icon(id)}<span>${label}</span>
    </button>`).join('');
  const main = $('#main');
  const views = { inv: renderInventory, ana: renderAnalysis, bun: renderBundles, sale: renderSales, set: renderSettings };
  main.innerHTML = views[state.view]();
}

// ----- Inventaris -----

function renderInventory() {
  if (state.invSet && state.sets[state.invSet]) return renderSetDetail(state.invSet);
  const sets = state.settings.mySets.map((id) => state.sets[id]).filter(Boolean);
  let total = 0, unique = 0;
  const rows = sets.map((s) => {
    let t = 0, u = 0;
    for (const c of s.cards) {
      const n = state.inventory[c.id] || 0;
      if (n > 0 && isNonShiny(c)) { t += n; u++; }
    }
    total += t; unique += u;
    return `
      <button class="set-row" data-action="open-set" data-set="${esc(s.id)}">
        <div class="set-row-main">
          <div class="set-row-name">${esc(s.name)} ${isPremium(s.id) ? '<span class="badge gold">Premium</span>' : ''}</div>
          <div class="muted small">${esc(s.id)} · ${esc(s.serie)}</div>
        </div>
        <div class="set-row-stats"><b>${t}</b><span class="muted small">${u} uniek</span></div>
      </button>`;
  }).join('');
  return `
    <header class="page-head">
      <h1>Inventaris</h1>
      <p class="muted">Niet-blinkende kaarten (common/uncommon) per set.</p>
    </header>
    <div class="stats">
      <div class="stat"><b>${total}</b><span>kaarten</span></div>
      <div class="stat"><b>${unique}</b><span>verschillend</span></div>
      <div class="stat"><b>${sets.length}</b><span>sets</span></div>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-action="add-set">${icon('plus', 18)} Set toevoegen</button>
      <button class="btn" data-action="import">${icon('up', 18)} Importeren</button>
    </div>
    <div class="list">${rows || `<div class="empty">Nog geen sets. Voeg een set toe of importeer een bestand.</div>`}</div>`;
}

function filteredCards(set) {
  const f = state.invFilter;
  const q = f.q.trim().toLowerCase();
  return set.cards.filter((c) => {
    if (!f.all && !isNonShiny(c)) return false;
    if (f.owned && !(state.inventory[c.id] > 0)) return false;
    if (q && !(c.name.toLowerCase().includes(q) || normNr(c.localId) === normNr(q))) return false;
    return true;
  });
}

function renderSetDetail(setId) {
  const set = state.sets[setId];
  const f = state.invFilter;
  const cards = filteredCards(set);
  let t = 0, u = 0;
  for (const c of set.cards) { const n = state.inventory[c.id] || 0; if (n > 0 && isNonShiny(c)) { t += n; u++; } }
  const tiles = cards.map((c) => tileHtml(c)).join('');
  return `
    <header class="page-head with-back">
      <button class="icon-btn" data-action="close-set" aria-label="Terug naar sets">${icon('back')}</button>
      <div>
        <h1>${esc(set.name)}</h1>
        <p class="muted small" id="set-stats">${esc(set.id)} · ${t} kaarten · ${u} verschillend</p>
      </div>
    </header>
    <div class="toolbar">
      <input type="search" class="input" placeholder="Zoek naam of nummer" value="${esc(f.q)}" data-input="inv-q" aria-label="Zoek kaart">
      <div class="chips">
        <button class="chip ${!f.all ? 'on' : ''}" data-action="flt-all" data-val="0">Common/Uncommon</button>
        <button class="chip ${f.all ? 'on' : ''}" data-action="flt-all" data-val="1">Alles</button>
        <button class="chip ${f.owned ? 'on' : ''}" data-action="flt-owned">In voorraad</button>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn small" data-action="copy-prompt" data-set="${esc(set.id)}">${icon('copy', 16)} Prompt voor Claude</button>
      <button class="btn small" data-action="import">${icon('up', 16)} Importeren</button>
    </div>
    <div class="grid">${tiles || '<div class="empty">Geen kaarten met deze filter.</div>'}</div>
    <div class="danger-zone">
      <button class="btn ghost small" data-action="refresh-set" data-set="${esc(set.id)}">${icon('refresh', 16)} Setgegevens vernieuwen</button>
      <button class="btn ghost small danger" data-action="remove-set" data-set="${esc(set.id)}">Set uit inventaris halen</button>
    </div>`;
}

function tileHtml(c) {
  const n = state.inventory[c.id] || 0;
  const th = themeOf(c);
  const img = imageUrl(c);
  return `
    <div class="tile ${n > 0 ? 'owned' : ''} ${isNonShiny(c) ? '' : 'shiny'}" data-card="${esc(c.id)}">
      <button class="tile-img" data-action="inc" data-card="${esc(c.id)}" aria-label="${esc(c.name)} +1">
        ${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : `<span class="noimg">${esc(c.name)}</span>`}
        ${th && isNonShiny(c) ? `<span class="tile-theme">${esc(THEMES[th].label.split(' ')[0])}</span>` : ''}
      </button>
      <div class="tile-meta"><span class="nr">#${esc(c.localId)}</span> <span class="nm">${esc(c.name)}</span></div>
      <div class="stepper">
        <button data-action="dec" data-card="${esc(c.id)}" aria-label="Eén minder">${icon('minus', 18)}</button>
        <input type="number" inputmode="numeric" min="0" value="${n}" data-input="count" data-card="${esc(c.id)}" aria-label="Aantal ${esc(c.name)}">
        <button data-action="inc" data-card="${esc(c.id)}" aria-label="Eén meer">${icon('plus', 18)}</button>
      </div>
    </div>`;
}

function setCount(cardId, n) {
  n = Math.max(0, Math.round(n) || 0);
  if (n === 0) delete state.inventory[cardId]; else state.inventory[cardId] = n;
  save.inventory();
  const tile = document.querySelector(`.tile[data-card="${CSS.escape(cardId)}"]`);
  if (tile) {
    tile.classList.toggle('owned', n > 0);
    const inp = tile.querySelector('input');
    if (inp && document.activeElement !== inp) inp.value = n;
  }
  const set = state.sets[state.invSet];
  const st = document.getElementById('set-stats');
  if (set && st) {
    let t = 0, u = 0;
    for (const c of set.cards) { const k = state.inventory[c.id] || 0; if (k > 0 && isNonShiny(c)) { t += k; u++; } }
    st.textContent = `${set.id} · ${t} kaarten · ${u} verschillend`;
  }
}

async function addSetFlow() {
  openSheet(`<h2>Set toevoegen</h2><p class="muted">Sets laden…</p>`);
  let sets;
  try { sets = await listSets(); } catch (e) {
    openSheet(`<h2>Set toevoegen</h2><p class="error">Kon de setlijst niet laden: ${esc(e.message)}</p>
      <label class="field"><span>Set-ID (bv. sv08)</span><input class="input" id="manual-set"></label>
      <div class="btn-row"><button class="btn primary" data-action="add-set-id">Toevoegen</button></div>`);
    return;
  }
  const html = (q = '') => sets
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    .map((s) => `<button class="set-pick ${state.settings.mySets.includes(s.id) ? 'have' : ''}" data-action="pick-set" data-set="${esc(s.id)}">
      <span>${esc(s.name)}</span><span class="muted small">${esc(s.id)} · ${esc(s.serie)}</span></button>`).join('');
  openSheet(`
    <h2>Set toevoegen</h2>
    <input class="input" type="search" placeholder="Zoek set" id="set-search" aria-label="Zoek set">
    <div class="set-pick-list" id="set-pick-list">${html()}</div>
    <details class="small"><summary>Set niet in de lijst?</summary>
      <label class="field"><span>Set-ID (bv. sv08)</span><input class="input" id="manual-set"></label>
      <button class="btn small" data-action="add-set-id">Toevoegen</button>
    </details>`, (el) => {
    el.querySelector('#set-search').addEventListener('input', (e) => {
      el.querySelector('#set-pick-list').innerHTML = html(e.target.value.trim().toLowerCase());
    });
  });
}

async function loadSet(setId, { force = false, open = true } = {}) {
  openSheet(`<h2>Set laden</h2><p class="muted">Kaartgegevens ophalen bij TCGdex… <span id="prog">0%</span></p><div class="bar"><i id="progbar"></i></div>`);
  try {
    const set = await getSet(setId, {
      force,
      onProgress: (d, t) => {
        const p = Math.round((d / t) * 100);
        const a = $('#prog'); if (a) a.textContent = `${d}/${t}`;
        const b = $('#progbar'); if (b) b.style.width = p + '%';
      },
    });
    state.sets[set.id] = set;
    if (!state.settings.mySets.includes(set.id)) { state.settings.mySets.push(set.id); await save.settings(); }
    state.analysisCache = {};
    closeSheet();
    if (!set.complete) toast('Niet alle kaarten konden geladen worden. Vernieuw de set later.');
    if (open) { state.view = 'inv'; state.invSet = set.id; }
    render();
    return set;
  } catch (e) {
    openSheet(`<h2>Set laden mislukt</h2><p class="error">${esc(e.message)}</p><p class="muted small">Controleer je internetverbinding en het set-ID.</p>`);
    return null;
  }
}

function claudePrompt(set) {
  return `Ik stuur je foto's van Pokémon-kaarten (Engels) uit de set "${set.name}" (TCGdex set-ID: ${set.id}). ` +
    `Herken elke kaart aan het kaartnummer onderaan (bv. 012/191) en de naam. Tel elke kaart die je ziet als 1. ` +
    `Geef me daarna enkel een JSON-bestand voor mijn PokeBundels-app in exact dit formaat:\n\n` +
    `{"app":"PokeBundels","mode":"add","cards":[{"setId":"${set.id}","localId":"012","name":"Kaartnaam","count":1}]}\n\n` +
    `Twijfel je over een kaart, vermeld die dan apart onder de JSON zodat ik ze zelf kan nakijken.`;
}

function importSheet() {
  openSheet(`
    <h2>Importeren</h2>
    <p class="muted small">Plak de JSON die Claude je gaf, of kies het bestand. Aantallen worden <b>opgeteld</b> bij je voorraad.</p>
    <textarea class="input mono" id="imp-text" rows="8" placeholder='{"app":"PokeBundels","cards":[{"setId":"sv08","localId":"012","count":1}]}' aria-label="Importtekst"></textarea>
    <div class="btn-row">
      <label class="btn small">Bestand kiezen<input type="file" accept=".json,application/json,text/plain" id="imp-file" hidden></label>
      <label class="check"><input type="checkbox" id="imp-replace"> Aantallen vervangen i.p.v. optellen</label>
    </div>
    <div class="btn-row"><button class="btn primary" data-action="do-import">Importeren</button></div>
    <div id="imp-result"></div>`, (el) => {
    el.querySelector('#imp-file').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (f) el.querySelector('#imp-text').value = await f.text();
    });
  });
}

async function doImport() {
  const text = $('#imp-text').value;
  const replace = $('#imp-replace').checked;
  const out = $('#imp-result');
  let parsed;
  try { parsed = parseImport(text); } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const mode = replace || parsed.mode === 'set' ? 'set' : 'add';
  out.innerHTML = '<p class="muted">Bezig…</p>';
  const bySet = {};
  for (const r of parsed.cards) (bySet[r.setId] ||= []).push(r);
  const unmatched = [];
  let added = 0;
  for (const [setId, rows] of Object.entries(bySet)) {
    let set = state.sets[setId];
    if (!set) {
      try {
        set = await getSet(setId, { onProgress: (d, t) => { out.innerHTML = `<p class="muted">Set ${esc(setId)} laden… ${d}/${t}</p>`; } });
        state.sets[set.id] = set;
        if (!state.settings.mySets.includes(set.id)) state.settings.mySets.push(set.id);
      } catch {
        unmatched.push(...rows.map((r) => `${r.setId} #${r.localId} ${r.name} (set onbekend)`));
        continue;
      }
    }
    const byNr = new Map(set.cards.map((c) => [normNr(c.localId), c]));
    for (const r of rows) {
      let card = byNr.get(normNr(r.localId));
      if (card && r.name && !card.name.toLowerCase().includes(r.name.toLowerCase().split(' ')[0])) {
        unmatched.push(`${r.setId} #${r.localId} "${r.name}" — nummer hoort bij "${card.name}", toch toegevoegd`);
      }
      if (!card && r.name) card = set.cards.find((c) => c.name.toLowerCase() === r.name.toLowerCase());
      if (!card) { unmatched.push(`${r.setId} #${r.localId} ${r.name}`); continue; }
      const cur = state.inventory[card.id] || 0;
      const n = mode === 'set' ? r.count : cur + r.count;
      if (n > 0) state.inventory[card.id] = n; else delete state.inventory[card.id];
      added += r.count;
    }
  }
  await save.settings();
  await save.inventory();
  out.innerHTML = `<p class="ok">${icon('check', 16)} ${added} kaarten verwerkt.</p>` +
    (unmatched.length ? `<p class="error small">Niet (zeker) gevonden:</p><ul class="small">${unmatched.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : '');
  render();
}

// ----- Analyse -----

function renderAnalysis() {
  const k = state.mode;
  const cards = inventoryCards();
  const tabs = MODES.map((m) => `<button class="seg ${m.k === k ? 'on' : ''}" data-action="mode" data-k="${m.k}" role="tab" aria-selected="${m.k === k}">${m.label}</button>`).join('');
  if (!cards.length) {
    return `<header class="page-head"><h1>Bundelvoorstel</h1></header>
      <div class="segs" role="tablist">${tabs}</div>
      <div class="empty">Nog geen kaarten in voorraad.</div>`;
  }
  const a = getAnalysis(k);
  const S = state.settings;
  const active = S.activeMode === k;

  const themeRows = Object.values(a.themes).map((t) => `
    <tr><td>${esc(t.label)}</td><td class="num">${t.unique}</td><td class="num">${t.total}</td>
    <td class="num"><b>${t.bundles.length}</b></td><td class="num">${t.rest}</td></tr>`).join('');

  const setList = Object.values(a.sets).sort((x, y) => (y.premium - x.premium) || x.name.localeCompare(y.name));
  const setRows = setList.map((s) => `
    <tr><td>${esc(s.name)} ${s.premium ? '<span class="badge gold">P</span>' : ''}</td>
    <td class="num">${s.unique}</td><td class="num">${s.total}</td>
    <td class="num"><b>${s.bundles.length}</b></td><td class="num">${s.rest}</td></tr>`).join('');

  const shinyRows = Object.entries(a.summary.shinyNeed).map(([id, n]) =>
    `<li><span>${esc(state.sets[id]?.name || id)}</span><b>${n}</b></li>`).join('');

  return `
    <header class="page-head">
      <h1>Bundelvoorstel</h1>
      <p class="muted small">Eerst thema's, dan sets, de rest gaat naar random. ${S.themesFromPremium ? '' : 'Themakaarten uit premium sets blijven in hun set.'}</p>
    </header>
    <div class="segs" role="tablist">${tabs}</div>
    <div class="stats">
      <div class="stat"><b>${a.summary.bundleCount}</b><span>bundels</span></div>
      <div class="stat"><b>${eur(a.summary.revenue)}</b><span>opbrengst</span></div>
      <div class="stat"><b>${a.summary.shinyTotal}</b><span>holo/reverse nodig</span></div>
    </div>
    <div class="btn-row">
      ${active ? `<span class="pill ok">${icon('check', 16)} Actief plan</span>` : `<button class="btn primary" data-action="use-plan" data-k="${k}">Gebruik dit plan</button>`}
      <button class="btn" data-action="reanalyse">${icon('refresh', 18)} Heranalyseren</button>
    </div>

    <section class="card">
      <h2>Thema's <span class="muted small">(${S.themeBundle.size} kaarten · ${eur(S.themeBundle.price)})</span></h2>
      ${themeRows ? `<table class="tbl"><thead><tr><th>Thema</th><th class="num">Uniek</th><th class="num">Kaarten</th><th class="num">Bundels</th><th class="num">Rest</th></tr></thead><tbody>${themeRows}</tbody></table>` : '<p class="muted">Geen thema\'s actief.</p>'}
      ${a.summary.themeShiny ? `<p class="small">${icon('spark', 14)} ${a.summary.themeShiny} holo/reverse nodig, liefst van het thema.</p>` : ''}
    </section>

    <section class="card">
      <h2>Sets <span class="muted small">(${S.setBundle.size} kaarten · ${eur(S.setBundle.price)} / premium ${eur(S.premiumBundle.price)})</span></h2>
      <table class="tbl"><thead><tr><th>Set</th><th class="num">Uniek</th><th class="num">Kaarten</th><th class="num">Bundels</th><th class="num">Rest</th></tr></thead><tbody>${setRows}</tbody></table>
    </section>

    <section class="card">
      <h2>Random <span class="muted small">(${S.randomBundle.size} kaarten · ${eur(S.randomBundle.price)})</span></h2>
      <p><b>${a.random.bundles.length}</b> bundels uit ${a.random.total} overschotkaarten (${a.random.unique} verschillend). Rest: ${a.random.rest}.</p>
      ${a.premiumRest ? `<p class="muted small">${a.premiumRest} overschotkaarten uit premium sets gaan niet naar random (aan te passen in Instellingen).</p>` : ''}
      ${a.summary.randomShiny ? `<p class="small">${icon('spark', 14)} ${a.summary.randomShiny} holo/reverse nodig uit gewone sets.</p>` : ''}
    </section>

    <section class="card">
      <h2>Holo/reverse nodig per set</h2>
      ${shinyRows ? `<ul class="kv">${shinyRows}</ul>` : '<p class="muted">Geen setbundels.</p>'}
    </section>`;
}

// ----- Bundels -----

function bundleOptions(a) {
  const S = state.settings;
  const opts = [];
  for (const s of Object.values(a.sets)) {
    if (!s.bundles.length) continue;
    opts.push({ type: s.premium ? 'premium' : 'set', ref: s.setId, label: s.name, sub: `${s.size} kaarten · ${s.shiny} holo/reverse uit deze set`, price: s.price, n: s.bundles.length, shinySet: s.setId, shiny: s.shiny });
  }
  for (const t of Object.values(a.themes)) {
    if (!t.bundles.length) continue;
    opts.push({ type: 'theme', ref: t.key, label: t.label, sub: `${t.size} kaarten · ${t.shiny} holo/reverse (liefst van het thema)`, price: t.price, n: t.bundles.length, shiny: t.shiny });
  }
  if (a.random.bundles.length) {
    opts.push({ type: 'random', ref: 'random', label: 'Random pick', sub: `${S.randomBundle.size} kaarten · ${S.randomBundle.shiny} holo/reverse uit gewone sets`, price: a.random.price, n: a.random.bundles.length, shiny: a.random.shiny });
  }
  const rank = { premium: 0, set: 1, theme: 2, random: 3 };
  return opts.sort((x, y) => rank[x.type] - rank[y.type] || x.label.localeCompare(y.label));
}

function firstBundle(a, type, ref) {
  if (type === 'theme') return a.themes[ref]?.bundles[0];
  if (type === 'random') return a.random.bundles[0];
  return a.sets[ref]?.bundles[0];
}

function renderBundles() {
  const k = state.settings.activeMode;
  const mode = MODES.find((m) => m.k === k);
  const a = getAnalysis(k);
  const opts = bundleOptions(a);
  const groups = { premium: 'Premium sets', set: 'Sets', theme: "Thema's", random: 'Random' };
  let last = null;
  const optHtml = opts.map((o) => {
    const head = o.type !== last ? `<h3 class="group">${groups[o.type]}</h3>` : '';
    last = o.type;
    return `${head}
      <div class="opt">
        <div class="opt-main"><div class="opt-name">${esc(o.label)}</div><div class="muted small">${esc(o.sub)}</div></div>
        <div class="opt-side"><span class="opt-n">${o.n}×</span><span class="small">${eur(o.price)}</span></div>
        <button class="btn primary small" data-action="make" data-type="${o.type}" data-ref="${esc(o.ref)}">Maak</button>
      </div>`;
  }).join('');

  const open = state.bundles.filter((b) => b.status === 'gemaakt');
  const sel = open.filter((b) => state.pick.has(b.id));
  const selTotal = sel.reduce((s, b) => s + b.price, 0);
  const openHtml = open.map((b) => `
    <label class="made">
      <input type="checkbox" data-action="pick" data-id="${b.id}" ${state.pick.has(b.id) ? 'checked' : ''}>
      <div class="made-main"><div>${esc(b.label)}</div><div class="muted small">${b.size} kaarten · gemaakt ${esc(b.createdAt)}</div></div>
      <b>${eur(b.price)}</b>
      <button class="btn ghost small" data-action="unmake" data-id="${b.id}" title="Kaarten terug in voorraad">Terug</button>
    </label>`).join('');

  return `
    <header class="page-head">
      <h1>Bundels maken</h1>
      <p class="muted small">Plan: <b>${esc(mode?.label || '')}</b> · <a href="#" data-action="nav" data-view="ana">wijzigen</a></p>
    </header>
    <section class="card">
      <h2>Te maken</h2>
      ${optHtml || '<p class="muted">Geen bundels mogelijk met je huidige voorraad.</p>'}
    </section>
    <section class="card">
      <h2>Klaar voor verkoop <span class="muted small">(${open.length})</span></h2>
      ${openHtml || '<p class="muted">Nog geen gemaakte bundels.</p>'}
      ${open.length ? `<div class="btn-row sticky-actions"><button class="btn primary" data-action="sell" ${sel.length ? '' : 'disabled'}>Verkoop selectie (${sel.length}) · ${eur(selTotal)}</button></div>` : ''}
    </section>`;
}

function makeSheet(type, ref) {
  const a = getAnalysis(state.settings.activeMode);
  const b = firstBundle(a, type, ref);
  if (!b) { toast('Deze bundel is niet meer mogelijk.'); render(); return; }
  const idx = cardIndex();
  const opt = bundleOptions(a).find((o) => o.type === type && o.ref === ref);
  const lines = b.map((x) => ({ ...idx.get(x.id), count: x.count }))
    .sort((p, q) => (p.setName || '').localeCompare(q.setName || '') || String(p.localId).localeCompare(String(q.localId), undefined, { numeric: true }));
  let lastSet = null;
  const rows = lines.map((c) => {
    const head = c.setName !== lastSet ? `<li class="pick-head">${esc(c.setName)}</li>` : '';
    lastSet = c.setName;
    const img = imageUrl(c);
    return `${head}<li><label class="pick-line">
      <input type="checkbox">
      ${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : '<span class="noimg sm"></span>'}
      <span class="nr">#${esc(c.localId)}</span><span class="nm">${esc(c.name)}</span>${c.count > 1 ? `<b class="cnt">×${c.count}</b>` : ''}
    </label></li>`;
  }).join('');
  let shinyText = '';
  if (type === 'set' || type === 'premium') shinyText = `Neem <b>${opt.shiny} holo/reverse uit ${esc(opt.label)}</b> uit je map.`;
  else if (type === 'theme') shinyText = `Neem <b>${opt.shiny} holo/reverse</b>, liefst van het thema ${esc(opt.label)}.`;
  else {
    const sets = Object.keys(a.random.shinyBySet).map((s) => state.sets[s]?.name || s).join(', ');
    shinyText = `Neem <b>${opt.shiny} holo/reverse uit gewone sets</b>${sets ? ` (bv. ${esc(sets)})` : ''}.`;
  }
  const total = b.reduce((s, x) => s + x.count, 0);
  openSheet(`
    <h2>${esc(opt.label)}</h2>
    <p class="muted small">${total} niet-blinkende kaarten + ${opt.shiny} holo/reverse · ${eur(opt.price)}</p>
    <div class="callout">${icon('spark', 18)} <span>${shinyText}</span></div>
    <ul class="pick-list">${rows}</ul>
    <div class="btn-row sticky-actions">
      <button class="btn" data-action="close-sheet">Annuleren</button>
      <button class="btn primary" data-action="confirm-make" data-type="${type}" data-ref="${esc(ref)}">${icon('check', 18)} Bundel gemaakt</button>
    </div>`);
}

async function confirmMake(type, ref) {
  const a = getAnalysis(state.settings.activeMode);
  const b = firstBundle(a, type, ref);
  const opt = bundleOptions(a).find((o) => o.type === type && o.ref === ref);
  if (!b || !opt) { closeSheet(); toast('Deze bundel is niet meer mogelijk.'); render(); return; }
  for (const x of b) {
    const n = (state.inventory[x.id] || 0) - x.count;
    if (n > 0) state.inventory[x.id] = n; else delete state.inventory[x.id];
  }
  state.bundles.unshift({
    id: uid(), type, ref, label: opt.label, price: opt.price, size: b.reduce((s, x) => s + x.count, 0) + opt.shiny,
    shiny: opt.shiny, cards: b, status: 'gemaakt', createdAt: today(), mode: state.settings.activeMode,
  });
  await save.inventory();
  await save.bundles();
  closeSheet();
  toast('Bundel gemaakt, kaarten uit voorraad gehaald.');
  render();
}

async function unmake(id) {
  const b = state.bundles.find((x) => x.id === id);
  if (!b || !confirm(`"${b.label}" uit elkaar halen en de kaarten terug in voorraad zetten?`)) return;
  for (const x of b.cards) state.inventory[x.id] = (state.inventory[x.id] || 0) + x.count;
  state.bundles = state.bundles.filter((x) => x.id !== id);
  state.pick.delete(id);
  await save.inventory();
  await save.bundles();
  toast('Kaarten terug in voorraad.');
  render();
}

function sellSheet() {
  const sel = state.bundles.filter((b) => state.pick.has(b.id) && b.status === 'gemaakt');
  if (!sel.length) return;
  const total = sel.reduce((s, b) => s + b.price, 0);
  const thr = state.settings.bonusThreshold;
  openSheet(`
    <h2>Verkoop registreren</h2>
    <ul class="kv">${sel.map((b) => `<li><span>${esc(b.label)}</span><b>${eur(b.price)}</b></li>`).join('')}</ul>
    <label class="field"><span>Platform</span>
      <select class="input" id="sale-platform">${PLATFORMS.map((p) => `<option>${p}</option>`).join('')}</select></label>
    <label class="field"><span>Ontvangen bedrag (zonder verzending, na korting)</span>
      <input class="input" id="sale-price" type="number" inputmode="decimal" step="0.01" min="0" value="${total}"></label>
    <label class="field"><span>Datum</span><input class="input" id="sale-date" type="date" value="${today()}"></label>
    <label class="check"><input type="checkbox" id="sale-bonus" ${total >= thr ? 'checked' : ''}>
      Bonus vanaf ${eur(thr)}: steek bij elke bundel 1 extra blinkende kaart (${sel.length} kaarten)</label>
    <div class="btn-row sticky-actions">
      <button class="btn" data-action="close-sheet">Annuleren</button>
      <button class="btn primary" data-action="confirm-sell">${icon('check', 18)} Verkocht</button>
    </div>`, (el) => {
    const price = el.querySelector('#sale-price');
    const bonus = el.querySelector('#sale-bonus');
    price.addEventListener('input', () => { bonus.checked = Number(price.value) >= thr; });
  });
}

async function confirmSell() {
  const sel = state.bundles.filter((b) => state.pick.has(b.id) && b.status === 'gemaakt');
  const sale = {
    id: uid(),
    platform: $('#sale-platform').value,
    price: Number($('#sale-price').value) || 0,
    date: $('#sale-date').value || today(),
    bonus: $('#sale-bonus').checked,
    bundleIds: sel.map((b) => b.id),
    labels: sel.map((b) => b.label),
  };
  for (const b of sel) { b.status = 'verkocht'; b.saleId = sale.id; }
  state.sales.unshift(sale);
  state.pick.clear();
  await save.bundles();
  await save.sales();
  closeSheet();
  toast(sale.bonus ? `Verkocht! Vergeet de ${sel.length} extra blinkende kaart(en) niet.` : 'Verkoop geregistreerd.');
  render();
}

// ----- Verkoop -----

function renderSales() {
  const year = String(new Date().getFullYear());
  const yearSales = state.sales.filter((s) => s.date.startsWith(year));
  const per = PLATFORMS.filter((p) => p !== 'Anders').map((p) => {
    const list = yearSales.filter((s) => s.platform === p);
    const n = list.length;
    const rev = list.reduce((a, s) => a + s.price, 0);
    const pn = Math.min(100, (n / DAC7.sales) * 100);
    const pr = Math.min(100, (rev / DAC7.revenue) * 100);
    const warn = n >= DAC7.sales || rev > DAC7.revenue ? 'over' : (pn >= 80 || pr >= 80 ? 'near' : '');
    return `
      <section class="card dac7 ${warn}">
        <h2>${p} <span class="muted small">${year}</span></h2>
        <div class="meter"><span>Verkopen</span><b>${n} / ${DAC7.sales}</b><div class="bar"><i style="width:${pn}%"></i></div></div>
        <div class="meter"><span>Omzet</span><b>${eur(rev)} / ${eur(DAC7.revenue)}</b><div class="bar"><i style="width:${pr}%"></i></div></div>
        ${warn === 'over' ? '<p class="small error">DAC7-grens bereikt: dit platform meldt je verkopen aan de fiscus.</p>' : warn === 'near' ? '<p class="small warn">Je nadert de DAC7-grens op dit platform.</p>' : ''}
      </section>`;
  }).join('');
  const total = yearSales.reduce((a, s) => a + s.price, 0);
  const list = state.sales.map((s) => `
    <li class="sale">
      <div><b>${esc(s.platform)}</b> <span class="muted small">${esc(s.date)}</span>${s.bonus ? ' <span class="badge">+bonus</span>' : ''}
        <div class="small muted">${s.labels.map(esc).join(' · ')}</div></div>
      <b>${eur(s.price)}</b>
      <button class="btn ghost small" data-action="undo-sale" data-id="${s.id}" title="Verkoop ongedaan maken">Ongedaan</button>
    </li>`).join('');
  return `
    <header class="page-head"><h1>Verkoop</h1>
      <p class="muted small">${yearSales.length} ${yearSales.length === 1 ? 'verkoop' : 'verkopen'} · ${eur(total)} in ${year}. DAC7: platformen melden vanaf ${DAC7.sales} verkopen of meer dan ${eur(DAC7.revenue)} per jaar.</p></header>
    ${per}
    <section class="card"><h2>Alle verkopen</h2>${list ? `<ul class="sales">${list}</ul>` : '<p class="muted">Nog geen verkopen.</p>'}</section>`;
}

async function undoSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s || !confirm('Verkoop ongedaan maken? De bundels komen terug bij "Klaar voor verkoop".')) return;
  for (const b of state.bundles) if (s.bundleIds.includes(b.id)) { b.status = 'gemaakt'; delete b.saleId; }
  state.sales = state.sales.filter((x) => x.id !== id);
  await save.bundles();
  await save.sales();
  render();
}

// ----- Instellingen -----

function renderSettings() {
  const S = state.settings;
  const bundleField = (key, label) => `
    <fieldset class="card"><legend>${label}</legend>
      <div class="three">
        <label class="field"><span>Kaarten</span><input class="input" type="number" min="1" data-setting="${key}.size" value="${S[key].size}"></label>
        <label class="field"><span>Holo/reverse</span><input class="input" type="number" min="0" data-setting="${key}.shiny" value="${S[key].shiny}"></label>
        <label class="field"><span>Prijs (€)</span><input class="input" type="number" min="0" step="0.5" data-setting="${key}.price" value="${S[key].price}"></label>
      </div>
    </fieldset>`;
  const premiumOpts = [...new Set([...S.premiumSets, ...S.mySets])].map((id) => `
    <label class="check"><input type="checkbox" data-action="toggle-premium" data-set="${esc(id)}" ${S.premiumSets.includes(id) ? 'checked' : ''}>
    ${esc(state.sets[id]?.name || id)} <span class="muted small">${esc(id)}</span></label>`).join('');
  const themeOpts = Object.entries(THEMES).map(([key, t]) => `
    <label class="check"><input type="checkbox" data-action="toggle-theme" data-key="${key}" ${S.themes[key] ? 'checked' : ''}> ${esc(t.label)}</label>`).join('');
  return `
    <header class="page-head"><h1>Instellingen</h1></header>
    ${bundleField('setBundle', 'Bundel per set')}
    ${bundleField('premiumBundle', 'Premium set')}
    ${bundleField('themeBundle', 'Themaset')}
    ${bundleField('randomBundle', 'Random pick')}
    <fieldset class="card"><legend>Premium sets</legend>${premiumOpts}</fieldset>
    <fieldset class="card"><legend>Thema's</legend>${themeOpts}
      <label class="check"><input type="checkbox" data-action="toggle-tfp" ${S.themesFromPremium ? 'checked' : ''}> Themakaarten ook uit premium sets halen</label>
      <label class="check"><input type="checkbox" data-action="toggle-prr" ${S.premiumRestToRandom ? 'checked' : ''}> Overschot uit premium sets ook naar random</label>
    </fieldset>
    <fieldset class="card"><legend>Bonus</legend>
      <label class="field"><span>Extra blinkende kaart per bundel vanaf (€)</span>
      <input class="input" type="number" min="0" data-setting="bonusThreshold" value="${S.bonusThreshold}"></label>
    </fieldset>
    <fieldset class="card"><legend>Back-up</legend>
      <p class="muted small">Alles staat enkel op dit toestel. Maak geregeld een back-up.</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Back-up downloaden</button>
        <label class="btn">Back-up terugzetten<input type="file" accept=".json" data-input="restore" hidden></label>
      </div>
    </fieldset>
    <fieldset class="card"><legend>Overige</legend>
      <div class="btn-row">
        <button class="btn" data-action="refresh-setlist">Setlijst vernieuwen</button>
        <button class="btn danger" data-action="wipe">Alles wissen</button>
      </div>
      <p class="muted small">PokeBundels ${VERSION} · kaartgegevens via TCGdex</p>
    </fieldset>`;
}

async function exportBackup() {
  const data = { app: 'PokeBundels', type: 'backup', version: VERSION, at: new Date().toISOString(), settings: state.settings, inventory: state.inventory, bundles: state.bundles, sales: state.sales };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokebundels-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'PokeBundels' || data.type !== 'backup') throw new Error('Dit is geen PokeBundels-back-up.');
    if (!confirm('Je huidige gegevens worden vervangen door de back-up. Doorgaan?')) return;
    state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...data.settings };
    state.inventory = data.inventory || {};
    state.bundles = data.bundles || [];
    state.sales = data.sales || [];
    await Promise.all([save.settings(), save.inventory(), save.bundles(), save.sales()]);
    for (const id of state.settings.mySets) {
      if (!state.sets[id]) {
        const s = await db.get(`set:${id}`);
        if (s) state.sets[id] = s; else await loadSet(id, { open: false });
      }
    }
    toast('Back-up teruggezet.');
    render();
  } catch (e) { toast(e.message); }
}

// ---------- events ----------

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (act !== 'pick' && el.tagName !== 'INPUT') e.preventDefault();
  switch (act) {
    case 'nav': state.view = el.dataset.view; if (state.view === 'inv') state.invSet = null; render(); window.scrollTo(0, 0); break;
    case 'close-sheet': closeSheet(); break;
    case 'add-set': addSetFlow(); break;
    case 'pick-set': await loadSet(el.dataset.set); break;
    case 'add-set-id': { const v = $('#manual-set')?.value.trim(); if (v) await loadSet(v); break; }
    case 'open-set': state.invSet = el.dataset.set; render(); window.scrollTo(0, 0); break;
    case 'close-set': state.invSet = null; render(); break;
    case 'flt-all': state.invFilter.all = el.dataset.val === '1'; render(); break;
    case 'flt-owned': state.invFilter.owned = !state.invFilter.owned; render(); break;
    case 'inc': setCount(el.dataset.card, (state.inventory[el.dataset.card] || 0) + 1); break;
    case 'dec': setCount(el.dataset.card, (state.inventory[el.dataset.card] || 0) - 1); break;
    case 'import': importSheet(); break;
    case 'do-import': await doImport(); break;
    case 'copy-prompt': {
      const txt = claudePrompt(state.sets[el.dataset.set]);
      try { await navigator.clipboard.writeText(txt); toast('Prompt gekopieerd. Plak hem in Claude met je foto\'s.'); }
      catch { openSheet(`<h2>Prompt voor Claude</h2><textarea class="input mono" rows="10" readonly>${esc(txt)}</textarea>`); }
      break;
    }
    case 'refresh-set': await loadSet(el.dataset.set, { force: true }); break;
    case 'remove-set': {
      const id = el.dataset.set;
      const set = state.sets[id];
      const n = set.cards.reduce((s, c) => s + (state.inventory[c.id] || 0), 0);
      if (!confirm(`${set.name} uit je inventaris halen?${n ? ` De ${n} kaarten in voorraad worden ook gewist.` : ''}`)) break;
      for (const c of set.cards) delete state.inventory[c.id];
      state.settings.mySets = state.settings.mySets.filter((x) => x !== id);
      delete state.sets[id];
      state.invSet = null;
      await save.settings(); await save.inventory();
      render();
      break;
    }
    case 'mode': state.mode = Number(el.dataset.k); render(); break;
    case 'reanalyse': state.analysisCache = {}; render(); toast('Opnieuw berekend.'); break;
    case 'use-plan': state.settings.activeMode = Number(el.dataset.k); await save.settings(); state.view = 'bun'; render(); toast('Plan actief.'); break;
    case 'make': makeSheet(el.dataset.type, el.dataset.ref); break;
    case 'confirm-make': await confirmMake(el.dataset.type, el.dataset.ref); break;
    case 'unmake': e.preventDefault(); await unmake(el.dataset.id); break;
    case 'pick': {
      const id = el.dataset.id;
      if (el.checked) state.pick.add(id); else state.pick.delete(id);
      const sel = state.bundles.filter((b) => state.pick.has(b.id));
      const btn = document.querySelector('[data-action="sell"]');
      if (btn) { btn.disabled = !sel.length; btn.textContent = `Verkoop selectie (${sel.length}) · ${eur(sel.reduce((s, b) => s + b.price, 0))}`; }
      break;
    }
    case 'sell': sellSheet(); break;
    case 'confirm-sell': await confirmSell(); break;
    case 'undo-sale': await undoSale(el.dataset.id); break;
    case 'toggle-premium': {
      const id = el.dataset.set;
      const list = state.settings.premiumSets;
      state.settings.premiumSets = el.checked ? [...new Set([...list, id])] : list.filter((x) => x !== id);
      await save.settings(); state.analysisCache = {};
      break;
    }
    case 'toggle-theme': state.settings.themes[el.dataset.key] = el.checked; await save.settings(); state.analysisCache = {}; break;
    case 'toggle-prr': state.settings.premiumRestToRandom = el.checked; await save.settings(); state.analysisCache = {}; break;
    case 'toggle-tfp': state.settings.themesFromPremium = el.checked; await save.settings(); state.analysisCache = {}; break;
    case 'export': await exportBackup(); break;
    case 'refresh-setlist': try { await listSets(true); toast('Setlijst vernieuwd.'); } catch (err) { toast(err.message); } break;
    case 'wipe':
      if (confirm('Alle gegevens (voorraad, bundels, verkopen) wissen? Dit kan niet ongedaan worden.') && confirm('Echt zeker?')) {
        await db.clear(); location.reload();
      }
      break;
    default: break;
  }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.input === 'inv-q') {
    state.invFilter.q = el.value;
    const set = state.sets[state.invSet];
    const grid = $('.grid');
    if (set && grid) grid.innerHTML = filteredCards(set).map(tileHtml).join('') || '<div class="empty">Geen kaarten met deze filter.</div>';
  }
}

async function onChange(e) {
  const el = e.target;
  if (el.dataset.input === 'count') setCount(el.dataset.card, Number(el.value));
  if (el.dataset.input === 'restore' && el.files?.[0]) await restoreBackup(el.files[0]);
  if (el.dataset.setting) {
    const path = el.dataset.setting.split('.');
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    if (path.length === 2) state.settings[path[0]][path[1]] = v; else state.settings[path[0]] = v;
    if (path[1] === 'shiny' && state.settings[path[0]].shiny >= state.settings[path[0]].size) {
      toast('Aantal holo/reverse moet kleiner zijn dan het aantal kaarten.');
      return;
    }
    state.analysisCache = {};
    await save.settings();
  }
}

// ---------- start ----------

async function start() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  await load();
  persist();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
