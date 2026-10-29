// PokeBundels — app

import { db, persist } from './db.js';
import { listSets, getSet, imageUrl, fillReleaseDates } from './tcgdex.js';
import {
  MODES, TEMPLATES, analysePlan, defaultPacks, migrateSettings, parseExtras, isNonShiny, isNonHoloRare, isBundleCard, normNr, parseImport, pickVaried,
} from './logic.js';

const VERSION = '2.1.1';
const DAC7 = { sales: 30, revenue: 2000 };
const PLATFORMS = ['Vinted', '2dehands', 'Anders'];

function loadOpenEras() {
  try { return new Set(JSON.parse(localStorage.getItem('pb-open-eras') || '[]')); } catch { return new Set(); }
}
function saveOpenEras() {
  try { localStorage.setItem('pb-open-eras', JSON.stringify([...state.openEras])); } catch { /* geen opslag */ }
}

const state = {
  settings: migrateSettings(null),
  inventory: {},      // cardId -> aantal
  bundles: [],        // gemaakte/verkochte bundels
  sales: [],
  sets: {},           // setId -> setgegevens (uit cache)
  setList: [],        // alle beschikbare sets (namen)
  view: 'inv',
  invSet: null,
  invFilter: { all: false, owned: false, q: '' },
  mode: 1,
  pick: new Set(),    // geselecteerde bundels om te verkopen
  openAcc: null,      // open groep in Instellingen
  sub: { ana: 'overzicht', prep: 'tins' }, // subtabbladen
  openPack: null,     // opengeklapte tin/bundel in Instellingen
  openEras: loadOpenEras(), // opengeklapte era's in Inventaris
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
  state.settings = migrateSettings(settings);
  state.inventory = inventory || {};
  state.bundles = bundles || [];
  state.sales = sales || [];
  state.setList = (await db.get('setlist2'))?.sets || [];
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
  if (!state.analysisCache[key]) state.analysisCache = { [key]: analysePlan(inventoryCards(), state.settings, k, setNames()) };
  return state.analysisCache[key];
}


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
  navSync();
}
function closeSheet() {
  const root = $('#sheet');
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('noscroll');
  navSync();
}

// ---------- terugknop van de telefoon: stap terug in plaats van afsluiten ----------

let navPushed = false;
let navSkip = false;
function navRoot() { return $('#sheet').hidden && state.view === 'inv' && !state.invSet; }
function navSync() {
  if (navSkip) return; // er loopt nog een history.back(); popstate roept navSync opnieuw aan
  if (navRoot()) {
    if (navPushed) { navPushed = false; navSkip = true; history.back(); }
  } else if (!navPushed) {
    navPushed = true;
    history.pushState({ pb: 1 }, '');
  }
}
function navBack() {
  if (!$('#sheet').hidden) { closeSheet(); return; }
  if (state.view === 'inv' && state.invSet) { state.invSet = null; render(); return; }
  if (state.view !== 'inv') { state.view = 'inv'; state.invSet = null; render(); window.scrollTo(0, 0); }
}
window.addEventListener('popstate', () => {
  if (navSkip) { navSkip = false; navSync(); return; }
  navPushed = false;
  navBack();
  setTimeout(navSync, 0);
});

// ---------- updates ----------

let swReg = null;
let swWaiting = null;
function showUpd(w) { swWaiting = w; $('#upd').hidden = false; }
function setupSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // eerste bezoek: niet herladen
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => {
    swReg = r;
    if (r.waiting && navigator.serviceWorker.controller) showUpd(r.waiting);
    r.addEventListener('updatefound', () => {
      const n = r.installing;
      n?.addEventListener('statechange', () => {
        if (n.state === 'installed' && navigator.serviceWorker.controller) showUpd(n);
      });
    });
    setInterval(() => r.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
}
async function checkUpdate() {
  if (!swReg) { toast('Updates zoeken lukt hier niet.'); return; }
  try {
    await swReg.update();
    setTimeout(() => { if (!swWaiting) toast(`Je hebt de nieuwste versie (${VERSION}).`); }, 1500);
  } catch { toast('Geen verbinding om updates te zoeken.'); }
}

const ICONS = {
  inv: '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/><path d="M4 12h16"/>',
  ana: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  prep: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14"/><path d="M12 12l1 2 2 .3-1.5 1.4.4 2.1L12 17l-1.9 1 .4-2.1L9 14.3l2-.3z"/>',
  sell: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.5"/>',
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
    ['inv', 'Inventaris'], ['ana', 'Analyse'], ['prep', 'Voorbereiding'], ['sell', 'Te verkopen'], ['sale', 'Verkocht'], ['set', 'Instellingen'],
  ];
  $('#nav').innerHTML = nav.map(([id, label]) => `
    <button class="nav-btn ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}" aria-label="${label}" ${state.view === id ? 'aria-current="page"' : ''}>
      ${icon(id)}<span>${label}</span>
    </button>`).join('');
  const main = $('#main');
  const views = { inv: renderInventory, ana: renderAnalysis, prep: renderPrep, sell: renderSell, sale: renderSales, set: renderSettings };
  main.innerHTML = views[state.view]();
  navSync();
}

// ----- Inventaris -----

