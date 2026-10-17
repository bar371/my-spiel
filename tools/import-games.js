#!/usr/bin/env node
/*
 * Builds the game list in data/spiel-data.js from two sources, keeping the hand-written
 * preview games:
 *
 *  1. SPIEL's official novelty list (spiel-essen.de → The SPIEL → Novelties), the data
 *     behind that page at maps.eyeled-services.de: what exhibitors bring, with the official
 *     hall and booth. Games on it get `spiel: <id>`.
 *  2. BoardGameGeek's SPIEL 2026 preview (boardgamegeek.com/geekpreviewv2/93): BGG links
 *     and tags, plus games the official list doesn't have (`bgg: <id>`).
 *
 *   node tools/import-games.js                        # fetch both
 *   node tools/import-games.js --skip-bgg             # official list only, keep the BGG games already in the seed
 *   node tools/import-games.js --bgg items.json --spiel snapshot.json   # saved copies
 *
 * Preview games (preview: true) are kept as written; the sources only fill empty fields,
 * except the booth, which the official list always sets. Imported games are rebuilt
 * from fresh data on every run.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PREVIEW_ID = 93;
const API = "https://api.geekdo.com/api/geekpreviewitems";
const DATA = path.join(__dirname, "..", "data", "spiel-data.js");

const first = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== "");
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : undefined; };
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const bare = s => String(s || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/[°]/g, "");
const slug = s => norm(s).replace(/ /g, "-");
const strip = s => String(s || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "’")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
const clip = (s, n = 400) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n)).replace(/[,;:.\s]+$/, "") + "…";
const range = (a, b, unit = "") => {
  a = num(a); b = num(b);
  if (!a && !b) return undefined;
  if (!a || !b || a === b) return `${a || b}${unit}`;
  return `${Math.min(a, b)}–${Math.max(a, b)}${unit}`;
};

async function fetchItems() {
  const items = [];
  for (let page = 1; page < 200; page++) {
    const url = `${API}?nosession=1&pageid=${page}&previewid=${PREVIEW_ID}`;
    // BGG sometimes answers with an error page instead of JSON (rate limiting): wait and retry
    let body;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "User-Agent": "my-spiel planner importer (github.com/bar371/my-spiel)", Accept: "application/json" } });
      const text = await res.text();
      try { if (res.ok) { body = JSON.parse(text); break; } } catch (_) { /* retry below */ }
      if (attempt >= 5) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      console.log(`page ${page}: HTTP ${res.status}, not JSON; retrying`);
      await new Promise(r => setTimeout(r, 3000 * 2 ** attempt));
    }
    const batch = Array.isArray(body) ? body : body.items || body.data || [];
    if (page === 1) console.log("Sample item:\n" + JSON.stringify(batch[0], null, 1).slice(0, 4000));
    if (!batch.length) break;
    items.push(...batch);
    console.log(`page ${page}: ${batch.length} items (total ${items.length})`);
    await new Promise(r => setTimeout(r, 400));
  }
  return items;
}

// Publishers type booths freely ("3G200", "Hall 6 6D405", "H2D410", "5.K415 (Japon Brand)",
// "Asmodee, Halle 7"); turn them into hall "3" + booth "3-G200" where possible.
function parseBooth(loc) {
  if (!loc) return {};
  const m = loc.match(/(?:^|[^0-9A-Z])(?:hall[e]?\s*|h)?(\d{1,2})\s*[-.,]?\s*([A-Z])\s*-?(\d{2,4})(?![0-9])/i);
  if (m) return { hall: String(+m[1]), booth: `${+m[1]}-${m[2].toUpperCase()}${m[3]}` };
  const h = loc.match(/\bhall[e]?\s*(\d{1,2})\b/i);
  return { hall: h ? String(+h[1]) : undefined, booth: loc };
}

