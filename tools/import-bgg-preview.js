#!/usr/bin/env node
/*
 * Imports the BoardGameGeek SPIEL 2026 preview (boardgamegeek.com/geekpreviewv2/93)
 * into data/spiel-data.js, keeping the hand-written preview games.
 *
 *   node tools/import-bgg-preview.js                 # fetch from BGG
 *   node tools/import-bgg-preview.js items.json      # use a saved dump of the API items
 *
 * Preview games (preview: true) are kept as they are; when BGG lists the same
 * game, its booth, hall, price and player count only fill fields that are empty.
 * Games that came from an earlier import (bgg: <id>) are replaced by fresh data.
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

const tagsFrom = ({ bggNames = [], text = "", minP, maxP, minT, maxT, expansion }) => {
  const names = bggNames.map(n => String(n).toLowerCase());
  const t = String(text).toLowerCase();
  const tags = TAG_RULES.filter(([, r]) => names.some(n => r.bgg.test(n)) || r.text.test(t)).map(([tag]) => tag);
  // Fighting monsters together isn't PvP: keep the conflict tag on co-op games only when
  // players also act against each other
  if (tags.includes("Co-op") && tags.includes("PvP / conflict") &&
      !names.some(n => /take that|player elimination|semi-cooperative|traitor|wargame/.test(n)) && !/\bpvp\b|take[- ]that/.test(t))
    tags.splice(tags.indexOf("PvP / conflict"), 1);
  if (num(minP) === 1) tags.push("Solo");
  if (num(maxP) === 2 || (!maxP && /\b(?:two|2)[- ]player|\bfor two\b|\bduel/.test(t))) tags.push("2 players");
  if (num(maxP) >= 6) tags.push("6+ players");
  const tMax = num(maxT) || num(minT);
  if (tMax && tMax <= 30) tags.push("Quick (≤30 min)");
  if (num(minT) >= 120 || num(maxT) >= 150) tags.push("Long (2h+)");
  if (expansion) tags.push("Expansion");
  return tags;
};
const TAG_ORDER = [...TAG_RULES.map(([t]) => t), "Solo", "2 players", "6+ players", "Quick (≤30 min)", "Long (2h+)", "Expansion"];
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
  const kept = seed.games.filter(g => g.bgg === undefined || g.preview); // drop stale imports, keep hand-written ones
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
`  // ${nPreview} games from SPIEL 2026 preview articles (preview: true, each linking to
  // its source) plus ${total} more from BoardGameGeek's SPIEL 2026 preview
  // (boardgamegeek.com/geekpreviewv2/${PREVIEW_ID}, imported with tools/import-bgg-preview.js;
  // bgg = BoardGameGeek id; boothFrom: "publisher" = booth taken from the publisher's other
  // listings; listings with no booth at all are left out). Demo times are not published, so add them in the app
  // (Edit game) or here.
  games: [
${games.map(g => "    " + fmt(g)).join(",\n")}
  ]
};
`;
  fs.writeFileSync(DATA, out);
}

(async () => {
  const raw = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : await fetchItems();
  const items = Array.isArray(raw) ? raw : raw.items || [];
  const bggGames = items.map(toGame).filter(Boolean);
  if (!bggGames.length) throw new Error(`no games parsed from ${items.length} preview items`);
  const seed = loadSeed();
  const { games, added, enriched, kept, unique, skipped, inferred } = merge(seed, bggGames);
  write(seed, games, added);
  console.log("BGG link types:", JSON.stringify(bggStats.linkKeys));
  console.log("Top BGG mechanics/categories:\n" + Object.entries(bggStats.names).sort((a, b) => b[1] - a[1]).slice(0, 150).map(([k, v]) => `  ${v}\t${k}`).join("\n"));
  const tagCount = {};
  games.forEach(g => (g.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  console.log("Tags:", JSON.stringify(tagCount), "| untagged:", games.filter(g => !(g.tags || []).length).length);
  console.log(`BGG preview: ${items.length} items, ${unique} games. Kept ${kept}, enriched ${enriched}, added ${added}, booth taken from the publisher for ${inferred}, skipped ${skipped} without any hall or booth. Total ${games.length}.`);
})().catch(e => { console.error(e); process.exit(1); });