function renderInventory() {
  if (state.invSet && state.sets[state.invSet]) return renderSetDetail(state.invSet);
  const sets = state.settings.mySets.map((id) => state.sets[id]).filter(Boolean);
  let total = 0, unique = 0;
  const stats = new Map();
  for (const s of sets) {
    let t = 0, u = 0;
    for (const c of s.cards) {
      const n = state.inventory[c.id] || 0;
      if (n > 0 && inBundles(c)) { t += n; u++; }
    }
    total += t; unique += u;
    stats.set(s.id, { t, u });
  }
  // Per era groeperen; era's nieuwste eerst, sets binnen een era op releasedatum (oud naar nieuw).
  const eras = new Map();
  for (const s of sets) {
    const era = s.serie || state.setList.find((x) => x.id === s.id)?.serie || 'Overige';
    if (!eras.has(era)) eras.set(era, []);
    eras.get(era).push(s);
  }
  for (const list of eras.values()) list.sort((a, b) => releaseKey(a).localeCompare(releaseKey(b)));
  const eraList = [...eras].sort((a, b) => releaseKey(b[1][b[1].length - 1]).localeCompare(releaseKey(a[1][a[1].length - 1])));
  const setRow = (s) => {
    const { t, u } = stats.get(s.id);
    return `
      <button class="set-row" data-action="open-set" data-set="${esc(s.id)}">
        <div class="set-row-main">
          <div class="set-row-name">${esc(s.name)}</div>
          <div class="muted small">${esc(s.id)}${s.releaseDate ? ` · ${esc(s.releaseDate.slice(0, 4))}` : ''}</div>
        </div>
        <div class="set-row-stats"><b>${t}</b><span class="muted small">${u} uniek</span></div>
      </button>`;
  };
  const rows = eraList.map(([era, list]) => {
    const t = list.reduce((sum, s) => sum + stats.get(s.id).t, 0);
    return `
      <details class="acc era" data-era="${esc(era)}" ${state.openEras.has(era) ? 'open' : ''}>
        <summary><span class="acc-t">${esc(era)}</span><span class="acc-s">${list.length} set${list.length === 1 ? '' : 's'} · ${t} kaarten</span></summary>
        <div class="era-sets">${list.map(setRow).join('')}</div>
      </details>`;
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
    if (!f.all && !isNonShiny(c) && !isNonHoloRare(c)) return false;
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
  for (const c of set.cards) { const n = state.inventory[c.id] || 0; if (n > 0 && inBundles(c)) { t += n; u++; } }
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
  const img = imageUrl(c);
  return `
    <div class="tile ${n > 0 ? 'owned' : ''} ${isNonShiny(c) || isNonHoloRare(c) ? '' : 'shiny'}" data-card="${esc(c.id)}">
      <button class="tile-img" data-action="inc" data-card="${esc(c.id)}" aria-label="${esc(c.name)} +1">
        ${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : `<span class="noimg">${esc(c.name)}</span>`}
      </button>
      <div class="tile-meta"><span class="nr">#${esc(c.localId)}</span> <span class="nm">${esc(c.name)}</span>${isNonHoloRare(c) ? ' <span class="badge">Rare</span>' : ''}</div>
      <div class="stepper">
        <button data-action="dec" data-card="${esc(c.id)}" aria-label="Eén minder">${icon('minus', 18)}</button>
        <input type="number" inputmode="numeric" min="0" value="${n}" data-input="count" data-card="${esc(c.id)}" aria-label="Aantal ${esc(c.name)}">
        <button data-action="inc" data-card="${esc(c.id)}" aria-label="Eén meer">${icon('plus', 18)}</button>
      </div>
    </div>`;
}

// Sorteersleutel op releasedatum. Oudere bewaarde sets zonder datum: volgorde uit de setlijst van TCGdex.
function releaseKey(s) {
  if (s.releaseDate) return s.releaseDate;
  const i = state.setList.findIndex((x) => x.id === s.id);
  if (i >= 0) return `~${String(state.setList.length - i).padStart(5, '0')}`;
  return `~~${s.id}`;
}

function inBundles(c) { return isBundleCard(c, state.settings.rareOk); }
function needsRareOk(c) { return !isNonShiny(c) && !state.settings.rareOk.includes(c.id); }
function rarityLabel(c) { return c.rarity || 'onbekende zeldzaamheid'; }

// Elke kaart die geen common/uncommon is: eerst vragen of hij erbij moet.
function requestCount(cardId, n) {
  const card = cardIndex().get(cardId);
  const cur = state.inventory[cardId] || 0;
  if (!card || n <= cur || !needsRareOk(card)) { setCount(cardId, n); return; }
  const img = imageUrl(card);
  openSheet(`
    <h2>Geen common/uncommon</h2>
    <div class="rare-ask">
      ${img ? `<img src="${esc(img)}" alt="">` : ''}
      <div><b>#${esc(card.localId)} ${esc(card.name)}</b><div class="muted small">${esc(card.setName || '')}</div>
        <span class="badge gold">${esc(rarityLabel(card))}</span></div>
    </div>
    <p>Volgens TCGdex is deze kaart <b>${esc(rarityLabel(card))}</b>, geen common of uncommon.${isNonHoloRare(card) ? ' In oudere sets bestaan rares die niet blinken.' : ''}</p>
    <p>Toch toevoegen aan je voorraad? Dan telt hij mee als gewone bundelkaart.</p>
    <div class="btn-row sticky-actions">
      <button class="btn" data-action="rare-no" data-card="${esc(cardId)}">Niet toevoegen</button>
      <button class="btn primary" data-action="rare-yes" data-card="${esc(cardId)}" data-n="${n}">${icon('check', 18)} Toevoegen</button>
    </div>`);
}

async function approveRare(cardId) {
  if (!state.settings.rareOk.includes(cardId)) state.settings.rareOk.push(cardId);
  await save.settings();
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
    for (const c of set.cards) { const k = state.inventory[c.id] || 0; if (k > 0 && inBundles(c)) { t += k; u++; } }
    st.textContent = `${set.id} · ${t} kaarten · ${u} verschillend`;
  }
}

function setName(id) {
  return state.sets[id]?.name || state.setList.find((s) => s.id === id)?.name || id;
}

/** Setkiezer: set toevoegen aan de inventaris. */
async function addSetFlow() {
  const title = 'Set toevoegen';
  openSheet(`<h2>${title}</h2><p class="muted">Sets laden…</p>`);
  let sets;
  try { sets = await listSets(); state.setList = sets; } catch (e) {
    openSheet(`<h2>${title}</h2><p class="error">Kon de setlijst niet laden: ${esc(e.message)}</p>
      <label class="field"><span>Set-ID (bv. sv08)</span><input class="input" id="manual-set"></label>
      <div class="btn-row"><button class="btn primary" data-action="add-set-id">Toevoegen</button></div>`);
    return;
  }
  const marked = (id) => state.settings.mySets.includes(id);
  const item = (s) => `
    <button class="set-pick ${marked(s.id) ? 'have' : ''}" data-action="pick-set" data-set="${esc(s.id)}">
      <span class="set-pick-main"><span class="set-pick-name">${esc(s.name)}</span><span class="muted small">${esc(s.id)}</span></span>
      ${marked(s.id) ? `<span class="badge gold">In inventaris</span>` : ''}
    </button>`;
  const grouped = (list) => {
    const out = [];
    let serie = null;
    for (const s of list) {
      if (s.serie !== serie) { serie = s.serie; out.push(`<div class="set-pick-head">${esc(serie)}</div>`); }
      out.push(item(s));
    }
    return out.join('');
  };
  const html = (q, all) => {
    if (!q && !all) {
      return `<p class="muted small">Typ een setnaam of set-ID (bv. "surging" of "sv08").</p>
        <button class="btn" data-action="show-all-sets">Alle sets tonen (${sets.length})</button>`;
    }
    const list = q ? sets.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : sets;
    return list.length ? grouped(list) : '<p class="muted">Geen set gevonden.</p>';
  };
  openSheet(`
    <h2>${title}</h2>
    <input class="input" type="search" placeholder="Zoek set" id="set-search" aria-label="Zoek set" autocomplete="off">
    <div class="set-pick-list" id="set-pick-list">${html('', false)}</div>
    <details class="small"><summary>Set niet in de lijst?</summary>
      <label class="field"><span>Set-ID (bv. sv08)</span><input class="input" id="manual-set"></label>
      <button class="btn small" data-action="add-set-id">Toevoegen</button>
    </details>`, (el) => {
    const box = el.querySelector('#set-pick-list');
    const input = el.querySelector('#set-search');
    input.addEventListener('input', () => { box.innerHTML = html(input.value.trim().toLowerCase(), false); });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="show-all-sets"]')) {
        e.stopPropagation();
        box.innerHTML = html('', true);
      }
    });
    setTimeout(() => input.focus(), 50);
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
  const pendingRares = [];
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
      if (n > cur && needsRareOk({ ...card, setId: set.id })) {
        pendingRares.push({ id: card.id, n, add: n - cur, label: `#${card.localId} ${card.name}`, rarity: rarityLabel(card), setName: set.name, checked: isNonHoloRare({ ...card, setId: set.id }) });
        continue;
      }
      if (n > 0) state.inventory[card.id] = n; else delete state.inventory[card.id];
      added += r.count;
    }
  }
  await save.settings();
  await save.inventory();
  out.innerHTML = `<p class="ok">${icon('check', 16)} ${added} kaarten verwerkt.</p>` +
    (unmatched.length ? `<p class="error small">Niet (zeker) gevonden:</p><ul class="small">${unmatched.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : '') +
    (pendingRares.length ? `
      <div class="rare-box" id="rare-box">
        <p><b>${pendingRares.length} kaart${pendingRares.length > 1 ? 'en' : ''}</b> zonder common/uncommon. Die zijn nog <b>niet</b> toegevoegd. Vink aan welke toch als gewone bundelkaart mogen:</p>
        ${pendingRares.map((p) => `<label class="check"><input type="checkbox" ${p.checked ? 'checked' : ''} data-rare="${esc(p.id)}" data-n="${p.n}"> <span>${esc(p.label)} <span class="badge">${esc(p.rarity)}</span><br><span class="muted small">+${p.add} · ${esc(p.setName)}</span></span></label>`).join('')}
        <div class="btn-row">
          <button class="btn small" data-action="rare-import-skip">Niet toevoegen</button>
          <button class="btn primary small" data-action="rare-import">${icon('check', 16)} Aangevinkte toevoegen</button>
        </div>
      </div>` : '');
  render();
}

// ----- Analyse -----

function packById(id) { return state.settings.packs.find((p) => p.id === id); }
function tinPacks() { return state.settings.packs.filter((p) => p.kind === 'tin'); }
function bundlePacks() { return state.settings.packs.filter((p) => p.kind !== 'tin'); }
function sourceName(src) {
  if (src === 'mix') return 'alle sets gemengd';
  if (src === 'perset') return 'per set';
  return setName(src);
}
function compText(p) {
  const parts = [`${p.cu} gewoon`];
  if (p.shiny) parts.push(`${p.shiny} holo/reverse`);
  if (p.energy) parts.push(`${p.energy} energy`);
  for (const x of parseExtras(p.extras)) parts.push(x.label);
  return parts.join(' + ');
}

function subTabs(view, tabs) {
  const cur = state.sub[view];
  return `<div class="segs" role="tablist">${tabs.map(([id, label]) => `
    <button class="seg ${cur === id ? 'on' : ''}" data-action="sub" data-view="${view}" data-sub="${id}" role="tab" aria-selected="${cur === id}">${label}</button>`).join('')}</div>`;
}

function renderAnalysis() {
  const k = state.settings.activeMode;
  const head = `
    <header class="page-head"><h1>Analyse</h1>
      <p class="muted small">Eerst zoveel mogelijk tins, daarna bundels. Alles volgens je instellingen.</p></header>
    ${subTabs('ana', [['overzicht', 'Overzicht'], ['tins', 'Tins'], ['bundels', 'Bundels']])}`;
  if (!inventoryCards().length) return `${head}<div class="empty">Nog geen kaarten in voorraad.</div>`;
  const a = getAnalysis(k);
  const sub = state.sub.ana;
  if (sub === 'tins' || sub === 'bundels') {
    const kind = sub === 'tins' ? 'tin' : 'bundle';
    const packs = kind === 'tin' ? tinPacks() : bundlePacks();
    const body = packs.map((p) => {
      const units = a.units.filter((u) => u.packId === p.id);
      const n = units.reduce((s, u) => s + u.count, 0);
      const rows = p.source === 'perset' ? units.filter((u) => u.count).map((u) => `<li><span>${esc(u.setName)}</span><b>${u.count}×</b></li>`).join('') : '';
      return `
        <section class="card">
          <h2>${esc(p.name)} <span class="opt-n">${n}×</span></h2>
          <p class="muted small">${esc(compText(p))} · ${esc(sourceName(p.source))} · ${eur(p.price)}${kind === 'tin' ? ` · ${p.stock || 0} tins beschikbaar` : ''}</p>
          ${rows ? `<ul class="kv">${rows}</ul>` : ''}
          ${kind === 'tin' && n < (p.stock || 0) ? `<p class="small warn">Niet genoeg kaarten voor alle ${p.stock} tins.</p>` : ''}
        </section>`;
    }).join('');
    return `${head}${body || `<div class="empty">Geen ${sub} ingesteld. Voeg ze toe in Instellingen.</div>`}`;
  }
  const S = a.summary;
  const extras = Object.entries(S.extras).map(([nm, n]) => `<li><span>${esc(nm)}</span><b>${n}</b></li>`).join('');
  const tabs = MODES.map((m) => `<button class="seg ${m.k === k ? 'on' : ''}" data-action="mode" data-k="${m.k}">${m.label}</button>`).join('');
  return `${head}
    <div class="btn-row"><button class="btn primary" data-action="start-analysis">${icon('refresh', 18)} Analyse starten</button></div>
    <div class="stats">
      <div class="stat"><b>${S.tins}</b><span>tins</span></div>
      <div class="stat"><b>${S.bundles}</b><span>bundels</span></div>
      <div class="stat"><b>${eur(S.revenue)}</b><span>opbrengst</span></div>
    </div>
    <section class="card">
      <h2>Kaarten</h2>
      <ul class="kv">
        <li><span>In voorraad (gewone kaarten)</span><b>${S.total}</b></li>
        <li><span>Gebruikt in tins en bundels</span><b>${S.used}</b></li>
        <li><span>Blijft over</span><b>${S.leftover}</b></li>
      </ul>
    </section>
    <section class="card">
      <h2>Nodig uit je map en voorraad</h2>
      <ul class="kv">
        <li><span>Holo/reverse</span><b>${S.shiny}</b></li>
        ${S.energy ? `<li><span>Energy</span><b>${S.energy}</b></li>` : ''}
        ${extras}
      </ul>
    </section>
    <section class="card">
      <h2>Dubbels per tin/bundel</h2>
      <div class="segs">${tabs}</div>
    </section>`;
}

function startAnalysisSheet() {
  const tins = tinPacks();
  openSheet(`
    <h2>Analyse starten</h2>
    <p class="muted small">Hoeveel tins heb je ter beschikking? De analyse vult eerst zoveel mogelijk tins.</p>
    ${tins.map((p) => `<label class="field"><span>${esc(p.name)} <span class="muted small">(${esc(compText(p))})</span></span>
      <input class="input" type="number" min="0" inputmode="numeric" value="${p.stock || 0}" data-start-tin="${esc(p.id)}"></label>`).join('') || '<p class="muted">Geen tins ingesteld (Instellingen → Tins).</p>'}
    <div class="btn-row sticky-actions">
      <button class="btn" data-action="close-sheet">Annuleren</button>
      <button class="btn primary" data-action="run-analysis">${icon('check', 18)} Analyse maken</button>
    </div>`);
}

async function runAnalysis() {
  for (const inp of document.querySelectorAll('[data-start-tin]')) {
    const p = packById(inp.dataset.startTin);
    if (p) p.stock = Math.max(0, Math.round(Number(inp.value) || 0));
  }
  await save.settings();
  state.analysisCache = {};
  state.sub.ana = 'overzicht';
  closeSheet();
  render();
  toast('Analyse gemaakt.');
}

// ----- Voorbereiding -----

function renderPrep() {
  const a = getAnalysis(state.settings.activeMode);
  const kind = state.sub.prep === 'bundels' ? 'bundle' : 'tin';
  const units = a.units.filter((u) => u.kind === kind && u.count > 0);
  const rows = units.map((u) => `
    <div class="opt">
      <div class="opt-main"><div class="opt-name">${esc(u.label)}</div>
        <div class="muted small">${esc(compText(packById(u.packId) || u))}</div></div>
      <div class="opt-side"><span class="opt-n">${u.count}×</span><span class="small">${eur(u.price)}</span></div>
      <button class="btn primary small" data-action="make" data-key="${esc(u.key)}">Maak</button>
    </div>`).join('');
  const open = state.bundles.filter((b) => b.status === 'gemaakt').length;
  return `
    <header class="page-head"><h1>Voorbereiding</h1>
      <p class="muted small">Wat je volgens de analyse kunt maken. Gemaakt gaat naar <a href="#" data-action="nav" data-view="sell">Te verkopen</a> (${open}).</p></header>
    ${subTabs('prep', [['tins', 'Tins'], ['bundels', 'Bundels']])}
    <section class="card">${rows || `<p class="muted">Geen ${kind === 'tin' ? 'tins' : 'bundels'} te maken. ${kind === 'tin' ? 'Start de analyse en geef je tins op.' : ''}</p>`}</section>`;
}

// Pakbon met variatie. Voorwaarde: na deze tin/bundel blijft de rest van het plan even groot.
function plannedPick(a, unit) {
  const avoid = new Set();
  for (const b of state.bundles) {
    if (b.status === 'gemaakt' && `${b.packId}|${b.ref}` === unit.key) for (const x of b.cards) avoid.add(x.id);
  }
  const before = new Map(a.units.map((u) => [u.key, u.count]));
  const check = (bundle) => {
    const take = new Map(bundle.map((x) => [x.id, x.count]));
    const cards = inventoryCards().map((c) => ({ ...c, count: c.count - (take.get(c.id) || 0) }));
    const after = analysePlan(cards, state.settings, a.k, setNames());
    return after.units.every((u) => u.count >= (before.get(u.key) || 0) - (u.key === unit.key ? 1 : 0));
  };
  return pickVaried(unit.pool, unit.n, a.k, unit.count, avoid, Math.random, check) || unit.bundles[0];
}

function makeSheet(key) {
  const a = getAnalysis(state.settings.activeMode);
  const unit = a.units.find((u) => u.key === key);
  if (!unit || !unit.count) { toast('Dit is niet meer mogelijk.'); render(); return; }
  const b = plannedPick(a, unit);
  state.pending = { key, cards: b };
  const idx = cardIndex();
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
  const from = unit.ref === 'mix' ? 'gewone sets' : unit.setName;
  const todo = [];
  if (unit.shiny) todo.push(`<b>${unit.shiny} holo/reverse</b> uit ${esc(from)}`);
  if (unit.energy) todo.push(`<b>${unit.energy} energy</b>`);
  for (const x of parseExtras(unit.extras)) todo.push(`<b>${esc(x.label)}</b>`);
  const pack = unit.kind === 'tin' ? ` en steek alles in de <b>${esc(unit.name)}</b>` : '';
  openSheet(`
    <h2>${esc(unit.label)}</h2>
    <p class="muted small">${unit.size} kaarten: ${unit.n} gewoon (hieronder)${unit.energy ? ` + ${unit.energy} energy` : ''}${unit.shiny ? ` + ${unit.shiny} holo/reverse` : ''} · ${eur(unit.price)}</p>
    ${todo.length || pack ? `<div class="callout">${icon('spark', 18)} <span>${todo.length ? `Neem ook ${todo.join(', ')}` : 'Neem de kaarten'}${pack}.</span></div>` : ''}
    <div class="btn-row"><button class="btn small" data-action="make" data-key="${esc(key)}">Andere mix</button>
      <span class="muted small">Willekeurig, zo weinig mogelijk dezelfde kaarten als je andere klaargemaakte.</span></div>
    <ul class="pick-list">${rows}</ul>
    <div class="btn-row sticky-actions">
      <button class="btn" data-action="close-sheet">Annuleren</button>
      <button class="btn primary" data-action="confirm-make" data-key="${esc(key)}">${icon('check', 18)} Gemaakt</button>
    </div>`);
}

async function confirmMake(key) {
  const a = getAnalysis(state.settings.activeMode);
  const unit = a.units.find((u) => u.key === key);
  const p = state.pending;
  const b = p && p.key === key ? p.cards : null;
  state.pending = null;
  const pk = unit && packById(unit.packId);
  if (!b || !unit || !pk || b.some((x) => (state.inventory[x.id] || 0) < x.count) || (pk.kind === 'tin' && (pk.stock || 0) < 1)) {
    closeSheet(); toast('Dit is niet meer mogelijk.'); render(); return;
  }
  for (const x of b) {
    const n = (state.inventory[x.id] || 0) - x.count;
    if (n > 0) state.inventory[x.id] = n; else delete state.inventory[x.id];
  }
  if (pk.kind === 'tin') { pk.stock -= 1; await save.settings(); }
  state.bundles.unshift({
    id: uid(), type: unit.kind, packId: unit.packId, ref: unit.ref, label: unit.label, name: unit.name,
    setName: unit.setName, price: unit.price, size: unit.size, cu: unit.n, shiny: unit.shiny, energy: unit.energy, extras: unit.extras,
    cards: b, status: 'gemaakt', createdAt: today(), mode: a.k, steps: {},
  });
  await save.inventory();
  await save.bundles();
  closeSheet();
  toast(`${unit.kind === 'tin' ? 'Tin' : 'Bundel'} gemaakt, staat bij Te verkopen.`);
  render();
}

async function unmake(id) {
  const b = state.bundles.find((x) => x.id === id);
  if (!b || !confirm(`"${b.label}" uit elkaar halen en de kaarten terug in voorraad zetten?`)) return;
  for (const x of b.cards) state.inventory[x.id] = (state.inventory[x.id] || 0) + x.count;
  const pk = packById(b.packId || b.tinId);
  if (pk && pk.kind === 'tin' && (b.type === 'tin')) { pk.stock = (pk.stock || 0) + 1; await save.settings(); }
  state.bundles = state.bundles.filter((x) => x.id !== id);
  state.pick.delete(id);
  await save.inventory();
  await save.bundles();
  toast('Kaarten terug in voorraad.');
  render();
}

// ----- Te verkopen -----

const STEPS = [
  ['online', 'Online'],
  ['verzonden', 'Verzonden'],
  ['ontvangen', 'Ontvangen'],
  ['geld', 'Geld op rekening'],
];

function renderSell() {
  const open = state.bundles.filter((b) => b.status === 'gemaakt');
  const sel = open.filter((b) => state.pick.has(b.id));
  const items = open.map((b) => {
    const st = b.steps || {};
    const chips = STEPS.map(([id, label]) => `
      <button class="step ${st[id] ? 'done' : ''}" data-action="step" data-id="${b.id}" data-step="${id}">
        ${st[id] ? icon('check', 14) : ''}<span>${label}</span>${st[id]?.at ? `<small>${esc(st[id].at.slice(5))}</small>` : ''}
      </button>`).join('');
    return `
      <div class="sell-item ${state.pick.has(b.id) ? 'picked' : ''}">
        <div class="sell-top">
          <input type="checkbox" data-action="pick" data-id="${b.id}" ${state.pick.has(b.id) ? 'checked' : ''} aria-label="Selecteer ${esc(b.label)}">
          <div class="made-main"><div class="opt-name">${esc(b.label)}</div><div class="muted small">${b.size} kaarten · gemaakt ${esc(b.createdAt)}</div></div>
          <b>${eur(b.price)}</b>
        </div>
        <div class="steps">${chips}</div>
        <button class="btn ghost small" data-action="unmake" data-id="${b.id}">Uit elkaar halen</button>
      </div>`;
  }).join('');
  return `
    <header class="page-head"><h1>Te verkopen</h1>
      <p class="muted small">Tik op een status om ze af te vinken. Koopt iemand er meerdere, vink ze dan eerst aan: een status geldt dan voor de hele selectie.</p></header>
    ${sel.length ? `<div class="callout">${sel.length} geselecteerd · ${eur(sel.reduce((s, b) => s + b.price, 0))}</div>` : ''}
    ${items || '<div class="empty">Nog niets klaargemaakt. Ga naar Voorbereiding.</div>'}`;
}

function stepTargets(id) {
  const b = state.bundles.find((x) => x.id === id);
  if (!b) return [];
  if (state.pick.has(id)) return state.bundles.filter((x) => state.pick.has(x.id) && x.status === 'gemaakt');
  return [b];
}

// Een regel met tekst valt weg als een invulveld erin leeg of 0 is.
// Een regel met enkel invulvelden (bv. de hashtags) houdt wat wel ingevuld is.
function fillTemplate(tpl, vars) {
  const empty = (key) => vars[key] === '' || vars[key] === 0 || vars[key] === undefined || vars[key] === null;
  return String(tpl || '').split('\n').map((line) => {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (!keys.length) return line;
    const onlyFields = !line.replace(/\{\w+\}/g, '').trim();
    if (onlyFields) {
      const out = keys.filter((k) => !empty(k)).map((k) => vars[k]).join(' ');
      return out || null;
    }
    if (keys.some(empty)) return null;
    return line.replace(/\{(\w+)\}/g, (m, key) => (vars[key] ?? m));
  }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function listingFor(b) {
  const pk = packById(b.packId) || { kind: b.type === 'tin' ? 'tin' : 'bundle', name: b.name || b.label };
  const S = state.settings;
  const tag = (S.hashtag || '').replace(/^#/, '').trim();
  const setLabel = b.setName || (b.ref && b.ref !== 'mix' && b.ref !== 'random' ? setName(b.ref) : '');
  const vars = {
    naam: pk.name || b.label,
    kaarten: b.size,
    cu: (b.cu ?? (b.size - (b.shiny || 0) - (b.energy || 0))) + (b.energy || 0), // energy telt mee als gewone kaart
    holo: b.shiny || 0,
    energy: b.energy || 0,
    extras: parseExtras(b.extras).map((x) => x.label).join(', '),
    set: setLabel || 'verschillende Scarlet & Violet sets',
    prijs: eur(b.price),
    hashtag: tag ? `#${tag}` : '',
    hashtagsoort: tag ? `#${tag}${pk.kind === 'tin' ? 'tins' : 'bundels'}` : '',
    hashtagset: tag && setLabel ? `#${tag}${setLabel.replace(/[^A-Za-z0-9]/g, '')}` : '',
    zoekwoorden: S.keywords || '',
  };
  const kind = pk.kind === 'tin' ? 'tin' : 'bundle';
  return {
    title: fillTemplate(pk.title || TEMPLATES[`${kind}Title`], vars),
    text: fillTemplate(pk.text || TEMPLATES[`${kind}Text`], vars),
  };
}