// ---------- Tags ----------
// A short, fixed list of game types to filter on. Each tag matches BGG mechanic, category
// and subdomain names ("bgg") and, as a fallback for games BGG hasn't classified yet,
// words in the name and description ("text").
const TAG_RULES = [
  ["Engine building",   { bgg: /engine building|tableau building|tech trees|income|chaining/,       text: /(?<!steam |fire |game |rocket )\bengines?\b|tableau[- ]build|\bcombos?\b|synerg/ }],
  ["Deck building",     { bgg: /deck,? bag,? and pool building|deck construction/,                   text: /deck[- ]?build|bag[- ]build|pool[- ]build/ }],
  ["Worker placement",  { bgg: /worker placement/,                                                    text: /worker[- ]placement|place (?:your )?workers/ }],
  ["Drafting",          { bgg: /drafting/,                                                            text: /draft/ }],
  ["Tile laying",       { bgg: /tile placement|grid coverage|polyomino/,                              text: /tile[- ](?:laying|placement|placing)|place (?:the )?tiles|polyomino/ }],
  ["Set collection",    { bgg: /set collection/,                                                      text: /set collection|collect sets/ }],
  ["Area control",      { bgg: /area majority|area control|influence/,                                text: /area (?:control|majority)|majorit(?:y|ies)\b|control (?:the )?(?:regions|territor)/ }],
  ["PvP / conflict",    { bgg: /take that|player elimination|fighting|wargame|conflict|dueling/, text: /\bpvp\b|take[- ]that|attack (?:your )?(?:opponent|rival)s?|battle|duel|combat|warfare|skirmish/ }],
  ["Co-op",             { bgg: /cooperative game/,                                                    text: /\bco-?op(?:erative)?\b|work together|together against/ }],
  ["Trick-taking",      { bgg: /trick-taking|ladder climbing/,                                       text: /trick[- ]?taking|ladder[- ]climbing/ }],
  ["Bluffing & deduction", { bgg: /bluffing|deduction|hidden roles|traitor|social deduction/,         text: /bluff|deduc|hidden (?:role|identit)|traitor|whodunit|mystery/ }],
  ["Push your luck",    { bgg: /push your luck|press your luck/,                                      text: /push[- ]your[- ]luck|press[- ]your[- ]luck/ }],
  ["Roll & write",      { bgg: /paper-and-pencil|roll and write|flip and write|write-in/,             text: /(?:roll|flip)[- ](?:and|&|n|'n')[- ]write|roll[- ]?&[- ]?write/ }],
  ["Dice",              { bgg: /^dice$|dice rolling|dice placement/,                                  text: /\bdice\b/ }],
  ["Negotiation & auctions", { bgg: /negotiation|trading|auction|bidding|bribery/,             text: /negotiat|auction|bidding|bid for|\btrading\b/ }],
  ["Real-time",         { bgg: /real-time|speed matching/,                                            text: /real[- ]time|speed game|as fast as/ }],
  ["Puzzle",            { bgg: /puzzle|pattern building|spatial|pattern recognition/,                text: /puzzl|spatial/ }],
  ["Abstract",          { bgg: /abstract/,                                                            text: /\babstract\b/ }],
  ["Party",             { bgg: /party/,                                                               text: /party game|for (?:big |large )?groups|word game|drawing game|trivia/ }],
  ["Family",            { bgg: /family games|children's game/,                                        text: /\bfamil(?:y|ies)\b|\bkids?\b|children/ }],
  ["Economic",          { bgg: /economic|stock holding|investment|loans/,                             text: /econom|stock market|\binvest/ }],
  ["Adventure & campaign", { bgg: /adventure|dungeon|campaign|legacy|scenario|storytelling|role playing|narrative/, text: /adventur|dungeon|campaign|legacy|\bquests?\b/ }],
  ["Racing",            { bgg: /^racing$|^race$/,                                                     text: /\bracing\b|race cars?|\bkarts?\b/ }],
  ["Dexterity",         { bgg: /dexterity|flicking|stacking and balancing/,                           text: /\bflick|dexterity|\bstacking\b/ }],
  ["Card game",         { bgg: /^card game$/,                                                         text: /card game/ }]
];

// BGG ids of SPIEL-preview listings to keep even though neither they nor their publisher
// list a booth
const KEEP_WITHOUT_BOOTH = [
  474854  // Agent Avenue: Four Seasons (Nerdlab Games)
];

// Hand-picked tags, by game id, for games the rules above miss
const MANUAL_TAGS = {
  "8-dragons": ["Set collection"],
  "antgravity": ["PvP / conflict"],
  "tornado-splash": ["Card game"],
  "wingspan-pocket": ["Engine building"],
  "medico": ["Bluffing & deduction"]   // everyone secretly picks a location each round
};

const tagsFrom = ({ bggNames = [], text = "", minP, maxP, minT, maxT, expansion, extra = [] }) => {
  const names = bggNames.map(n => String(n).toLowerCase());
  const t = String(text).toLowerCase();
  const tags = [...extra, ...TAG_RULES.filter(([, r]) => names.some(n => r.bgg.test(n)) || r.text.test(t)).map(([tag]) => tag)];
  // Fighting monsters together isn't PvP: keep the conflict tag on co-op games only when
  // players also act against each other
  if (tags.includes("Co-op") && tags.includes("PvP / conflict") &&
      !names.some(n => /take that|player elimination|semi-cooperative|traitor|wargame/.test(n)) && !/\bpvp\b|take[- ]that/.test(t))
    tags.splice(tags.indexOf("PvP / conflict"), 1);
  if (num(minP) === 1 && !tags.includes("Solo")) tags.push("Solo");
  if (num(maxP) === 2 || (!maxP && /\b(?:two|2)[- ]player|\bfor two\b|\bduel/.test(t))) tags.push("2 players");
  if (num(maxP) >= 6) tags.push("6+ players");
  const tMax = num(maxT) || num(minT);
  if (tMax && tMax <= 30) tags.push("Quick (≤30 min)");
  if (num(minT) >= 120 || num(maxT) >= 150) tags.push("Long (2h+)");
  if (expansion) tags.push("Expansion");
  return tags;
};
const TAG_ORDER = [...TAG_RULES.map(([t]) => t), "Solo", "2 players", "6+ players", "Quick (≤30 min)", "Long (2h+)", "Expansion",
  "Beginner", "Connoisseur", "Expert"];
const sortTags = tags => [...new Set(tags)].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
// "1–4" → [1, 4], "90 min" → [90, 90], "up to 6" → [undefined, 6]
const bounds = s => { const n = String(s || "").match(/\d+(?:\.\d+)?/g) || []; return /up to/i.test(s) ? [undefined, n[0]] : [n[0], n[1] || n[0]]; };
const bggStats = { linkKeys: {}, names: {} };

function toGame(it) {
  const gi = (it.geekitem && (it.geekitem.item || it.geekitem)) || it.item || {};
  const objectid = first(it.objectid, gi.objectid, gi.id);
  const name = strip(first(gi.name, gi.primaryname && gi.primaryname.name, it.name, it.title));
  if (!name || !objectid) return null;

  const pubs = [];
  (Array.isArray(it.publishers) ? it.publishers : []).forEach(p => pubs.push(first(p.item && p.item.name, p.name)));
  if (!pubs.filter(Boolean).length && gi.links && Array.isArray(gi.links.boardgamepublisher))
    gi.links.boardgamepublisher.forEach(p => pubs.push(p.name));
  const publisher = [...new Set(pubs.filter(Boolean).map(strip))].slice(0, 2).join(" / ") || undefined;

  // Booth, e.g. "3-A100", "Hall 3 A100", "6B200"
  const locs = [it.location, ...(Array.isArray(it.publishers) ? it.publishers.map(p => p.location) : [])]
    .map(l => strip(l)).filter(Boolean);
  const { hall, booth } = parseBooth(locs[0]);

  const price = num(first(it.showprice, it.msrp, it.price));
  const href = first(gi.href, it.href);
  const url = href ? (href.startsWith("http") ? href : `https://boardgamegeek.com${href}`)
    : `https://boardgamegeek.com/boardgame/${objectid}`;
  const desc = strip(first(it.description, it.short_description, gi.short_description, gi.description));
  const links = gi.links || {};
  const bggNames = [];
  Object.keys(links).forEach(k => {
    bggStats.linkKeys[k] = (bggStats.linkKeys[k] || 0) + 1;
    if (/mechanic|category|subdomain/.test(k) && Array.isArray(links[k])) links[k].forEach(l => {
      if (!l || !l.name) return;
      bggNames.push(l.name);
      bggStats.names[`${k}: ${l.name}`] = (bggStats.names[`${k}: ${l.name}`] || 0) + 1;
    });
  });
  const subtypes = [].concat(gi.subtypes || [], gi.subtype || [], it.objecttype || []).join(" ");
  const tags = sortTags(tagsFrom({
    bggNames, text: `${name} ${desc} ${strip(gi.short_description)}`,
    minP: first(gi.minplayers, it.minplayers), maxP: first(gi.maxplayers, it.maxplayers),
    minT: first(gi.minplaytime, it.minplaytime), maxT: first(gi.maxplaytime, it.maxplaytime),
    expansion: /expansion/.test(subtypes) || /\/boardgameexpansion\//.test(href || "")
  }));
  const g = {
    id: `bgg-${objectid}`,
    bgg: Number(objectid) || String(objectid),
    name,
    publisher,
    hall,
    booth,
    players: range(first(gi.minplayers, it.minplayers), first(gi.maxplayers, it.maxplayers)),
    duration: range(first(gi.minplaytime, it.minplaytime), first(gi.maxplaytime, it.maxplaytime), " min"),
    price,
    url,
    description: desc ? clip(desc) : undefined,
    tags: tags.length ? tags : undefined,
    sessions: []
  };
  Object.keys(g).forEach(k => g[k] === undefined && delete g[k]);
  return g;
}

function loadSeed() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(DATA, "utf8"), ctx);
  return ctx.window.SPIEL_SEED;
}

