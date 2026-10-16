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
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { "User-Agent": "my-spiel planner importer (github.com/bar371/my-spiel)", Accept: "application/json" } });
      if (res.ok || attempt >= 3 || ![429, 500, 502, 503, 504].includes(res.status)) break;
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
    }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
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
  const added = [];
  let enriched = 0;
  // The same game can be listed more than once (several publishers or editions): combine them
  const byId = new Map();
  bggGames.forEach(b => {
    const prev = byId.get(String(b.bgg));
    if (!prev) return byId.set(String(b.bgg), { ...b });
    Object.keys(b).forEach(k => { if (prev[k] === undefined) prev[k] = b[k]; });
  });
  const unique = [...byId.values()];
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
      if (touched) enriched++;
      continue;
    }
    let id = slug(b.name) || b.id;
    if (ids.has(id)) id = b.id;
    ids.add(id);
    added.push({ ...b, id });
  }
  added.sort((a, b) => a.name.localeCompare(b.name));
  return { games: [...kept, ...added], added: added.length, enriched, kept: kept.length, unique: unique.length };
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
  const out = head +
`  // ${nPreview} games from SPIEL 2026 preview articles (preview: true, each linking to
  // its source) plus the ${total} titles listed in BoardGameGeek's SPIEL 2026 preview
  // (boardgamegeek.com/geekpreviewv2/${PREVIEW_ID}, imported with tools/import-bgg-preview.js;
  // bgg = BoardGameGeek id). Demo times are not published, so add them in the app
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
  const { games, added, enriched, kept, unique } = merge(seed, bggGames);
  write(seed, games, unique);
  console.log(`BGG preview: ${items.length} items, ${unique} games. Kept ${kept}, enriched ${enriched}, added ${added}. Total ${games.length}.`);
})().catch(e => { console.error(e); process.exit(1); });