function stepSheet(id, step) {
  const targets = stepTargets(id);
  if (!targets.length) return;
  const label = STEPS.find(([s]) => s === step)[1];
  const done = targets.every((b) => b.steps?.[step]);
  const total = targets.reduce((s, b) => s + b.price, 0);
  const names = `<ul class="kv">${targets.map((b) => `<li><span>${esc(b.label)}</span><b>${eur(b.price)}</b></li>`).join('')}</ul>`;
  let body = '';
  if (step === 'online') {
    body = targets.map((b, i) => {
      const l = listingFor(b);
      return `
        <div class="listing">
          ${targets.length > 1 ? `<div class="acc-sub">${esc(b.label)}</div>` : ''}
          <label class="field"><span>Titel</span><input class="input" readonly value="${esc(l.title)}" id="lt-${i}"></label>
          <button class="btn small" data-action="copy" data-src="lt-${i}">${icon('copy', 16)} Titel kopiëren</button>
          <label class="field"><span>Beschrijving</span><textarea class="input" rows="12" readonly id="ld-${i}">${esc(l.text)}</textarea></label>
          <button class="btn small" data-action="copy" data-src="ld-${i}">${icon('copy', 16)} Beschrijving kopiëren</button>
        </div>`;
    }).join('');
  } else if (step === 'geld') {
    body = `${names}
      <label class="field"><span>Platform</span>
        <select class="input" id="sale-platform">${PLATFORMS.map((p) => `<option>${p}</option>`).join('')}</select></label>
      <label class="field"><span>Ontvangen bedrag (zonder verzending, na korting)</span>
        <input class="input" id="sale-price" type="number" inputmode="decimal" step="0.01" min="0" value="${total}"></label>
      <label class="field"><span>Datum</span><input class="input" id="step-date" type="date" value="${today()}"></label>
      <p class="muted small">Na bevestigen gaat dit naar Verkocht.</p>`;
  } else {
    body = `${names}
      <label class="field"><span>Datum</span><input class="input" id="step-date" type="date" value="${today()}"></label>
`;
  }
  openSheet(`
    <h2>${label}</h2>
    ${body}
    <div class="btn-row sticky-actions">
      ${done && step !== 'geld' ? `<button class="btn ghost danger" data-action="step-clear" data-id="${id}" data-step="${step}">Status wissen</button>` : ''}
      <button class="btn" data-action="close-sheet">Annuleren</button>
      <button class="btn primary" data-action="step-ok" data-id="${id}" data-step="${step}">${icon('check', 18)} ${step === 'online' ? 'Staat online' : 'Bevestigen'}</button>
    </div>`);
}