function merge(seed, bggGames) {
  // Drop earlier imports (they're rebuilt below and by the official-list step), keep hand-written games
  const kept = seed.games.filter(g => g.preview || (g.bgg === undefined && g.spiel === undefined));
  const byName = new Map();
  kept.forEach(g => { byName.set(norm(g.name), g); if (!byName.has(norm(bare(g.name)))) byName.set(norm(bare(g.name)), g); });
  // "Foundation" (preview) vs "Foundation: Isaac Asimov" (BGG), same publisher
  const sameGame = (g, b) => {
    const a = norm(g.name), c = norm(b.name), pa = norm(g.publisher), pb = norm(b.publisher);
    return a && c && (c.startsWith(a + " ") || a.startsWith(c + " ")) && pa && pb &&
      (pa.includes(pb.split(" ")[0]) || pb.includes(pa.split(" ")[0]));
  };
  const byBgg = new Map(kept.filter(g => g.bgg !== undefined).map(g => [String(g.bgg), g]));
  const bggId = g => { const m = String(g.url || "").match(/boardgamegeek\.com\/boardgame(?:expansion)?\/(\d+)/); return m && m[1]; };
  kept.forEach(g => { const id = bggId(g); if (id && !byBgg.has(id)) byBgg.set(id, g); });

  // "dlp games stand" gives way to a real booth such as "3-C115"
  const vagueBooth = (k, g) => k === "booth" && !/\d\s*-?\s*[A-Z]\s*\d{2}/i.test(g.booth);
  const ids = new Set(kept.map(g => g.id));
  const bggTags = new Map();
  const added = [];
  let enriched = 0, skipped = 0, inferred = 0;
  // The same game can be listed more than once (several publishers or editions): combine them
  const byId = new Map();
  bggGames.forEach(b => {
    const prev = byId.get(String(b.bgg));
    if (!prev) return byId.set(String(b.bgg), { ...b });
    Object.keys(b).forEach(k => { if (prev[k] === undefined) prev[k] = b[k]; });
  });
  const unique = [...byId.values()];
  // Where each publisher exhibits: the booth most of its listings give, counting the
  // listings where it is the main publisher first
  const pubList = b => String(b.publisher || "").split(" / ").map(p => norm(p)).filter(Boolean);
  const pubBooths = new Map();
  unique.filter(b => b.booth).forEach(b => pubList(b).forEach((p, i) => {
    if (!pubBooths.has(p)) pubBooths.set(p, new Map());
    const key = `${b.hall || ""}|${b.booth}`, m = pubBooths.get(p);
    m.set(key, (m.get(key) || 0) + (i === 0 ? 10 : 1));
  }));
  const publisherBooth = b => {
    for (const p of pubList(b)) {
      const m = pubBooths.get(p);
      if (m) { const [key] = [...m.entries()].sort((x, y) => y[1] - x[1])[0]; const [hall, booth] = key.split("|"); return { hall: hall || undefined, booth }; }
    }
    return null;
  };
  // Exact matches first, so a loose name match can't take a game that has an exact one
  const matches = new Map(), taken = new Set();
  unique.forEach(b => {
    const m = byBgg.get(String(b.bgg)) || byName.get(norm(b.name)) || byName.get(norm(bare(b.name)));
    if (m && !taken.has(m.id)) { matches.set(b, m); taken.add(m.id); }
  });
  unique.forEach(b => {
    if (matches.has(b)) return;
    const m = kept.find(g => g.preview && !taken.has(g.id) && sameGame(g, b));
    if (m) { matches.set(b, m); taken.add(m.id); }
  });
  for (const b of unique) {
    const match = matches.get(b);
    if (match) {
      let touched = false;
      for (const k of ["publisher", "hall", "booth", "players", "duration", "price"])
        if (b[k] !== undefined && (match[k] === undefined || match[k] === "" || vagueBooth(k, match))) { match[k] = b[k]; touched = true; }
      if (match.bgg === undefined) { match.bgg = b.bgg; touched = true; }
      bggTags.set(match, b.tags || []);
      if (touched) enriched++;
      continue;
    }
    // No hall or booth listed: use the publisher's booth from its other listings; with
    // none of those either it's most likely not exhibited, unless kept on purpose
    if (!b.hall && !b.booth) {
      const pb = publisherBooth(b);
      if (pb) { Object.assign(b, pb, { boothFrom: "publisher" }); inferred++; }
      else if (!KEEP_WITHOUT_BOOTH.includes(b.bgg)) { skipped++; continue; }
    }
    let id = slug(b.name) || b.id;
    if (ids.has(id)) id = b.id;
    ids.add(id);
    const manual = MANUAL_TAGS[id] || MANUAL_TAGS[b.id];
    added.push({ ...b, id, ...(manual ? { tags: sortTags([...(b.tags || []), ...manual]) } : {}) });
  }
  // Hand-written games without a booth: the publisher's booth, when BGG lists one
  kept.forEach(g => {
    if (g.hall || g.booth) return;
    const pb = publisherBooth(g);
    if (pb) { Object.assign(g, pb, { boothFrom: "publisher" }); inferred++; }
  });
  // Tags for the hand-written games are rebuilt each run: BGG's (when listed there),
  // keywords from the description, and MANUAL_TAGS
  kept.forEach(g => {
    const [minP, maxP] = bounds(g.players), [minT, maxT] = bounds(g.duration);
    const t = sortTags([...(bggTags.get(g) || []), ...(MANUAL_TAGS[g.id] || []), ...tagsFrom({ text: `${g.name} ${g.description || ""}`, minP, maxP, minT, maxT,
      expansion: /^(?:expansion|add-on)\b|\badd-on\b|base game required/i.test(g.description || "") })]);
    if (t.length) g.tags = t; else delete g.tags;
  });
  added.sort((a, b) => a.name.localeCompare(b.name));
  return { games: [...kept, ...added], added: added.length, enriched, kept: kept.length, unique: unique.length, skipped, inferred };
}

// Same style as the hand-written entries: {"id": "x", "name": "Y", …}
const fmt = v => Array.isArray(v) ? `[${v.map(fmt).join(", ")}]`
  : v && typeof v === "object" ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmt(x)}`).join(", ")}}`
  : JSON.stringify(v);

function write(seed, games, total) {
  const src = fs.readFileSync(DATA, "utf8");
  const head = src.replace(/\n(?:  \/\/.*\n)*  games: \[[\s\S]*$/, "\n");
  if (head === src) throw new Error("could not find the games list in " + DATA);
  const nPreview = games.filter(g => g.preview).length;
  // Order of the tag filter chips in the app
  const tagLine = `  tags: ${fmt(TAG_ORDER)},\n`;
  const withTags = /\n  tags: \[.*\],\n/.test(head) ? head.replace(/\n  tags: \[.*\],\n/, "\n" + tagLine) : head + tagLine + "\n";
  const out = withTags +
`  // Built by tools/import-games.js: ${total.spiel} games from SPIEL's official novelty list
  // (spiel: <id>, with the official hall and booth), ${total.bgg} more from BoardGameGeek's SPIEL 2026
  // preview (bgg: <id>; boothFrom: "publisher" = the publisher's booth), and ${nPreview} picks from
  // preview articles (preview: true). Demo times are not published, so add them in the app
  // (Edit game) or here.
  games: [
${games.map(g => "    " + fmt(g)).join(",\n")}
  ]
};
`;
  fs.writeFileSync(DATA, out);
}

// ---------- SPIEL's official novelty list ----------
const SPIEL_API = "https://maps.eyeled-services.de/en/spiel26";

async function fetchSpiel() {
  const get = async name => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${SPIEL_API}/${name}`, { headers: { "User-Agent": "Mozilla/5.0 (my-spiel planner importer)", Referer: "https://www.spiel-essen.de/" } });
      const text = await res.text();
      try { if (res.ok) return JSON.parse(text); } catch (_) { /* retry */ }
      if (attempt >= 4) throw new Error(`${name}: HTTP ${res.status}: ${text.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 3000 * 2 ** attempt));
    }
  };
  const P = await get("products"), E = await get("exhibitors");
  const info = s => String(s || "").replace(/<\/(td|tr|p|li)>/gi, " | ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return {
    themes: Object.fromEntries((P.productThemes || []).map(t => [t.ID, t.TITEL])),
    products: (P.products || []).map(p => ({ ID: p.ID, TITEL: p.TITEL, UNTERTITEL: p.UNTERTITEL, FIRMA_ID: p.FIRMA_ID, HALLE: p.HALLE, STAND: p.STAND,
      STAENDE: (p.STAENDE || []).map(x => [x.HALLE, x.NAME]), WEB: p.WEB, THEMEN: p.THEMEN, INFO: info(p.INFO) })),
    exhibitors: (E.exhibitors || []).map(e => ({ ID: e.ID, NAME: e.NAME, HALLE: e.HALLE, STAND: e.STAND, STAENDE: (e.STAENDE || []).map(x => [x.HALLE, x.NAME]) }))
  };
}