async function confirmStep(id, step) {
  const targets = stepTargets(id);
  const at = $('#step-date')?.value || today();
  if (step === 'geld') {
    const sale = {
      id: uid(),
      platform: $('#sale-platform').value,
      price: Number($('#sale-price').value) || 0,
      date: at,
      bundleIds: targets.map((b) => b.id),
      labels: targets.map((b) => b.label),
    };
    for (const b of targets) { b.steps = { ...(b.steps || {}), geld: { at } }; b.status = 'verkocht'; b.saleId = sale.id; state.pick.delete(b.id); }
    state.sales.unshift(sale);
    await save.bundles(); await save.sales();
    closeSheet(); toast('Verkocht! Staat nu bij Verkocht.'); render();
    return;
  }
  for (const b of targets) b.steps = { ...(b.steps || {}), [step]: { at } };
  await save.bundles();
  closeSheet();
  render();
}

async function clearStep(id, step) {
  for (const b of stepTargets(id)) if (b.steps) delete b.steps[step];
  await save.bundles();
  closeSheet(); render();
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
    <header class="page-head"><h1>Verkocht</h1>
      <p class="muted small">${yearSales.length} ${yearSales.length === 1 ? 'verkoop' : 'verkopen'} · ${eur(total)} in ${year}. DAC7: platformen melden vanaf ${DAC7.sales} verkopen of meer dan ${eur(DAC7.revenue)} per jaar.</p></header>
    ${per}
    <section class="card"><h2>Alle verkopen</h2>${list ? `<ul class="sales">${list}</ul>` : '<p class="muted">Nog geen verkopen.</p>'}</section>`;
}

async function undoSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s || !confirm('Verkoop ongedaan maken? De tins/bundels komen terug bij "Te verkopen".')) return;
  for (const b of state.bundles) if (s.bundleIds.includes(b.id)) { b.status = 'gemaakt'; delete b.saleId; if (b.steps) delete b.steps.geld; }
  state.sales = state.sales.filter((x) => x.id !== id);
  await save.bundles();
  await save.sales();
  render();
}

// ----- Instellingen -----

function packEditor(p) {
  const sets = state.settings.mySets.map((id) => [id, setName(id)]).sort((x, y) => x[1].localeCompare(y[1]));
  const src = [['mix', 'Alle sets gemengd'], ['perset', 'Per set (apart per set)'], ...sets]
    .map(([v, l]) => `<option value="${esc(v)}" ${p.source === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const f = (field, label, type = 'number', extra = '') => `<label class="field"><span>${label}</span><input class="input" type="${type}" ${extra} value="${esc(p[field] ?? '')}" data-pack="${esc(p.id)}" data-pf="${field}"></label>`;
  return `
    <details class="pack" data-pack-open="${esc(p.id)}" ${state.openPack === p.id ? 'open' : ''}>
      <summary><span class="acc-t">${esc(p.name)}</span><span class="acc-s">${esc(compText(p))} · ${eur(p.price)}</span></summary>
      <div class="pack-b">
        ${f('name', 'Naam', 'text')}
        <label class="field"><span>Kaarten uit</span><select class="input" data-pack="${esc(p.id)}" data-pf="source">${src}</select></label>
        <div class="four">
          ${f('cu', 'Gewoon', 'number', 'min="0" inputmode="numeric"')}
          ${f('shiny', 'Holo/rev.', 'number', 'min="0" inputmode="numeric"')}
          ${f('energy', 'Energy', 'number', 'min="0" inputmode="numeric"')}
          ${f('price', 'Prijs (€)', 'number', 'min="0" step="0.05" inputmode="decimal"')}
        </div>
        ${p.kind === 'tin' ? f('stock', 'Beschikbare tins', 'number', 'min="0" inputmode="numeric"') : ''}
        ${f('extras', 'Extra (bv. 1 sticker, 1 coin)', 'text')}
        ${f('title', 'Titel zoekertje', 'text')}
        <label class="field"><span>Tekst zoekertje</span><textarea class="input" rows="10" data-pack="${esc(p.id)}" data-pf="text">${esc(p.text || '')}</textarea></label>
        <div class="btn-row">
          <button class="btn small" data-action="pack-move" data-pack="${esc(p.id)}" data-dir="-1">Omhoog</button>
          <button class="btn small" data-action="pack-move" data-pack="${esc(p.id)}" data-dir="1">Omlaag</button>
          <button class="btn small" data-action="pack-reset-text" data-pack="${esc(p.id)}">Standaardtekst</button>
          <button class="btn ghost small danger" data-action="pack-remove" data-pack="${esc(p.id)}">Verwijderen</button>
        </div>
      </div>
    </details>`;
}

function packList(kind) {
  const list = kind === 'tin' ? tinPacks() : bundlePacks();
  return `
    <p class="muted small">${kind === 'tin'
    ? 'Tins krijgen in de analyse altijd voorrang, in deze volgorde. "Gewoon" = common/uncommon uit je inventaris; holo/reverse, energy en extra\'s neem je er zelf bij.'
    : 'Bundels komen na de tins, in deze volgorde. Zet een bundel "uit alle sets gemengd" onderaan: die krijgt het overschot.'}</p>
    <div class="packs">${list.map(packEditor).join('') || '<p class="muted small">Nog geen.</p>'}</div>
    <div class="btn-row"><button class="btn small" data-action="pack-add" data-kind="${kind}">${icon('plus', 16)} ${kind === 'tin' ? 'Tin' : 'Bundel'} toevoegen</button></div>`;
}

function renderSettings() {
  const S = state.settings;
  const acc = (id, title, sum, body) => `
    <details class="acc" data-acc="set" data-id="${id}" ${state.openAcc === id ? 'open' : ''}>
      <summary><span class="acc-t">${title}</span><span class="acc-s">${sum}</span></summary>
      <div class="acc-b">${body}</div>
    </details>`;
  return `
    <header class="page-head"><h1>Instellingen</h1></header>
    <div class="accs">
    ${acc('tins', 'Tins', `${tinPacks().length} soorten · ${tinPacks().reduce((n, p) => n + (p.stock || 0), 0)} beschikbaar`, packList('tin'))}
    ${acc('bundles', 'Bundels', `${bundlePacks().length} soorten`, packList('bundle'))}
    ${acc('listing', 'Zoekertjes', `#${esc(S.hashtag || '')}`, `
      <label class="field"><span>Eigen hashtag (zonder #)</span><input class="input" value="${esc(S.hashtag || '')}" data-text-setting="hashtag"></label>
      <label class="field"><span>Zoekwoorden onderaan</span><textarea class="input" rows="4" data-text-setting="keywords">${esc(S.keywords || '')}</textarea></label>
      <p class="muted small">Invulvelden in de teksten van tins en bundels: {naam} {kaarten} {cu} (gewoon + energy) {holo} {energy} {extras} {set} {prijs} {hashtag} {hashtagsoort} {hashtagset} {zoekwoorden}. Een regel waarin een invulveld leeg of 0 is, valt weg.</p>`)}
    ${acc('backup', 'Back-up', 'alles staat enkel op dit toestel', `
      <p class="muted small">Maak geregeld een back-up: zo raak je je voorraad, bundels en verkopen niet kwijt.</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Back-up downloaden</button>
        <label class="btn">Back-up terugzetten<input type="file" accept=".json" data-input="restore" hidden></label>
      </div>`)}
    ${acc('wipe', 'Alles wissen', 'voorraad, bundels en verkopen', `
      <p class="muted small">Wist alle gegevens van PokeBundels op dit toestel. Maak eerst een back-up als je iets wilt bewaren.</p>
      <div class="btn-row"><button class="btn danger" data-action="wipe">Alle gegevens wissen</button></div>`)}
    ${acc('about', 'Over PokeBundels', `versie ${VERSION}`, `
      <div class="btn-row">
        <button class="btn" data-action="check-update">${icon('refresh', 18)} Zoek naar update</button>
        <button class="btn" data-action="refresh-setlist">Setlijst vernieuwen</button>
      </div>
      <p class="muted small">Kaartgegevens en afbeeldingen via TCGdex.</p>`)}
    </div>`;
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
    state.settings = migrateSettings(data.settings);
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
    case 'add-set-id': {
      const v = $('#manual-set')?.value.trim();
      if (!v) break;
      await loadSet(v);
      break;
    }
    case 'open-set': state.invSet = el.dataset.set; render(); window.scrollTo(0, 0); break;
    case 'close-set': state.invSet = null; render(); break;
    case 'flt-all': state.invFilter.all = el.dataset.val === '1'; render(); break;
    case 'flt-owned': state.invFilter.owned = !state.invFilter.owned; render(); break;
    case 'inc': requestCount(el.dataset.card, (state.inventory[el.dataset.card] || 0) + 1); break;
    case 'dec': setCount(el.dataset.card, (state.inventory[el.dataset.card] || 0) - 1); break;
    case 'import': importSheet(); break;
    case 'do-import': await doImport(); break;
    case 'rare-yes': await approveRare(el.dataset.card); closeSheet(); setCount(el.dataset.card, Number(el.dataset.n)); toast('Kaart toegevoegd.'); break;
    case 'rare-no': closeSheet(); setCount(el.dataset.card, state.inventory[el.dataset.card] || 0); break;
    case 'rare-import': {
      let n = 0;
      for (const cb of document.querySelectorAll('#rare-box input[data-rare]')) {
        if (!cb.checked) continue;
        await approveRare(cb.dataset.rare);
        state.inventory[cb.dataset.rare] = Number(cb.dataset.n);
        n++;
      }
      await save.inventory();
      $('#rare-box').innerHTML = `<p class="ok">${icon('check', 16)} ${n} rare${n === 1 ? '' : 's'} toegevoegd.</p>`;
      render();
      break;
    }
    case 'rare-import-skip': $('#rare-box').innerHTML = '<p class="muted small">Rares niet toegevoegd.</p>'; break;
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
    case 'sub': state.sub[el.dataset.view] = el.dataset.sub; render(); break;
    case 'mode': state.settings.activeMode = Number(el.dataset.k); await save.settings(); render(); break;
    case 'start-analysis': startAnalysisSheet(); break;
    case 'run-analysis': await runAnalysis(); break;
    case 'make': makeSheet(el.dataset.key); break;
    case 'confirm-make': await confirmMake(el.dataset.key); break;
    case 'unmake': e.preventDefault(); await unmake(el.dataset.id); break;
    case 'pick': {
      if (el.checked) state.pick.add(el.dataset.id); else state.pick.delete(el.dataset.id);
      render();
      break;
    }
    case 'step': stepSheet(el.dataset.id, el.dataset.step); break;
    case 'step-ok': await confirmStep(el.dataset.id, el.dataset.step); break;
    case 'step-clear': await clearStep(el.dataset.id, el.dataset.step); break;
    case 'copy': {
      const src = document.getElementById(el.dataset.src);
      if (!src) break;
      try { await navigator.clipboard.writeText(src.value); toast('Gekopieerd.'); }
      catch { src.select(); document.execCommand('copy'); toast('Gekopieerd.'); }
      break;
    }
    case 'pack-add': {
      const kind = el.dataset.kind;
      const base = defaultPacks().find((p) => p.kind === kind && (kind === 'tin' ? p.id === 'tin' : p.id === 'random'));
      const p = { ...base, id: uid(), name: kind === 'tin' ? 'Nieuwe tin' : 'Nieuwe bundel', stock: kind === 'tin' ? 0 : null };
      const at = kind === 'tin' ? state.settings.packs.filter((x) => x.kind === 'tin').length : state.settings.packs.length;
      state.settings.packs.splice(at, 0, p);
      state.openPack = p.id; state.openAcc = kind === 'tin' ? 'tins' : 'bundles';
      await save.settings(); render(); break;
    }
    case 'pack-move': {
      const list = state.settings.packs;
      const p = packById(el.dataset.pack);
      const same = list.filter((x) => (x.kind === 'tin') === (p.kind === 'tin'));
      const i2 = same.indexOf(p) + Number(el.dataset.dir);
      if (i2 < 0 || i2 >= same.length) break;
      const other = same[i2];
      const a1 = list.indexOf(p), a2 = list.indexOf(other);
      [list[a1], list[a2]] = [list[a2], list[a1]];
      state.openPack = p.id;
      await save.settings(); render(); break;
    }
    case 'pack-reset-text': {
      const p = packById(el.dataset.pack);
      const kind = p.kind === 'tin' ? 'tin' : 'bundle';
      p.title = TEMPLATES[`${kind}Title`]; p.text = TEMPLATES[`${kind}Text`];
      state.openPack = p.id;
      await save.settings(); render(); toast('Standaardtekst teruggezet.'); break;
    }
    case 'pack-remove': {
      const p = packById(el.dataset.pack);
      if (!p || !confirm(`"${p.name}" verwijderen? Al gemaakte tins/bundels blijven bestaan.`)) break;
      state.settings.packs = state.settings.packs.filter((x) => x !== p);
      await save.settings(); render(); break;
    }
    case 'undo-sale': await undoSale(el.dataset.id); break;
    case 'export': await exportBackup(); break;
    case 'check-update': await checkUpdate(); break;
    case 'refresh-setlist': try { state.setList = await listSets(true); toast('Setlijst vernieuwd.'); render(); } catch (err) { toast(err.message); } break;
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
  if (el.dataset.input === 'count') requestCount(el.dataset.card, Number(el.value));
  if (el.dataset.input === 'restore' && el.files?.[0]) await restoreBackup(el.files[0]);
  if (el.dataset.pf) {
    const p = packById(el.dataset.pack);
    if (!p) return;
    const f = el.dataset.pf;
    if (['name', 'extras', 'title', 'text', 'source'].includes(f)) p[f] = f === 'name' ? (el.value.trim() || p.name) : el.value;
    else {
      const v = Number(el.value);
      if (!Number.isFinite(v) || v < 0) { toast('Ongeldig getal.'); return; }
      p[f] = f === 'price' ? v : Math.round(v);
    }
    state.analysisCache = {};
    await save.settings();
  }
  if (el.dataset.textSetting) {
    state.settings[el.dataset.textSetting] = el.dataset.textSetting === 'hashtag' ? el.value.replace(/[#\s]/g, '') : el.value;
    await save.settings();
  }
  if (el.dataset.setting) {
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    state.settings[el.dataset.setting] = v;
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
  if (!state.setList.length) {
    listSets().then((l) => { state.setList = l; if (state.view === 'set' || state.view === 'inv') render(); }).catch(() => {});
  }
  fillReleaseDates(Object.values(state.sets)).then((ch) => { if (ch && state.view === 'inv') render(); }).catch(() => {});
  $('#upd').addEventListener('click', () => { if (swWaiting) swWaiting.postMessage('skip'); else location.reload(); });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset?.packOpen) {
      if (d.open) state.openPack = d.dataset.packOpen; else if (state.openPack === d.dataset.packOpen) state.openPack = null;
      return;
    }
    if (d.dataset?.era) {
      if (d.open) state.openEras.add(d.dataset.era); else state.openEras.delete(d.dataset.era);
      saveOpenEras();
      return;
    }
    if (!d.dataset?.acc) return;
    if (d.open) {
      state.openAcc = d.dataset.id;
      document.querySelectorAll(`details[data-acc="${d.dataset.acc}"][open]`).forEach((x) => { if (x !== d) x.open = false; });
      setTimeout(() => { const r = d.getBoundingClientRect(); if (r.top < 0) window.scrollBy(0, r.top - 8); }, 0);
    } else if (state.openAcc === d.dataset.id) state.openAcc = null;
  }, true);
  setupSW();
}

start();