// Official mechanism / category / level names → our tags
const OFFICIAL_TAGS = {
  "engine building": "Engine building", "deck building": "Deck building", "bag building": "Deck building",
  "worker placement": "Worker placement", "drafting": "Drafting", "tile placement": "Tile laying", "tile placement game": "Tile laying",
  "set collection": "Set collection", "area control": "Area control", "traitor": "Bluffing & deduction", "hidden roles": "Bluffing & deduction",
  "crime and detective game": "Bluffing & deduction", "cooperative": "Co-op", "trick taking": "Trick-taking", "push your luck": "Push your luck",
  "roll'n'write": "Roll & write", "flip'n'write": "Roll & write", "dice rolling": "Dice", "dice placement": "Dice", "dice game": "Dice",
  "auction": "Negotiation & auctions", "trade": "Negotiation & auctions", "puzzle": "Puzzle", "riddle": "Puzzle", "escape game": "Puzzle",
  "logic game": "Puzzle", "party game": "Party", "word game": "Party", "quiz game": "Party", "communication game": "Party",
  "childrens game": "Family", "dungeon crawler": "Adventure & campaign", "legacy": "Adventure & campaign", "campaign game": "Adventure & campaign",
  "story game": "Adventure & campaign", "roleplaying game": "Adventure & campaign", "dexterity game": "Dexterity", "action game": "Dexterity",
  "card game": "Card game", "solo game": "Solo", "beginner": "Beginner", "connoisseur": "Connoisseur", "expert": "Expert"
};

// "Hall 3" + "3G200" → { hall: "3", booth: "3-G200" }; "Galeria" stays as it is
const officialBooth = (hall, stand) => {
  const h = String(hall || "").replace(/^hall\s*/i, "").trim();
  const pb = parseBooth(stand);
  return pb.booth ? { hall: pb.hall || h || undefined, booth: pb.booth } : { hall: h || undefined, booth: stand || undefined };
};

// The info box is "Label: | value | | Label: | value | … | description"
function parseInfo(text) {
  const parts = String(text || "").split("|").map(x => x.trim()).filter(Boolean);
  const fields = {}, rest = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Z][A-Za-z /]{2,30}:$/.test(parts[i]) && i + 1 < parts.length && !/:$/.test(parts[i + 1])) { fields[parts[i].slice(0, -1).toLowerCase()] = parts[i + 1]; i++; }
    else if (!/:$/.test(parts[i])) rest.push(parts[i]);
  }
  return { fields, description: rest.join(" ").replace(/\s+/g, " ").trim() };
}

function officialGame(p, exById, themes) {
  const th = p.THEMEN || [];
  const { fields: f, description } = parseInfo(p.INFO);
  const ex = exById.get(String(p.FIRMA_ID)) || {};
  const stands = (p.STAENDE && p.STAENDE.length ? p.STAENDE : ex.STAENDE || []).map(([h, n]) => officialBooth(h, n));
  const uniq = [...new Map(stands.filter(x => x.booth).map(x => [x.booth, x])).values()];
  const main = uniq[0] || officialBooth(p.HALLE || ex.HALLE, p.STAND || ex.STAND);
  const pick = re => { const t = th.find(x => re.test(x)); return t && num(t.replace(/^\D+/, "").replace(",", ".")); };
  const minP = pick(/^BYMINPLAYERS/), maxP = pick(/^BYMAXPLAYERS/);
  const players = (f["number of players"] || "").replace(/\s*-\s*/, "–").replace(/\s+/g, "") || range(minP, maxP);
  const tm = (f["playing time"] || "").match(/(\d+)(?:\s*-\s*(\d+))?/);
  const BANDS = { "0000": [0, 15], "0016": [16, 30], "0031": [31, 60], "0061": [61, 90], "0091": [91, 120], "0121": [121, 180] };
  const band = (th.find(x => /^BYDURATION_/.test(x)) || "").slice(11);
  const [minT, maxT] = tm ? [num(tm[1]), num(tm[2]) || num(tm[1])] : BANDS[band] || [];
  const duration = tm ? range(tm[1], tm[2], " min") : band === "0121" ? "2h+" : BANDS[band] ? `${BANDS[band][0] || "≤"}${BANDS[band][0] ? "–" : ""}${BANDS[band][1]} min` : undefined;
  const pr = (f["retail price"] || "").match(/\d+(?:[.,]\d+)?/);
  const priceFrom = pick(/^BYPRICE_/);
  const names = th.map(id => themes[id]).filter(Boolean).map(n => n.toLowerCase());
  const extra = names.map(n => OFFICIAL_TAGS[n]).filter(Boolean);
  const authors = f.authors || f.author;
  const desc = [authors && authors !== "-" && `By ${authors}.`, description].filter(Boolean).join(" ");
  const g = {
    id: `spiel-${p.ID}`,
    spiel: Number(p.ID) || String(p.ID),
    name: strip(p.TITEL),
    publisher: strip(f.publisher && f.publisher !== "-" ? f.publisher : p.UNTERTITEL || ex.NAME) || undefined,
    hall: main.hall,
    booth: main.booth,
    otherBooths: uniq.length > 1 ? uniq.slice(1).map(x => x.booth) : undefined,
    players: players || undefined,
    duration,
    price: pr ? num(pr[0]) : undefined,
    priceBand: !pr && priceFrom !== undefined ? `€${priceFrom}–${priceFrom + 10}` : undefined,
    url: p.WEB || undefined,
    description: desc ? clip(strip(desc), 320) : undefined,
    sessions: []
  };
  const tags = sortTags(tagsFrom({ text: `${g.name} ${desc}`, minP: minP ?? (String(players || "").match(/^\d+/) || [])[0], maxP: maxP ?? (String(players || "").match(/\d+$/) || [])[0],
    minT, maxT, expansion: th.includes("TYPE.2"), extra }));
  if (tags.length) g.tags = tags;
  Object.keys(g).forEach(k => g[k] === undefined && delete g[k]);
  return g;
}

function mergeOfficial(games, data) {
  const exById = new Map(data.exhibitors.map(e => [String(e.ID), e]));
  const official = data.products.map(p => officialGame(p, exById, data.themes)).filter(o => o.name);
  // Earlier official-only entries are rebuilt; matched games get their official fields again
  const base = games.filter(g => g.preview || g.bgg !== undefined || g.spiel === undefined);
  base.forEach(g => { delete g.spiel; delete g.otherBooths; delete g.priceBand; });
  const keys = name => { const n = norm(name), b = norm(bare(name)); return [...new Set([n, b, n.replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim()])]; };
  const index = new Map();
  base.forEach(g => keys(g.name).forEach(k => { if (!index.has(k)) index.set(k, []); index.get(k).push(g); }));
  const ids = new Set(base.map(g => g.id));
  const added = [];
  let matched = 0;
  for (const o of official) {
    const g = keys(o.name).map(k => (index.get(k) || []).find(x => x.spiel === undefined)).find(Boolean);
    if (g) {
      matched++;
      Object.assign(g, { spiel: o.spiel, hall: o.hall, booth: o.booth });
      delete g.boothFrom;
      if (!g.booth) delete g.booth;
      if (!g.hall) delete g.hall;
      for (const k of ["otherBooths", "players", "duration", "price", "priceBand", "url", "description", "publisher"])
        if (o[k] !== undefined && (g[k] === undefined || g[k] === "")) g[k] = o[k];
      if (g.price !== undefined) delete g.priceBand;
      if (o.tags) g.tags = sortTags([...(g.tags || []), ...o.tags]);
      continue;
    }
    let id = slug(o.name) || o.id;
    if (ids.has(id)) id = o.id;
    ids.add(id);
    added.push({ ...o, id });
  }
  // BGG-only games whose booth was guessed from the publisher's other BGG listings:
  // use the publisher's stand from the official exhibitor list instead
  const exByName = new Map(data.exhibitors.map(e => [norm(e.NAME), e]));
  let fixed = 0;
  base.filter(g => g.spiel === undefined && g.boothFrom === "publisher").forEach(g => {
    const pubs = String(g.publisher || "").split(" / ").map(norm);
    const ex = pubs.map(p => exByName.get(p) || [...exByName.entries()].find(([n]) => n.startsWith(p + " ") || p.startsWith(n + " "))?.[1]).find(Boolean);
    if (!ex) return;
    const b = officialBooth((ex.STAENDE[0] || [])[0] || ex.HALLE, (ex.STAENDE[0] || [])[1] || ex.STAND);
    if (b.booth) { Object.assign(g, b); fixed++; }
  });
  added.sort((a, b) => a.name.localeCompare(b.name));
  return { games: [...base, ...added], matched, added: added.length, official: official.length, fixed };
}

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  let seed = loadSeed(), games = seed.games, bggAdded = games.filter(g => g.bgg !== undefined && !g.preview && g.spiel === undefined).length;
  if (!process.argv.includes("--skip-bgg")) {
    try {
      const raw = arg("--bgg") ? JSON.parse(fs.readFileSync(arg("--bgg"), "utf8")) : await fetchItems();
      const items = Array.isArray(raw) ? raw : raw.items || [];
      const bggGames = items.map(toGame).filter(Boolean);
      if (!bggGames.length) throw new Error(`no games parsed from ${items.length} preview items`);
      const r = merge(seed, bggGames);
      games = r.games;
      console.log(`BGG preview: ${items.length} items, ${r.unique} games. Kept ${r.kept}, enriched ${r.enriched}, added ${r.added}, booth taken from the publisher for ${r.inferred}, skipped ${r.skipped} without any hall or booth.`);
    } catch (e) {
      // Keep the BGG games from the last run rather than failing the whole import
      console.log("BGG import failed, keeping the BGG games already in the seed:", e.message);
    }
  }
  const data = arg("--spiel") ? JSON.parse(fs.readFileSync(arg("--spiel"), "utf8")) : await fetchSpiel();
  const o = mergeOfficial(games, data);
  games = o.games;
  bggAdded = games.filter(g => g.bgg !== undefined && !g.preview && g.spiel === undefined).length;
  write(seed, games, { spiel: games.filter(g => g.spiel !== undefined).length, bgg: bggAdded });
  const tagCount = {};
  games.forEach(g => (g.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  console.log("Tags:", JSON.stringify(tagCount), "| untagged:", games.filter(g => !(g.tags || []).length).length);
  console.log(`SPIEL list: ${o.official} novelties, ${o.matched} matched to games already listed, ${o.added} added; official exhibitor booth for ${o.fixed} BGG games. Total ${games.length}.`);
})().catch(e => { console.error(e); process.exit(1); });
