/* SPIEL '26 planner: a no-build, single-page app.
 *
 * Data model
 *   SEED (data/spiel-data.js)  shared starting data: fair days, members, games
 *   localStorage "spiel26:v1"  this device's DB:
 *     currentMember            who is using this device
 *     customGames[]            games added or edited in the app (override seed by id)
 *     hiddenGames[]            seed game ids removed in the app
 *     plans{memberId}          { sessions[], visits[], favs[gameId], buy{gameId:{price,prio,bought}}, budget, notes{}, updatedAt }
 *                              visits are booth visits planned without a demo session:
 *                              { id, game, day, start, end }
 *     pots[]                   shared budgets: { id, name, members[], budget, updatedAt, deleted? };
 *                              a buy-list item with { pot: id } is paid from that pot
 *     crewCode                 shared crew id for live sync (see data/sync-config.js)
 *
 * Live sync: with a crew code set, every phone mirrors the crew's plans, added
 * games and deleted games through Firebase Realtime Database (REST + event stream).
 * Newest updatedAt wins; each phone only pushes what it changed itself.
 */
(() => {
  "use strict";

  const SEED = window.SPIEL_SEED;
  const STORE_KEY = "spiel26:v1";
  const DAYS = SEED.fair.days;
  const MEMBERS = SEED.members;
  // Renamed member ids (old → new), so plans and share links made under the old id carry over
  const RENAMED = { annemike: "annemieke" };
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

  // ---------- Persistence ----------
  const emptyPlan = () => ({ sessions: [], visits: [], favs: [], buy: {}, budget: 0, notes: {}, updatedAt: 0 });

  function load() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* private mode etc. */ }
    db = db && typeof db === "object" ? db : {};
    db.currentMember = db.currentMember || null;
    db.customGames = Array.isArray(db.customGames) ? db.customGames : [];
    db.hiddenGames = Array.isArray(db.hiddenGames) ? db.hiddenGames : [];
    db.pots = Array.isArray(db.pots) ? db.pots : [];
    db.plans = db.plans || {};
    let migrated = false;
    Object.entries(RENAMED).forEach(([from, to]) => {
      if (!(from in db.plans) && db.currentMember !== from) return;
      if (db.plans[from] && !db.plans[to]) db.plans[to] = db.plans[from];
      delete db.plans[from];
      if (db.currentMember === from) db.currentMember = to;
      migrated = true;
    });
    MEMBERS.forEach(m => { db.plans[m.id] = Object.assign(emptyPlan(), db.plans[m.id]); });
    if (migrated) try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (_) {}
    return db;
  }
  let db = load();
  function save() {
    invalidate();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (_) { toast("Couldn't save on this device (private browsing?)"); }
    schedulePush();
  }
  function touch(memberId) { db.plans[memberId].updatedAt = Date.now(); save(); }

  // ---------- Derived data ----------
  let gamesCache = null, indexCache = null, byIdCache = null;
  function invalidate() { gamesCache = indexCache = byIdCache = null; }
  function games() {
    if (gamesCache) return gamesCache;
    const custom = new Map(db.customGames.map(g => [g.id, g]));
    const list = SEED.games
      .filter(g => !db.hiddenGames.includes(g.id))
      .map(g => custom.get(g.id) || g);
    db.customGames.forEach(g => { if (!SEED.games.some(s => s.id === g.id) && !db.hiddenGames.includes(g.id)) list.push(g); });
    return (gamesCache = list.sort((a, b) => a.name.localeCompare(b.name)));
  }
  const tagsOf = g => Array.isArray(g.tags) ? g.tags : [];
  // Filter chips that follow from the game itself rather than its tags, so a demo time
  // added in the app shows up under "Demo slot" straight away
  const STATUS_TAGS = { "SPIEL list": "✅ SPIEL list", "Preview": "📰 Preview", "Demo slot": "🎲 Demo slot" };
  const filterTagsOf = g => [...(g.spiel !== undefined ? ["SPIEL list"] : []), ...(g.preview ? ["Preview"] : []),
    ...((g.sessions || []).length ? ["Demo slot"] : []), ...tagsOf(g)];
  // Status chips first, then tags in the order the seed lists them (SEED.tags), then any custom ones A–Z
  let tagsCache = null;
  function allTags() {
    if (tagsCache && tagsCache.list === gamesCache) return tagsCache.tags;
    const seen = new Set(); games().forEach(g => filterTagsOf(g).forEach(t => seen.add(t)));
    const order = [...Object.keys(STATUS_TAGS), ...(Array.isArray(SEED.tags) ? SEED.tags : [])];
    const tags = [...order.filter(t => seen.has(t)), ...[...seen].filter(t => !order.includes(t)).sort((a, b) => a.localeCompare(b))];
    tagsCache = { list: gamesCache, tags };
    return tags;
  }
  function sessionIndex() {
    if (indexCache) return indexCache;
    const idx = new Map();
    games().forEach(g => (g.sessions || []).forEach(s => idx.set(s.id, { s, g })));
    return (indexCache = idx);
  }
  const gameById = id => (byIdCache || (byIdCache = new Map(games().map(g => [g.id, g])))).get(id);
  const member = id => MEMBERS.find(m => m.id === id);
  const me = () => member(db.currentMember);
  const myPlan = () => db.plans[db.currentMember];
  const mins = t => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const attending = date => DAYS.some(d => d.date === date);
  const dayLabel = date => {
    const d = DAYS.find(x => x.date === date);
    if (d) return `${d.label} ${Number(date.slice(8))} Oct`;
    const dt = new Date(date + "T12:00:00");
    return isNaN(dt) ? date : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  const overlaps = (a, b) => a.day === b.day && mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);
  const isFav = (memberId, gid) => (db.plans[memberId].favs || []).includes(gid);
  const whoFavs = gid => MEMBERS.filter(m => isFav(m.id, gid));
  const favButton = (g, big) => { const on = isFav(db.currentMember, g.id);
    return `<button class="fav-btn ${on ? "on" : ""} ${big ? "big" : ""}" data-action="fav" data-game="${esc(g.id)}" aria-pressed="${on}" aria-label="${on ? "Remove from favorites" : "Add to favorites"}" title="Favorite">${on ? "★" : "☆"}${big ? ` ${on ? "Favorite" : "Add to favorites"}` : ""}</button>`; };
  const whoJoins = sid => MEMBERS.filter(m => db.plans[m.id].sessions.includes(sid));
  const whoJoinsGame = g => MEMBERS.filter(m => planItems(m.id).some(x => x.g.id === g.id));

  // Everything on a member's schedule: joined demo sessions (fixed times) and booth
  // visits (movable). Each item: { kind, id, day, start, end, location, g, s?, v? }
  function planItems(memberId, day) {
    const idx = sessionIndex(), plan = db.plans[memberId];
    const items = [];
    plan.sessions.forEach(id => { const x = idx.get(id); if (x) items.push({ kind: "session", id, day: x.s.day, start: x.s.start, end: x.s.end, location: x.s.location, g: x.g, s: x.s }); });
    (plan.visits || []).forEach(v => { const g = gameById(v.game); if (g) items.push({ kind: "visit", id: v.id, day: v.day, start: v.start, end: v.end, g, v }); });
    return (day ? items.filter(x => x.day === day) : items).sort((a, b) => mins(a.start) - mins(b.start) || mins(a.end) - mins(b.end));
  }

  // Everything anyone in the crew plans on a day; people visiting the same booth at
  // the same time are grouped together
  function crewItems(day) {
    const groups = new Map();
    MEMBERS.forEach(m => planItems(m.id, day).forEach(x => {
      const key = x.kind === "session" ? `s:${x.id}` : `v:${x.g.id}|${x.start}|${x.end}`;
      if (!groups.has(key)) groups.set(key, { ...x, who: [] });
      groups.get(key).who.push(m);
    }));
    return [...groups.values()].sort((a, b) => mins(a.start) - mins(b.start) || a.g.name.localeCompare(b.g.name));
  }

  function conflictsFor(memberId, slot) {
    return planItems(memberId, slot.day).filter(x => x.id !== slot.id && overlaps(x, slot));
  }

  // Earliest start (15-minute steps) on a day where `length` minutes are free for this member
  function nextFreeStart(memberId, day, length, from) {
    const d = DAYS.find(x => x.date === day) || DAYS[0];
    const open = mins(d.open), close = mins(d.close);
    let t = Math.max(open, from ?? open);
    t = Math.ceil(t / 15) * 15;
    const busy = planItems(memberId, day);
    for (; t + length <= close; t += 15) {
      const slot = { day, start: fmt(t), end: fmt(t + length) };
      if (!busy.some(x => overlaps(x, slot))) return t;
    }
    return null;
  }
  // A sensible visit length from the game's play time ("30–45 min" → 45), 15–120 minutes
  const visitLength = g => {
    const n = String(g.duration || "").match(/\d+/g);
    const m = n ? Number(n[n.length - 1]) : 45;
    return Math.min(120, Math.max(15, Math.round(m / 15) * 15));
  };

  // ---------- Helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = sel => document.querySelector(sel);
  const meeple = (color, size = "") => `<svg ${size} fill="${esc(color)}" aria-hidden="true"><use href="#meeple"/></svg>`;
  const meeples = list => list.length
    ? `<span class="meeples" title="${esc(list.map(m => m.name).join(", "))}">${list.map(m => meeple(m.color)).join("")}</span>` : "";
  const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "game";
  const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  const initials = name => name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
  const dur = m => (m >= 60 ? `${Math.floor(m / 60)}h ` : "") + (m % 60 ? `${m % 60}m` : "").trim();

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- UI state ----------
  const today = new Date().toISOString().slice(0, 10);
  const PAGE = 40;
  const ui = {
    tab: "schedule",
    day: DAYS.some(d => d.date === today) ? today : DAYS[0].date,
    query: "",
    filter: "all",
    tags: [],
    sort: "name",
    hall: "",
    who: "",       // whose schedule the Schedule tab shows ("" = mine)
    limit: PAGE,
    sheetGame: null
  };
  try { Object.assign(ui, JSON.parse(sessionStorage.getItem("spiel26:ui") || "{}"), { sheetGame: null }); } catch (_) {}
  if (!DAYS.some(d => d.date === ui.day)) ui.day = DAYS[0].date;
  if (!Array.isArray(ui.tags)) ui.tags = [];
  if (!["name", "price-asc", "price-desc", "rating"].includes(ui.sort)) ui.sort = "name";
  if (typeof ui.hall !== "string") ui.hall = "";
  const keepUi = () => { try { sessionStorage.setItem("spiel26:ui", JSON.stringify({ tab: ui.tab, day: ui.day, filter: ui.filter, tags: ui.tags, sort: ui.sort, hall: ui.hall })); } catch (_) {} };

  // ---------- Header ----------
  function renderHeader() {
    const m = me();
    $("#who").innerHTML = m ? `${meeple(m.color)}<span>${esc(m.name)}</span>` : "Pick player";
    const start = new Date(DAYS[0].date + "T10:00:00");
    const last = DAYS[DAYS.length - 1];
    const end = new Date(`${last.date}T${last.close}:00`);
    const now = new Date();
    let txt;
    if (now < start) {
      const d = Math.ceil((start - now) / 864e5);
      txt = `${d} day${d === 1 ? "" : "s"} to go · ${SEED.fair.venue.split(",")[0]}`;
    } else if (now <= end) {
      const n = DAYS.findIndex(d => d.date === today) + 1;
      txt = n > 0 ? `Day ${n} of ${DAYS.length} · have fun!` : "SPIEL is on!";
    } else txt = "See you next year!";
    const st = { live: "● live", connecting: "○ syncing…", offline: "○ offline", error: "⚠ sync problem" }[sync.state];
    $("#countdown").innerHTML = esc(txt) + (st ? ` · <span class="sync ${sync.state}">${st}</span>` : "");
  }

  function renderDays() {
    const nav = $("#days");
    nav.hidden = ui.tab !== "schedule" && ui.tab !== "crew";
    if (nav.hidden || !me()) return;
    const crew = ui.tab === "crew";
    nav.style.setProperty("--day-count", DAYS.length);
    nav.innerHTML = DAYS.map(d => {
      const n = crew ? crewItems(d.date).length : planItems(viewedMember(), d.date).length;
      return `<button class="day ${ui.day === d.date ? "active" : ""}" data-day="${d.date}">
        <b>${d.label}</b><small>${Number(d.date.slice(8))} Oct</small><br><span class="count">${n}</span></button>`;
    }).join("");
  }

  // ---------- Views ----------
  // ---------- My day: a time grid. Visits can be dragged; demo sessions are fixed ----------
  const PX = 1.6; // pixels per minute
  // Whose schedule the Schedule tab shows: mine, or a crew member's (read-only)
  const viewedMember = () => (ui.who && ui.who !== db.currentMember && member(ui.who)) ? ui.who : db.currentMember;
  function viewSchedule() {
    const day = DAYS.find(d => d.date === ui.day) || DAYS[0];
    const who = viewedMember(), mine = who === db.currentMember, other = member(who);
    const items = planItems(who, day.date);
    const myItems = mine ? [] : planItems(db.currentMember, day.date);
    const whoRow = `<div class="who-row" role="group" aria-label="Whose schedule">${[me(), ...MEMBERS.filter(m => m.id !== db.currentMember)].map(m => { const on = m.id === who;
      return `<button class="who-chip ${on ? "active" : ""}" data-action="view-who" data-who="${m.id}" aria-pressed="${on}">${meeple(m.color)}<span>${m.id === db.currentMember ? "Me" : esc(m.name)}</span></button>`; }).join("")}</div>`;
    let html = whoRow + `<h2 class="section-title">${mine ? "" : `${esc(other.name)}'s `}${esc(dayLabel(day.date))} <span class="pill">${day.open}–${day.close}</span></h2>`;
    if (!items.length) {
      return html + (mine ? `<div class="empty"><span class="big">🧩</span><b>Nothing planned yet</b>
        <p>Open a game and join a demo session, or plan a visit to its booth.</p>
        <button class="btn" data-action="tab" data-tab="games">Browse games</button></div>`
        : `<div class="empty"><span class="big">🧩</span><b>${esc(other.name)} has nothing planned on this day</b>
        <p>Pick another day, or another crew member above.</p></div>`);
    }
    const open = mins(day.open), close = Math.max(mins(day.close), ...items.map(x => mins(x.end)));
    const first = Math.min(open, ...items.map(x => mins(x.start)));
    const hours = [];
    for (let h = Math.ceil(first / 60) * 60; h <= close; h += 60)
      hours.push(`<div class="hour" style="top:${(h - first) * PX}px"><span>${fmt(h)}</span></div>`);

    // Side-by-side columns for items that overlap
    const lanes = [], placed = [];
    items.forEach(x => {
      let lane = lanes.findIndex(end => end <= mins(x.start));
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = mins(x.end);
      placed.push({ x, lane });
    });
    placed.forEach(p => {
      const group = placed.filter(q => overlaps(q.x, p.x));
      p.cols = Math.max(...group.map(q => q.lane)) + 1;
    });

    const blocks = placed.map(({ x, lane, cols }) => {
      const clash = conflictsFor(who, x);
      const top = (mins(x.start) - first) * PX, h = Math.max(26, (mins(x.end) - mins(x.start)) * PX - 3);
      const visit = x.kind === "visit", movable = visit && mine;
      // On a crew member's day, show where I'm there too (same session, or same game at an overlapping time)
      const withMe = !mine && myItems.some(y => y.id === x.id || (y.g.id === x.g.id && overlaps(y, x)));
      return `<article class="pblock ${visit ? "pblock-visit" : "pblock-session"} ${clash.length ? "conflict" : ""} ${h < 46 ? "short" : ""} ${mine ? "" : "readonly"} ${withMe ? "with-me" : ""}"
          data-item="${esc(x.id)}" style="top:${top}px;height:${h}px;left:calc(${lane} * (100% / ${cols}));width:calc(100% / ${cols} - 4px)${mine ? "" : `;border-left-color:${esc(other.color)}`}">
        ${!mine ? `<span class="lock">${withMe ? `<span title="You're there too">🙋</span>` : ""}</span>` : visit ? `<span class="grip" data-drag="move" title="Drag to move" aria-label="Move ${esc(x.g.name)}">⠿</span>` : `<span class="lock" title="Demo session: fixed time">🔒</span>`}
        <div class="block-body tap" data-action="open" data-game="${esc(x.g.id)}">
          <b class="block-name">${esc(x.g.name)}</b>
          <span class="block-time">${esc(x.start)}–${esc(x.end)}${visit ? " · booth visit" : " · demo"}</span>
          <span class="block-where">${[hallText(x.g), x.location].filter(Boolean).map(esc).join(" · ")}</span>
          ${clash.length ? `<span class="block-warn">⚠ clashes with ${esc(clash.map(c => c.g.name).join(", "))}</span>` : ""}
        </div>
        ${movable ? `<span class="resize" data-drag="resize" title="Drag to change length" aria-label="Change length"></span>` : ""}
      </article>`;
    }).join("");

    const fixable = mine && items.some(x => x.kind === "visit" && conflictsFor(db.currentMember, x).length);
    return html + `<div class="board"><div class="dayplan" data-first="${first}" data-close="${close}" style="height:${(close - first) * PX}px">
        ${hours.join("")}<div class="blocks">${blocks}</div></div></div>
      <p class="hint">${mine ? "⠿ Drag a booth visit to move it, or its bottom edge to change its length. 🔒 Demo sessions keep their times."
        : `Viewing ${esc(other.name)}'s plan. 🙋 marks where you're there too. Tap a game to join it.`}</p>
      ${fixable ? `<button class="btn block" data-action="fix-clashes">🪄 Fix clashes: move visits to free time</button>` : ""}`;
  }
  const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // "Hall 6 · F300" rather than "Hall 6 · 6-F300"
  // and flag booths only known from the publisher's other games
  const hallText = g => [g.hall && `Hall ${g.hall}`, g.hall && g.booth && g.booth.startsWith(`${g.hall}-`) ? g.booth.slice(String(g.hall).length + 1) : g.booth].filter(Boolean).join(" · ")
    + (g.boothFrom === "publisher" && (g.hall || g.booth) ? " (publisher's stand)" : "");
  const hallPill = g => (g.hall || g.booth) ? `<span class="pill">🏛 ${esc(hallText(g))}</span>` : "";

  function viewGames() {
    const plan = myPlan();
    const q = ui.query.trim().toLowerCase();
    let list = games().filter(g => !q || [g.name, g.publisher, g.description, ...tagsOf(g)].join(" ").toLowerCase().includes(q));
    if (ui.filter === "joining") { const planned = new Set(planItems(db.currentMember).map(x => x.g.id)); list = list.filter(g => planned.has(g.id)); }
    if (ui.filter === "buy") list = list.filter(g => plan.buy[g.id]);
    if (ui.filter === "favs") list = list.filter(g => isFav(db.currentMember, g.id));
    // Tags narrow the list: a game must have every selected tag
    list = list.filter(g => ui.tags.every(t => filterTagsOf(g).includes(t)));
    // Hall: count what each hall would show with the other filters, then narrow
    const hallCounts = new Map();
    list.forEach(g => hallsOf(g).forEach(h => hallCounts.set(h, (hallCounts.get(h) || 0) + 1)));
    if (ui.hall) list = list.filter(g => hallsOf(g).includes(ui.hall));
    const tagCounts = new Map();
    list.forEach(g => filterTagsOf(g).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    const tagChips = [...ui.tags, ...allTags().filter(t => tagCounts.has(t) && !ui.tags.includes(t))]
      .map(t => { const on = ui.tags.includes(t);
        return `<button class="btn small tag-chip ${on ? "" : "secondary"}" data-action="tag" data-tag="${esc(t)}" aria-pressed="${on}">${esc(STATUS_TAGS[t] || t)}${on ? "" : ` <span class="count">${tagCounts.get(t) || 0}</span>`}</button>`; })
      .join("");
    // Sort by fair price (or the low end of the official price range); games without a price go last
    if (ui.sort === "rating") {
      // Best-rated on BGG first; games without a rating (too few votes) last
      list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.votes || 0) - (a.votes || 0) || a.name.localeCompare(b.name));
    } else if (ui.sort !== "name") {
      const dir = ui.sort === "price-asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const pa = priceOf(a), pb = priceOf(b);
        if (pa == null || pb == null) return (pa == null) - (pb == null);
        return dir * (pa - pb) || a.name.localeCompare(b.name);
      });
    }
    const anySample = games().some(g => g.sample);
    const nPreview = games().filter(g => g.preview).length;

    const chips = [["all", "All"], ["joining", "Planned"], ["favs", "★ Favorites"], ["buy", "Buy list"]]
      .map(([k, l]) => `<button class="btn small ${ui.filter === k ? "" : "secondary"}" data-action="filter" data-filter="${k}">${l}</button>`).join("");

    return `<h2 class="section-title">🎲 Games at SPIEL</h2>
      <div class="toolbar"><input class="search" id="search" type="search" placeholder="Search games, publishers…" value="${esc(ui.query)}" autocomplete="off">
      <button class="btn" data-action="new">＋ Add</button></div>
      <div class="row" style="margin-bottom:8px">${chips}</div>
      ${tagChips ? `<div class="tag-row" role="group" aria-label="Filter by game type">${ui.tags.length ? `<button class="btn small tag-chip clear" data-action="tags-clear">✕ Clear</button>` : `<span class="tag-label">🏷 Type</span>`}${tagChips}</div>` : ""}
      ${anySample ? `<div class="banner">🧪 Cards marked <b>sample</b> have placeholder booths and times. Edit them or clear them under <b>More</b>.</div>` : ""}
      ${nPreview && !ui.query && !ui.tags.length ? `<div class="banner">📰 ${games().length} SPIEL 2026 games: SPIEL's official novelty list (✅), BoardGameGeek's SPIEL preview, and ${nPreview} hyped picks from preview articles (marked <b>preview</b>). Only games in English are listed (no accessories); other-language editions show up when you search for them. Demo times aren't published, so add them with <b>Edit game</b> once you know them.</div>` : ""}
      <div class="list-head"><p class="muted small">${list.length} game${list.length === 1 ? "" : "s"}</p>
        <label class="sort">Hall <select id="hall" aria-label="Filter by hall">
          <option value="">All halls</option>
          ${[...new Set([...hallCounts.keys(), ...(ui.hall ? [ui.hall] : [])])].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b))
            .map(h => `<option value="${esc(h)}" ${ui.hall === h ? "selected" : ""}>${/^\d+$/.test(h) ? `Hall ${esc(h)}` : esc(h)} (${hallCounts.get(h) || 0})</option>`).join("")}
        </select></label>
        <label class="sort">Sort <select id="sort" aria-label="Sort games">
          ${[["name", "Name A–Z"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"], ["rating", "BGG rating: best first"]]
            .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></label></div>
      ${list.length ? list.slice(0, ui.limit).map(gameCard).join("") : q && ui.filter === "all" && !ui.tags.length && !ui.hall ? "" : `<div class="empty"><span class="big">🔍</span><b>No games here</b><p>Try another filter or add a game.</p></div>`}
      ${list.length > ui.limit ? `<button class="btn secondary block" style="margin-top:12px" data-action="more">Show more (${list.length - ui.limit} left)</button>` : ""}
      ${q ? searchExtras(ui.query.trim(), list.length) : ""}`;
  }

  // ---------- Search beyond the game list ----------
  // Three answers to "is X at SPIEL?": it's in the list above; we know it but it isn't
  // expected at the fair (SEED.notAtFair, with the reason); or none of our sources know it.
  // Exhibitors matching the search are listed too, so a publisher name tells you whether they have a stand.
  const LANG_NAMES = { en: "English", de: "German", nl: "Dutch", fr: "French", es: "Spanish", it: "Italian", pl: "Polish", cs: "Czech",
    ja: "Japanese", ko: "Korean", zh: "Chinese", sv: "Swedish", fi: "Finnish", no: "Norwegian", da: "Danish", el: "Greek", pt: "Portuguese", any: "Language-independent" };
  const langNames = langs => (langs || []).map(l => LANG_NAMES[l] || l).join(", ");
  const fold = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const BGG_NO_BOOTH = "In BoardGameGeek's SPIEL preview, but neither the game nor its publisher has a stand on SPIEL's official exhibitor list.";
  function searchExtras(query, found) {
    const q = fold(query);
    if (q.length < 2) return "";
    const away = (SEED.notAtFair || []).filter(x => fold(`${x.name} ${x.publisher || ""}`).includes(q)).slice(0, 12);
    const foreign = (SEED.otherLanguage || []).filter(x => fold(`${x.name} ${x.publisher || ""}`).includes(q));
    const exhibitors = (SEED.exhibitors || []).filter(x => fold(x.name).includes(q)).slice(0, 8);
    const filtered = ui.filter !== "all" || ui.tags.length || ui.hall;
    let html = "";
    if (away.length) html += `<h2 class="section-title">🚫 Known, but not expected at SPIEL</h2>` + away.map(x => {
      const url = safeUrl(x.url);
      return `<div class="card not-at-fair"><h3 class="game-name">${esc(x.name)}</h3>
        ${x.publisher ? `<p class="muted small" style="margin:2px 0 0">${esc(x.publisher)}</p>` : ""}
        <p class="small">${esc(x.why || (x.src === "bgg" ? BGG_NO_BOOTH : ""))}</p>
        <div class="row">${url ? `<a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener">🔗 More info</a>` : ""}
          <button class="btn secondary small" data-action="new" data-name="${esc(x.name)}">＋ Add anyway</button></div></div>`;
    }).join("");
    if (foreign.length) html += `<h2 class="section-title">🌍 Only in other languages</h2><div class="card exhibitors foreign">` +
      foreign.slice(0, 12).map(x => `<div class="exhibitor"><b>${esc(x.name)}</b><span class="pill">${esc(langNames(x.langs))} only</span>
        ${x.hall || x.booth ? `<span class="pill">🏛 ${esc(hallText(x))}</span>` : ""}${x.publisher ? `<span class="small muted">${esc(x.publisher)}</span>` : ""}</div>`).join("") +
      (foreign.length > 12 ? `<p class="small muted">…and ${foreign.length - 12} more. Search more precisely to see them.</p>` : "") + `</div>`;
    if (!found && !away.length && !foreign.length && !filtered) html += `<div class="card unknown-game"><h3 class="game-name">🤷 We don't know “${esc(query)}”</h3>
      <p class="small">It isn't on SPIEL's official novelty list, in BoardGameGeek's SPIEL preview or among our preview picks,
      so there's no sign it will be shown at SPIEL. The novelty list only has new games, though: older games are often still for sale at a stand.</p>
      <button class="btn small" data-action="new" data-name="${esc(query)}">＋ Add “${esc(query)}” yourself</button></div>`;
    if (exhibitors.length) html += `<h2 class="section-title">🏢 Exhibitors</h2><div class="card exhibitors">` + exhibitors.map(x =>
      `<div class="exhibitor"><b>${esc(x.name)}</b><span class="pill">🏛 ${esc([x.hall && `Hall ${x.hall}`, x.booth && x.hall && x.booth.startsWith(x.hall + "-") ? x.booth.slice(x.hall.length + 1) : x.booth].filter(Boolean).join(" · "))}</span>${(x.more || []).length ? `<span class="small muted">also ${esc(x.more.join(", "))}</span>` : ""}</div>`).join("") + `</div>`;
    else if (!found && !away.length && !foreign.length && !filtered) html += `<p class="hint">No exhibitor matches “${esc(query)}” either.</p>`;
    return html;
  }

  // Every hall a game can be found in: its main booth plus any extra booths ("6-B200", "GA73" = Galeria)
  const hallsOf = g => [...new Set([g.hall, ...(g.otherBooths || []).map(b => /^GA/i.test(b) ? "Galeria" : String(b).split("-")[0])]
    .filter(Boolean).map(String))];

  const priceOf = g => {
    const p = Number(g.price);
    if (g.price != null && g.price !== "" && Number.isFinite(p) && p > 0) return p;
    const m = String(g.priceBand || "").match(/\d+(?:[.,]\d+)?/);
    return m ? Number(m[0].replace(",", ".")) : null;
  };

  function gameCard(g) {
    const plan = myPlan();
    const joining = planItems(db.currentMember).filter(x => x.g.id === g.id).length;
    const h = hue(g.name);
    return `<article class="card tap game-card" data-action="open" data-game="${esc(g.id)}">
      <div class="tile-col"><div class="game-tile" style="background:hsl(${h} 55% 45%)">${esc(initials(g.name))}</div>${favButton(g)}</div>
      <div>
        ${meeples(whoJoinsGame(g))}
        <h3 class="game-name" style="padding-right:${whoJoinsGame(g).length * 16 + 4}px">${esc(g.name)}</h3>
        ${g.publisher ? `<p class="muted small" style="margin:2px 0 0">${esc(g.publisher)}</p>` : ""}
        <p class="desc-short">${esc(g.description || "")}</p>
        ${tagsOf(g).length ? `<div class="tags">${tagsOf(g).slice(0, 4).map(t => `<span class="pill tag${ui.tags.includes(t) ? " on" : ""}">${esc(t)}</span>`).join("")}${tagsOf(g).length > 4 ? `<span class="pill tag">+${tagsOf(g).length - 4}</span>` : ""}</div>` : ""}
        <div class="meta">
          ${g.sample ? `<span class="pill sample">sample</span>` : ""}
          ${g.preview ? `<span class="pill preview">preview</span>` : ""}
          ${hallPill(g)}
          ${g.rating ? `<span class="pill rating" title="BoardGameGeek user rating, ${g.votes} votes">⭐ ${g.rating.toFixed(1)}</span>` : ""}
          <span class="pill">🕒 ${(g.sessions || []).length} session${(g.sessions || []).length === 1 ? "" : "s"}</span>
          ${g.price ? `<span class="pill">${eur.format(g.price)}</span>` : g.priceBand ? `<span class="pill">${esc(g.priceBand)}</span>` : ""}
          ${joining ? `<span class="pill ok">✓ Planned</span>` : ""}
          ${whoFavs(g.id).filter(m => m.id !== db.currentMember).length ? `<span class="pill fav">★ ${esc(whoFavs(g.id).filter(m => m.id !== db.currentMember).map(m => m.name).join(", "))}</span>` : ""}
          ${plan.buy[g.id] ? `<span class="pill gold">🛒 ${plan.buy[g.id].bought ? "Bought" : "Buy list"}</span>` : ""}
        </div>
      </div></article>`;
  }

  function viewCrew() {
    const day = DAYS.find(d => d.date === ui.day) || DAYS[0];
    const cards = MEMBERS.map(m => {
      const p = db.plans[m.id];
      const n = planItems(m.id).length;
      const spend = Object.values(p.buy).reduce((t, b) => t + (Number(b.price) || 0), 0);
      const when = p.updatedAt ? new Date(p.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "no plan yet";
      return `<div class="card crew-member">${meeple(m.color)}
        <div><h4>${esc(m.name)}${m.id === db.currentMember ? " <span class='pill gold'>you</span>" : ""}</h4>
        <p>${n} plan${n === 1 ? "" : "s"} · ★ ${(p.favs || []).filter(id => gameById(id)).length} · ${eur.format(spend)} on the buy list · ${esc(when)}</p></div>
        ${m.id === db.currentMember && !crewBase() ? `<button class="btn small" data-action="share">Share</button>` : ""}</div>`;
    }).join("");

    // Every session or booth visit anyone in the crew planned on the selected day
    const going = crewItems(day.date);
    // Games anyone starred, most-liked first
    const crewFavs = [...new Set(MEMBERS.flatMap(m => db.plans[m.id].favs || []))]
      .map(id => ({ g: gameById(id), who: whoFavs(id) })).filter(x => x.g)
      .sort((a, b) => b.who.length - a.who.length || a.g.name.localeCompare(b.g.name));

    const banner = crewBase()
      ? `<div class="banner live">${sync.state === "live" ? "🟢 <b>Live.</b> Everyone's picks update here automatically." : "○ Connecting to the crew… changes are saved and will sync."}</div>`
      : `<div class="banner">Plans aren't syncing yet. ${SYNC_URL ? "Turn on <b>live crew sync</b> under <b>More</b> so everyone sees each other's picks automatically." : "Until live sync is set up, tap <b>Share</b> to send your plan as a link."}</div>`;

    return `<h2 class="section-title">🗺️ Who's going where · ${esc(dayLabel(day.date))}</h2>
      ${banner}
      ${going.length ? going.map(({ kind, start, end, location, g, who }) => `<article class="card tap going ${who.length > 1 ? "together" : ""}" data-action="open" data-game="${esc(g.id)}">
          <div class="going-time"><b>${esc(start)}</b><small>${esc(end)}</small></div>
          <div><h3 class="game-name">${esc(g.name)}</h3>
            <div class="meta">${meeples(who)}<span class="small">${esc(who.map(m => m.name).join(", "))}</span></div>
            <div class="meta">${kind === "visit" ? `<span class="pill">🙋 booth visit</span>` : `<span class="pill">🎲 demo</span>`}${hallPill(g)}${location ? `<span class="pill">📍 ${esc(location)}</span>` : ""}
              ${who.length > 1 ? `<span class="pill ok">🤝 together</span>` : ""}
              ${who.some(m => m.id === db.currentMember) ? `<span class="pill gold">you're in</span>` : ""}</div></div>
        </article>`).join("")
        : `<div class="empty"><span class="big">🗺️</span><b>Nobody has planned anything on ${esc(day.label)} yet</b><p>Demo sessions and booth visits anyone in the crew plans show up here with their meeples.</p></div>`}
      ${crewFavs.length ? `<h2 class="section-title">⭐ Crew favorites</h2>
      ${crewFavs.map(({ g, who }) => `<article class="card tap going ${who.length > 1 ? "together" : ""}" data-action="open" data-game="${esc(g.id)}">
          <div class="going-time"><b>★ ${who.length}</b></div>
          <div><h3 class="game-name">${esc(g.name)}</h3>
            <div class="meta">${meeples(who)}<span class="small">${esc(who.map(m => m.name).join(", "))}</span></div>
            <div class="meta">${hallPill(g)}${planItems(db.currentMember).some(x => x.g.id === g.id) ? `<span class="pill ok">✓ planned</span>` : ""}</div></div>
        </article>`).join("")}` : ""}
      <h2 class="section-title">👥 The crew</h2>
      <div class="crew-grid">${cards}</div>`;
  }

  // ---------- Budgets: personal, and shared pots (e.g. Bar & Naomi) ----------
  const pots = () => db.pots.filter(p => !p.deleted);
  const potsOf = memberId => pots().filter(p => p.members.includes(memberId));
  // The pot an item is paid from, if it still exists and its owner is in it
  const potFor = (b, memberId) => b && b.pot ? potsOf(memberId).find(p => p.id === b.pot) : null;
  const byPrio = (a, b) => (a.b.bought - b.b.bought) || ((a.b.prio === "must" ? 0 : 1) - (b.b.prio === "must" ? 0 : 1)) || a.g.name.localeCompare(b.g.name);
  const personalItems = memberId => Object.entries(db.plans[memberId].buy).filter(([, b]) => !potFor(b, memberId))
    .map(([id, b]) => ({ id, b, g: gameById(id), m: member(memberId) })).filter(x => x.g).sort(byPrio);
  const potItems = pot => pot.members.filter(member).flatMap(mid => Object.entries(db.plans[mid].buy).filter(([, b]) => b.pot === pot.id)
    .map(([id, b]) => ({ id, b, g: gameById(id), m: member(mid) }))).filter(x => x.g).sort(byPrio);
  const potLabel = p => p.name || p.members.map(id => (member(id) || {}).name).filter(Boolean).join(" & ");

  function budgetCard(budget, items, input) {
    const sum = f => items.filter(f).reduce((t, x) => t + (+x.b.price || 0), 0);
    const bought = sum(x => x.b.bought), must = sum(x => !x.b.bought && x.b.prio === "must"), maybe = sum(x => !x.b.bought && x.b.prio !== "must");
    const left = budget - bought, scale = Math.max(budget, bought + must, 1);
    return `<div class="card budget-head">
        <label class="muted small">Budget for the fair&nbsp;${input}</label>
        <div class="coins ${left < 0 ? "over" : ""}">${eur.format(left)}</div>
        <div class="muted small">${left < 0 ? "over budget" : "left to spend"}</div>
        <div class="bar"><span class="bought" style="width:${bought / scale * 100}%"></span><span class="planned" style="width:${must / scale * 100}%"></span></div>
        <div class="legend"><span><i style="background:var(--ok)"></i>Bought ${eur.format(bought)}</span>
          <span><i style="background:var(--accent)"></i>Must-have ${eur.format(must)}</span>
          <span><i style="background:var(--paper-2)"></i>Maybe ${eur.format(maybe)}</span></div>
        ${budget && bought + must > budget ? `<p class="pill warn" style="margin-top:10px">⚠ Must-haves go ${eur.format(bought + must - budget)} over budget</p>` : ""}
      </div>`;
  }

  // Your own items can be ticked off, re-prioritised and moved between budgets; others' items in a shared budget are shown read-only
  function buyRow({ id, b, g, m }, showWho) {
    const mine = m.id === db.currentMember;
    const mp = potsOf(db.currentMember);
    return `<div class="card buy-row ${b.bought ? "done" : ""}">
        ${mine ? `<button class="check ${b.bought ? "on" : ""}" data-action="bought" data-game="${esc(id)}" aria-label="Mark bought">${b.bought ? "✓" : ""}</button>`
          : `<span class="check readonly ${b.bought ? "on" : ""}" title="${esc(m.name)}'s item">${b.bought ? "✓" : ""}</span>`}
        <div class="tap" data-action="open" data-game="${esc(id)}"><h3 class="game-name">${esc(g.name)}</h3>
          <div class="meta">${showWho ? `${meeple(m.color, 'style="width:16px;height:16px"')}<span class="small">${esc(m.name)}</span>` : ""}${hallPill(g)}</div></div>
        <div style="text-align:right"><div class="price">${eur.format(+b.price || 0)}</div>
          ${mine ? `<button class="prio ${b.prio === "must" ? "must" : "maybe"}" data-action="prio" data-game="${esc(id)}">${b.prio === "must" ? "must-have" : "maybe"}</button>`
            : `<span class="prio ${b.prio === "must" ? "must" : "maybe"}">${b.prio === "must" ? "must-have" : "maybe"}</span>`}
          ${mine && mp.length ? `<select class="pot-select" data-pot-for="${esc(id)}" aria-label="Pay from">
            <option value="">Personal</option>${mp.map(p => `<option value="${esc(p.id)}" ${b.pot === p.id ? "selected" : ""}>${esc(potLabel(p))}</option>`).join("")}</select>` : ""}</div>
      </div>`;
  }

  function viewBudget() {
    const plan = myPlan();
    const items = personalItems(db.currentMember);
    const budget = +plan.budget || 0;
    const mine = potsOf(db.currentMember);
    const shared = mine.map(p => {
      const its = potItems(p);
      return `<h2 class="section-title">🤝 ${esc(potLabel(p))} <span class="pill">${meeples(p.members.map(member).filter(Boolean))}</span>
          <button class="btn small secondary" data-action="pot-edit" data-pot="${esc(p.id)}" style="margin-left:auto">Edit</button></h2>
        ${budgetCard(+p.budget || 0, its, `<input class="inline pot-budget" data-pot="${esc(p.id)}" type="number" inputmode="decimal" min="0" step="5" value="${+p.budget || ""}" placeholder="€ 0">`)}
        ${its.length ? its.map(x => buyRow(x, true)).join("") : `<p class="hint">Nothing in this budget yet. On your shopping list, set <b>Pay from</b> to “${esc(potLabel(p))}”.</p>`}`;
    }).join("");

    return `<h2 class="section-title">💰 ${esc(me().name)}'s budget</h2>
      ${budgetCard(budget, items, `<input class="inline" id="budget" type="number" inputmode="decimal" min="0" step="5" value="${budget || ""}" placeholder="€ 0">`)}
      <h2 class="section-title">🛒 Shopping list</h2>
      ${items.length ? items.map(x => buyRow(x, false)).join("")
        : Object.keys(plan.buy).length ? `<p class="hint">Everything on your list is paid from a shared budget.</p>`
        : `<div class="empty"><span class="big">🛍️</span><b>Your buy list is empty</b><p>Open a game and tap “Add to buy list”.</p>
          <button class="btn" data-action="tab" data-tab="games">Browse games</button></div>`}
      ${shared}
      <button class="btn secondary block" style="margin-top:16px" data-action="pot-new">🤝 New shared budget</button>`;
  }

  function potSheet(id) {
    const p = id ? pots().find(x => x.id === id) : { name: "", members: [db.currentMember], budget: "" };
    if (!p) return closeSheet();
    openSheet(`<h2 id="sheet-title">${id ? "Edit shared budget" : "New shared budget"}</h2>
      <p class="muted small">Items anyone in it puts on their buy list with <b>Pay from</b> set to this budget count towards it.</p>
      <form id="pot-form" data-id="${esc(id || "")}">
        <label class="field">Who's in it</label>
        <div class="players pot-members">${MEMBERS.map(m => `<label class="player ${p.members.includes(m.id) ? "active" : ""}">
          <input type="checkbox" name="members" value="${m.id}" ${p.members.includes(m.id) ? "checked" : ""} ${m.id === db.currentMember ? "disabled" : ""}>
          ${meeple(m.color)}${esc(m.name)}</label>`).join("")}</div>
        <label class="field">Name <input name="name" value="${esc(p.name || "")}" placeholder="e.g. Bar & Naomi"></label>
        <label class="field">Budget (€)<input name="budget" type="number" inputmode="decimal" min="0" step="5" value="${esc(p.budget || "")}"></label>
        <div class="row spread" style="margin-top:14px"><button class="btn" type="submit">${id ? "Save" : "Create"}</button>
          ${id ? `<button type="button" class="btn danger small" data-action="pot-delete" data-pot="${esc(id)}">Delete</button>` : ""}</div>
      </form>`);
  }

  function savePot(form) {
    const f = new FormData(form);
    const members = [db.currentMember, ...f.getAll("members").filter(m => m !== db.currentMember && member(m))];
    if (members.length < 2) { toast("Pick at least one person to share with"); return; }
    const id = form.dataset.id || uid("pot");
    const old = db.pots.find(x => x.id === id) || {};
    const pot = { ...old, id, members, name: String(f.get("name") || "").trim(), budget: Math.max(0, Number(f.get("budget")) || 0), updatedAt: Date.now() };
    db.pots = db.pots.filter(x => x.id !== id).concat(pot);
    save(); closeSheet(); render(); toast(form.dataset.id ? "Shared budget saved" : `Shared budget “${potLabel(pot)}” created`);
  }

  function viewSettings() {
    return `<h2 class="section-title">⚙️ More</h2>
      <div class="card"><h3 class="game-name">Player</h3>
        <p class="muted small">This device is set to <b>${esc(me().name)}</b>.</p>
        <button class="btn secondary" data-action="who">Switch player</button></div>
      ${syncCard()}
      <div class="card"><h3 class="game-name">Share &amp; back up</h3>
        <p class="muted small">Send your plan to the crew as a link, or save a backup file with everything on this device (all four plans and added games).</p>
        <div class="row"><button class="btn" data-action="share">Share my plan</button>
          <button class="btn secondary" data-action="export">Download backup</button>
          <label class="btn secondary">Restore backup<input type="file" id="import" accept="application/json,.json" hidden></label></div></div>
      <div class="card"><h3 class="game-name">Install on iPhone / iPad</h3>
        <p class="muted small">Open this page in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like an app and keeps working with poor hall Wi-Fi.</p></div>
      <div class="card"><h3 class="game-name">Data</h3>
        <div class="row">${games().some(g => g.sample) ? `<button class="btn secondary" data-action="clear-samples">Remove sample games</button>` : ""}
          <button class="btn danger" data-action="reset">Reset this device</button></div></div>
      <p class="muted small" style="color:var(--paper);opacity:.7;text-align:center;margin-top:18px">${esc(SEED.fair.name)} · ${esc(SEED.fair.venue)}</p>`;
  }

  function syncCard() {
    if (!SYNC_URL) return `<div class="card"><h3 class="game-name">Live crew sync</h3>
      <p class="muted small">Not set up yet. Once a database is added in <code>data/sync-config.js</code> (see README), everyone sees each other's picks live.</p></div>`;
    if (!crewBase()) return `<div class="card"><h3 class="game-name">Live crew sync</h3>
      <p class="muted small">Share your plans live with the crew. One person starts a crew and sends the invite link; everyone else just opens it.</p>
      <div class="row"><button class="btn" data-action="crew-new">Start a crew</button></div>
      <form id="crew-join" class="row" style="margin-top:10px"><input class="inline" style="flex:1;width:auto" name="code" placeholder="or paste a crew code" autocomplete="off" autocapitalize="off">
        <button class="btn secondary" type="submit">Join</button></form></div>`;
    const st = { live: "🟢 Live", connecting: "○ Connecting…", offline: "○ Offline: changes will sync later", error: "⚠ Can't reach the database" }[sync.state] || "";
    return `<div class="card"><h3 class="game-name">Live crew sync</h3>
      <p class="muted small">${st}<br>Crew code: <code>${esc(db.crewCode)}</code></p>
      <div class="row"><button class="btn" data-action="crew-invite">Invite the crew</button>
        <button class="btn secondary small" data-action="crew-leave">Leave crew</button></div></div>`;
  }

  // ---------- Sheets ----------
  function openSheet(html) {
    $("#sheet-body").innerHTML = html;
    $("#sheet").hidden = false;
    ui.sheetGame = null;
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    $("#sheet").hidden = true; ui.sheetGame = null;
    document.body.style.overflow = "";
  }

  function pickPlayerSheet(first) {
    openSheet(`<h2 id="sheet-title">${first ? "Who's at the table?" : "Switch player"}</h2>
      <p class="muted">${first ? "Pick your meeple. Your sessions and budget are saved under your name." : "Plans for everyone stay saved."}</p>
      <div class="players">${MEMBERS.map(m => `<button class="player ${m.id === db.currentMember ? "active" : ""}" data-action="pick" data-member="${m.id}">
        ${meeple(m.color)}${esc(m.name)}</button>`).join("")}</div>`);
    $("#sheet").dataset.locked = first ? "1" : "";
  }

  const dayOptions = sel => DAYS.map(d => `<option value="${d.date}" ${d.date === sel ? "selected" : ""}>${esc(dayLabel(d.date))}</option>`).join("");
  const LENGTHS = [15, 30, 45, 60, 75, 90, 120, 150, 180];
  const lengthOptions = sel => [...new Set([...LENGTHS, sel])].sort((a, b) => a - b)
    .map(n => `<option value="${n}" ${n === sel ? "selected" : ""}>${dur(n)}</option>`).join("");

  // Plan time at a game's booth, with or without a demo session
  function visitSection(g) {
    const mine = (myPlan().visits || []).filter(v => v.game === g.id)
      .sort((a, b) => a.day.localeCompare(b.day) || mins(a.start) - mins(b.start));
    const others = MEMBERS.filter(m => m.id !== db.currentMember)
      .flatMap(m => (db.plans[m.id].visits || []).filter(v => v.game === g.id).map(v => ({ m, v })));
    const len = visitLength(g);
    const day = ui.day;
    const t = nextFreeStart(db.currentMember, day, len);
    return `<h3>🙋 Visit the booth</h3>
      ${mine.map(v => {
        const clash = conflictsFor(db.currentMember, { ...v });
        return `<div class="session on visit-row" data-visit="${esc(v.id)}">
          <div class="visit-fields">
            <select data-visit-field="day" aria-label="Day">${dayOptions(v.day)}</select>
            <input type="time" step="900" data-visit-field="start" value="${esc(v.start)}" aria-label="Start">
            <select data-visit-field="len" aria-label="Length">${lengthOptions(mins(v.end) - mins(v.start))}</select>
            ${clash.length ? `<div class="meta"><span class="pill warn">⚠ Clashes with ${esc(clash.map(c => c.g.name).join(", "))}</span></div>` : ""}
          </div>
          <button class="btn small secondary" data-action="rm-visit" data-visit="${esc(v.id)}">Remove</button>
        </div>`;
      }).join("")}
      ${others.length ? `<p class="small muted">${others.map(({ m, v }) => `${meeple(m.color, 'style="width:16px;height:16px;vertical-align:-3px"')} ${esc(m.name)}: ${esc(dayLabel(v.day))} ${esc(v.start)}–${esc(v.end)}`).join("<br>")}</p>` : ""}
      <div class="visit-new">
        <p class="muted small" style="margin:0 0 8px">${mine.length ? "Add another visit:" : "No demo needed: block time on your day to play or look at it at the stand."}</p>
        <div class="visit-fields">
          <select id="visit-day" aria-label="Day">${dayOptions(day)}</select>
          <input id="visit-start" type="time" step="900" value="${t == null ? DAYS.find(d => d.date === day).open : fmt(t)}" aria-label="Start">
          <select id="visit-len" aria-label="Length">${lengthOptions(len)}</select>
        </div>
        <button class="btn block green" data-action="add-visit" data-game="${esc(g.id)}">＋ Add to my day</button>
      </div>`;
  }

  // Validates and returns { start, end } or null (with a toast)
  function visitTimes(day, start, length) {
    const d = DAYS.find(x => x.date === day);
    if (!d || !/^\d{1,2}:\d{2}$/.test(start || "")) { toast("Pick a day and a start time"); return null; }
    const a = mins(start), b = a + length;
    if (a < mins(d.open) || b > mins(d.close)) { toast(`The fair is open ${d.open}–${d.close}`); return null; }
    return { start: fmt(a), end: fmt(b) };
  }

  function gameSheet(id) {
    const g = gameById(id); if (!g) return closeSheet();
    const plan = myPlan();
    const buy = plan.buy[g.id];
    const sessions = [...(g.sessions || [])].sort((a, b) => a.day.localeCompare(b.day) || mins(a.start) - mins(b.start));
    const url = safeUrl(g.url);

    openSheet(`
      <h2 id="sheet-title">${esc(g.name)}</h2>
      <div class="row" style="margin:6px 0 8px">${favButton(g, true)}${whoFavs(g.id).filter(m => m.id !== db.currentMember).length ? `<span class="small muted">${meeples(whoFavs(g.id).filter(m => m.id !== db.currentMember))} also liked by ${esc(whoFavs(g.id).filter(m => m.id !== db.currentMember).map(m => m.name).join(", "))}</span>` : ""}</div>
      ${g.publisher ? `<p class="publisher">${esc(g.publisher)}</p>` : ""}
      ${g.sample ? `<p><span class="pill sample">sample data: check booth &amp; times</span></p>` : ""}
      ${g.preview ? `<p><span class="pill preview">from preview articles: check details at the fair</span></p>` : ""}
      ${tagsOf(g).length ? `<div class="tags">${tagsOf(g).map(t => `<span class="pill tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="facts">
        <div class="fact"><small>Hall / booth</small><b>${g.hall || g.booth ? esc(hallText(g)) : "?"}</b>${(g.otherBooths || []).length ? `<small class="also">also at ${esc(g.otherBooths.join(", "))}</small>` : ""}</div>
        <div class="fact"><small>Players</small><b>${esc(g.players || "?")}</b></div>
        <div class="fact"><small>Play time</small><b>${esc(g.duration || "?")}</b></div>
        <div class="fact"><small>Fair price</small><b>${g.price ? eur.format(g.price) : g.priceBand ? esc(g.priceBand) : "?"}</b></div>
      </div>
      ${g.rating ? `<p class="small rating-line">⭐ <b>${g.rating.toFixed(1)}</b> / 10 on BoardGameGeek · ${g.votes.toLocaleString("en-GB")} ratings</p>` : ""}
      ${(g.langs || []).length ? `<p class="small muted langs">🌍 ${esc(langNames(g.langs))}</p>` : ""}
      ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
      ${url ? `<p><a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener">🔗 ${g.preview ? "Source" : "Game page"}</a>
        <a class="btn secondary small" href="https://boardgamegeek.com/geeksearch.php?action=search&amp;objecttype=boardgame&amp;q=${encodeURIComponent(g.name)}" target="_blank" rel="noopener">🎲 BoardGameGeek</a></p>` : ""}

      ${visitSection(g)}

      <h3>🕒 Demo sessions</h3>
      ${!sessions.length && g.preview ? `<p class="muted">No demo times known yet. Tap <b>Edit game</b> to add one; with crew sync on, everyone sees it.</p>` : ""}
      ${sessions.length ? sessions.map(s => {
        const on = plan.sessions.includes(s.id);
        if (!attending(s.day) && !on) return `<div class="session off">
          <div><div class="when">${esc(dayLabel(s.day))} · ${esc(s.start)}–${esc(s.end)}</div>
            <div class="where">${[s.location, s.note].filter(Boolean).map(esc).join(" · ")}</div></div>
          <span class="pill">not attending</span></div>`;
        const clash = conflictsFor(db.currentMember, s);
        return `<div class="session ${on ? "on" : ""}">
          <div><div class="when">${esc(dayLabel(s.day))} · ${esc(s.start)}–${esc(s.end)}</div>
            <div class="where">${[s.location, s.note].filter(Boolean).map(esc).join(" · ")}</div>
            ${clash.length ? `<div class="meta"><span class="pill warn">⚠ ${on ? "Clashes with" : "Overlaps"} ${esc(clash.map(c => c.g.name).join(", "))}</span></div>` : ""}
            ${whoJoins(s.id).length ? `<div class="meta">${meeples(whoJoins(s.id))}<span class="small muted">&nbsp;${esc(whoJoins(s.id).map(m => m.name).join(", "))}</span></div>` : ""}
          </div>
          <button class="btn small ${on ? "secondary" : "green"}" data-action="join" data-session="${esc(s.id)}">${on ? "Leave" : "Join"}</button>
        </div>`;
      }).join("") : g.preview ? "" : `<p class="muted">No sessions listed yet. Edit the game to add times.</p>`}

      <h3>🛒 Buying it?</h3>
      <div class="buybox">
        ${buy ? `<div class="grid2">
            <label class="field">Price (€)<input id="buy-price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(buy.price ?? "")}"></label>
            ${potsOf(db.currentMember).length ? `<label class="field">Pay from<select id="buy-pot"><option value="">Personal budget</option>${potsOf(db.currentMember).map(p => `<option value="${esc(p.id)}" ${buy.pot === p.id ? "selected" : ""}>${esc(potLabel(p))}</option>`).join("")}</select></label>` : ""}
            <label class="field">Priority<select id="buy-prio"><option value="must" ${buy.prio === "must" ? "selected" : ""}>Must-have</option><option value="maybe" ${buy.prio !== "must" ? "selected" : ""}>Maybe</option></select></label>
          </div>
          <div class="row spread"><button class="btn small ${buy.bought ? "secondary" : "green"}" data-action="bought" data-game="${esc(g.id)}">${buy.bought ? "↺ Not bought yet" : "✓ Mark as bought"}</button>
          <button class="btn small secondary" data-action="unbuy" data-game="${esc(g.id)}">Remove from list</button></div>`
        : `<button class="btn block" data-action="buy" data-game="${esc(g.id)}">＋ Add to buy list${g.price ? ` (${eur.format(g.price)})` : ""}</button>`}
      </div>

      <h3>📝 My notes${crewBase() ? ` <small class="muted">(the crew can see these)</small>` : ""}</h3>
      <label class="field"><textarea id="note" placeholder="Rules questions, who to bring, promo to ask for…">${esc(plan.notes[g.id] || "")}</textarea></label>

      <div class="row spread" style="margin-top:14px">
        <button class="btn secondary" data-action="edit" data-game="${esc(g.id)}">✏️ Edit game</button>
        <button class="btn danger small" data-action="delete" data-game="${esc(g.id)}">Delete</button>
      </div>`);
    ui.sheetGame = id;
  }

  function sessionRow(s) {
    return `<div class="sess-edit" data-sid="${esc(s.id)}">
      <div class="grid3">
        <label class="field">Day<select name="day">${DAYS.map(d => `<option value="${d.date}" ${s.day === d.date ? "selected" : ""}>${esc(dayLabel(d.date))}</option>`).join("")}</select></label>
        <label class="field">From<input name="start" type="time" value="${esc(s.start || "11:00")}" required></label>
        <label class="field">To<input name="end" type="time" value="${esc(s.end || "12:00")}" required></label>
      </div>
      <div class="grid2">
        <label class="field">Where<input name="location" value="${esc(s.location || "")}" placeholder="Demo table 3"></label>
        <label class="field">Note<input name="note" value="${esc(s.note || "")}" placeholder="Sign up at booth"></label>
      </div>
      <button type="button" class="btn small secondary" data-action="rm-session" style="margin-bottom:10px">Remove session</button>
    </div>`;
  }

  function editSheet(id, name = "") {
    const g = id ? gameById(id) : { name, sessions: [] };
    openSheet(`<h2 id="sheet-title">${id ? "Edit game" : "Add a game"}</h2>
      <form id="game-form" data-id="${esc(id || "")}">
        <label class="field">Name<input name="name" required value="${esc(g.name)}" placeholder="e.g. Cascadia"></label>
        <label class="field">Publisher<input name="publisher" value="${esc(g.publisher || "")}"></label>
        <div class="grid2">
          <label class="field">Hall<input name="hall" value="${esc(g.hall || "")}" placeholder="3"></label>
          <label class="field">Booth<input name="booth" value="${esc(g.booth || "")}" placeholder="3-A102"></label>
          <label class="field">Players<input name="players" value="${esc(g.players || "")}" placeholder="2–4"></label>
          <label class="field">Play time<input name="duration" value="${esc(g.duration || "")}" placeholder="60 min"></label>
          <label class="field">Fair price (€)<input name="price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(g.price ?? "")}"></label>
          <label class="field">Link<input name="url" type="url" value="${esc(g.url || "")}" placeholder="https://boardgamegeek.com/…"></label>
        </div>
        <label class="field">Description<textarea name="description">${esc(g.description || "")}</textarea></label>
        <label class="field">Tags <span class="muted small">(comma-separated, e.g. Engine building, Co-op)</span><input name="tags" value="${esc(tagsOf(g).join(", "))}" list="tag-options" autocomplete="off"></label>
        <datalist id="tag-options">${allTags().filter(t => !STATUS_TAGS[t]).map(t => `<option value="${esc(t)}">`).join("")}</datalist>
        <h3>🕒 Sessions</h3>
        <div id="sess-list">${(g.sessions || []).map(sessionRow).join("")}</div>
        <button type="button" class="btn small secondary" data-action="add-session">＋ Add session</button>
        <div class="row" style="margin-top:18px"><button class="btn block" type="submit">Save game</button></div>
      </form>`);
  }

  function saveGameForm(form) {
    const f = new FormData(form);
    const old = form.dataset.id ? gameById(form.dataset.id) : null;
    const name = String(f.get("name")).trim();
    if (!name) return;
    let id = old ? old.id : slug(name);
    if (!old && (gameById(id) || db.hiddenGames.includes(id))) id = uid(id);
    const sessions = [...form.querySelectorAll(".sess-edit")].map(row => {
      const v = n => row.querySelector(`[name=${n}]`).value.trim();
      return { id: row.dataset.sid, day: v("day"), start: v("start"), end: v("end"), location: v("location"), note: v("note") };
    }).filter(s => s.start && s.end);
    for (const s of sessions) if (mins(s.end) <= mins(s.start)) { toast("A session ends before it starts"); return; }
    const priceRaw = String(f.get("price")).trim();
    // Start from the game as it was, so fields the form doesn't show (official-list id,
    // extra booths, preview flag…) survive an edit
    const g = {
      ...(old || {}),
      id, name,
      publisher: String(f.get("publisher")).trim(),
      hall: String(f.get("hall")).trim(),
      booth: String(f.get("booth")).trim(),
      players: String(f.get("players")).trim(),
      duration: String(f.get("duration")).trim(),
      price: priceRaw === "" ? null : Number(priceRaw),
      url: String(f.get("url")).trim(),
      description: String(f.get("description")).trim(),
      tags: [...new Set(String(f.get("tags") || "").split(",").map(t => t.trim()).filter(Boolean))],
      sessions,
      updatedAt: Date.now()
    };
    if (old && old.booth !== g.booth) delete g.boothFrom;
    db.customGames = db.customGames.filter(x => x.id !== id).concat(g);
    // Drop picks for sessions that no longer exist
    invalidate();
    const valid = new Set(sessionIndex().keys());
    MEMBERS.forEach(m => { db.plans[m.id].sessions = db.plans[m.id].sessions.filter(s => valid.has(s)); });
    save();
    toast(old ? "Game updated" : "Game added");
    render();
    gameSheet(id);
  }

  // ---------- Sharing ----------
  const b64e = str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

  async function sharePlan() {
    const payload = { v: 1, m: db.currentMember, p: myPlan(), g: db.customGames, h: db.hiddenGames, pots: db.pots };
    const url = `${location.origin}${location.pathname}#plan=${b64e(JSON.stringify(payload))}`;
    const text = `${me().name}'s SPIEL '26 plan`;
    try {
      if (navigator.share) { await navigator.share({ title: text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast("Link copied: send it to the crew");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      openSheet(`<h2>Share link</h2><p class="muted">Copy this link and send it:</p><label class="field"><textarea readonly>${esc(url)}</textarea></label>`);
    }
  }

  const cleanPot = p => isObj(p) && typeof p.id === "string" && KEY_RE.test(p.id) ? {
    id: p.id, name: typeof p.name === "string" ? p.name : "", members: asList(p.members).filter(m => typeof m === "string"),
    budget: Math.max(0, Number(p.budget) || 0), updatedAt: +p.updatedAt || 0, ...(p.deleted ? { deleted: true } : {}) } : null;
  // Newest version of each shared budget wins; true when something changed
  function mergePots(incoming) {
    let changed = false;
    asList(incoming).map(cleanPot).filter(Boolean).forEach(p => {
      const cur = db.pots.find(x => x.id === p.id);
      if (!cur || p.updatedAt > (+cur.updatedAt || 0)) { db.pots = db.pots.filter(x => x.id !== p.id).concat(p); changed = true; }
    });
    return changed;
  }

  function mergeGames(incoming, hidden) {
    (incoming || []).forEach(g => {
      if (!g || !g.id || !g.name) return;
      const cur = db.customGames.find(x => x.id === g.id);
      if (!cur || (g.updatedAt || 0) > (cur.updatedAt || 0)) db.customGames = db.customGames.filter(x => x.id !== g.id).concat(g);
    });
    (hidden || []).forEach(id => { if (!db.hiddenGames.includes(id)) db.hiddenGames.push(id); });
  }

  function checkIncomingPlan() {
    const m = location.hash.match(/^#plan=([\w-]+)/);
    if (!m) return false;
    history.replaceState(null, "", location.pathname + location.search);
    let data;
    try { data = JSON.parse(b64d(m[1])); } catch (_) { toast("That share link looks broken"); return false; }
    if (RENAMED[data.m]) data.m = RENAMED[data.m];
    const who = member(data.m);
    if (!who || !data.p) { toast("That share link looks broken"); return false; }
    const n = (data.p.sessions || []).length + (data.p.visits || []).length;
    const isMe = data.m === db.currentMember;
    openSheet(`<h2>${meeple(who.color, 'style="width:32px;height:32px;vertical-align:-6px"')} ${esc(who.name)}'s plan</h2>
      <p>${n} thing${n === 1 ? "" : "s"} on the schedule and ${Object.keys(data.p.buy || {}).length} game${Object.keys(data.p.buy || {}).length === 1 ? "" : "s"} on the buy list.
      ${isMe ? "<br><b>This will replace your own plan on this device.</b>" : ""}</p>
      <div class="row"><button class="btn" data-action="accept-plan">Import</button><button class="btn secondary" data-close>Not now</button></div>`);
    $("#sheet").dataset.pending = JSON.stringify(data);
    return true;
  }

  // ---------- Live crew sync (Firebase Realtime Database over REST) ----------
  const SYNC_URL = String((window.SPIEL_SYNC || {}).databaseURL || "").trim().replace(/\/+$/, "");
  const CREW_RE = /^[A-Za-z0-9_-]{10,40}$/;  // must match the database rules (length >= 10)
  const KEY_RE = /^[A-Za-z0-9_-]{1,120}$/;  // safe Firebase keys
  const sync = { state: "off", remote: null, es: null, inflight: new Set(), again: false, pushTimer: null, retryTimer: null, pendingRender: false };
  const crewBase = () => SYNC_URL && CREW_RE.test(db.crewCode || "") ? `${SYNC_URL}/crews/${db.crewCode}` : null;
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const asList = v => Array.isArray(v) ? v.filter(x => x != null) : isObj(v) ? Object.values(v) : [];

  function setSyncState(st) {
    if (sync.state === st) return;
    sync.state = st;
    renderHeader();
    if (ui.tab === "crew" || ui.tab === "settings") softRender();
  }

  function connectSync() {
    if (sync.es) { sync.es.close(); sync.es = null; }
    sync.remote = null;
    const base = crewBase();
    if (!base) return setSyncState("off");
    if (!("EventSource" in window)) return setSyncState("error");
    setSyncState("connecting");
    const es = new EventSource(`${base}.json`);
    sync.es = es;
    const onEvent = e => {
      let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (!msg || typeof msg.path !== "string") return;
      const parts = msg.path.split("/").filter(Boolean);
      if (e.type === "patch") Object.entries(isObj(msg.data) ? msg.data : {}).forEach(([k, v]) => setRemote(parts.concat(k.split("/").filter(Boolean)), v));
      else setRemote(parts, msg.data);
      setSyncState("live");
      reconcile();
    };
    es.addEventListener("put", onEvent);
    es.addEventListener("patch", onEvent);
    es.addEventListener("cancel", () => setSyncState("error"));
    es.onerror = () => { if (sync.es === es) setSyncState(navigator.onLine === false ? "offline" : "connecting"); };
  }

  function setRemote(parts, value) {
    if (!parts.length) { sync.remote = isObj(value) ? value : {}; return; }
    if (!isObj(sync.remote)) sync.remote = {};
    let node = sync.remote;
    parts.slice(0, -1).forEach(k => { if (!isObj(node[k])) node[k] = {}; node = node[k]; });
    const leaf = parts[parts.length - 1];
    if (value === null || value === undefined) delete node[leaf]; else node[leaf] = value;
  }

  const cleanPlan = p => {
    const plan = Object.assign(emptyPlan(), p);
    plan.sessions = asList(p.sessions).filter(x => typeof x === "string");
    plan.favs = asList(p.favs).filter(x => typeof x === "string");
    plan.visits = asList(p.visits).filter(v => isObj(v) && ["id", "game", "day", "start", "end"].every(k => typeof v[k] === "string"));
    plan.buy = isObj(p.buy) ? p.buy : {};
    plan.notes = isObj(p.notes) ? p.notes : {};
    plan.updatedAt = +p.updatedAt || 0;
    return plan;
  };
  const cleanGame = g => Object.assign({}, g, {
    sessions: asList(g.sessions).filter(x => isObj(x) && typeof x.id === "string" && typeof x.day === "string" && typeof x.start === "string" && typeof x.end === "string")
  });

  // Take whatever is newer on the server, then push whatever is newer here.
  function reconcile() {
    const r = isObj(sync.remote) ? sync.remote : {};
    let changed = false;
    const rp = isObj(r.plans) ? r.plans : {};
    MEMBERS.forEach(m => {
      const rem = rp[m.id];
      if (isObj(rem) && (+rem.updatedAt || 0) > (db.plans[m.id].updatedAt || 0)) { db.plans[m.id] = cleanPlan(rem); changed = true; }
    });
    Object.keys(isObj(r.hidden) ? r.hidden : {}).forEach(id => {
      if (r.hidden[id] && !db.hiddenGames.includes(id)) { db.hiddenGames.push(id); changed = true; }
    });
    Object.values(isObj(r.games) ? r.games : {}).forEach(g => {
      if (!isObj(g) || typeof g.id !== "string" || typeof g.name !== "string" || db.hiddenGames.includes(g.id)) return;
      const cur = db.customGames.find(x => x.id === g.id);
      if (!cur || (+g.updatedAt || 0) > (+cur.updatedAt || 0)) { db.customGames = db.customGames.filter(x => x.id !== g.id).concat(cleanGame(g)); changed = true; }
    });
    if (mergePots(isObj(r.pots) ? Object.values(r.pots) : [])) changed = true;
    const n = db.customGames.length;
    db.customGames = db.customGames.filter(g => !db.hiddenGames.includes(g.id));
    if (db.customGames.length !== n) changed = true;
    if (changed) { save(); softRender(); }
    pushChanges();
  }

  function schedulePush() { clearTimeout(sync.pushTimer); sync.pushTimer = setTimeout(pushChanges, 300); }

  function pushChanges() {
    // Only after the first snapshot arrived, so an old phone never overwrites newer data
    if (!crewBase() || !isObj(sync.remote)) return;
    const r = sync.remote, rp = isObj(r.plans) ? r.plans : {}, rg = isObj(r.games) ? r.games : {}, rh = isObj(r.hidden) ? r.hidden : {};
    MEMBERS.forEach(m => {
      const local = db.plans[m.id];
      if ((local.updatedAt || 0) > (+(rp[m.id] || {}).updatedAt || 0)) put(`plans/${m.id}`, local);
    });
    db.customGames.forEach(g => {
      if (KEY_RE.test(g.id) && (!rg[g.id] || (+g.updatedAt || 0) > (+rg[g.id].updatedAt || 0))) put(`games/${g.id}`, g);
    });
    db.hiddenGames.forEach(id => { if (KEY_RE.test(id) && !rh[id]) put(`hidden/${id}`, true); });
    const rpots = isObj(r.pots) ? r.pots : {};
    db.pots.forEach(p => { if (KEY_RE.test(p.id) && (+p.updatedAt || 0) > (+(rpots[p.id] || {}).updatedAt || 0)) put(`pots/${p.id}`, p); });
  }

  function put(path, value) {
    if (sync.inflight.has(path)) { sync.again = true; return; }
    const base = crewBase();
    sync.inflight.add(path);
    const body = JSON.stringify(value);
    fetch(`${base}/${path}.json`, { method: "PUT", body })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (crewBase() === base) setRemote(path.split("/"), JSON.parse(body));
      })
      .catch(() => {
        setSyncState(navigator.onLine === false ? "offline" : "error");
        clearTimeout(sync.retryTimer); sync.retryTimer = setTimeout(pushChanges, 15000);
      })
      .finally(() => { sync.inflight.delete(path); if (sync.again) { sync.again = false; schedulePush(); } });
  }

  function joinCrew(code) {
    code = String(code || "").trim();
    if (!SYNC_URL) { toast("Live sync isn't set up in this app yet"); return false; }
    if (!CREW_RE.test(code)) { toast("That crew code doesn't look right"); return false; }
    db.crewCode = code; save(); connectSync();
    return true;
  }
  const newCrewCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const crewInviteUrl = () => `${location.origin}${location.pathname}#crew=${db.crewCode}`;

  async function inviteCrew() {
    const url = crewInviteUrl();
    try {
      if (navigator.share) { await navigator.share({ title: "Join our SPIEL '26 crew", url }); return; }
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      openSheet(`<h2>Invite link</h2><p class="muted">Send this link to the crew:</p><label class="field"><textarea readonly>${esc(url)}</textarea></label>`);
    }
  }

  function checkIncomingCrew() {
    const m = location.hash.match(/^#crew=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (db.crewCode === m[1]) return true;
    if (joinCrew(m[1])) { toast("Joined the crew: live sync is on"); render(); }
    return true;
  }

  // Re-render for remote changes without stealing focus from something being typed
  function softRender() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest("#view, #sheet")) { sync.pendingRender = true; return; }
    render();
    if (ui.sheetGame && !$("#sheet").hidden) gameSheet(ui.sheetGame);
  }
  document.addEventListener("focusout", () => setTimeout(() => {
    if (sync.pendingRender && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) { sync.pendingRender = false; softRender(); }
  }, 0));
  window.addEventListener("online", () => { if (crewBase() && (!sync.es || sync.es.readyState === 2)) connectSync(); else pushChanges(); });
  window.addEventListener("offline", () => { if (crewBase()) setSyncState("offline"); });

  // ---------- Render ----------
  function render() {
    renderHeader();
    document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === ui.tab));
    if (!me()) { $("#view").innerHTML = ""; $("#days").hidden = true; return; }
    renderDays();
    const views = { schedule: viewSchedule, games: viewGames, crew: viewCrew, budget: viewBudget, settings: viewSettings };
    $("#view").innerHTML = (views[ui.tab] || viewSchedule)();
    keepUi();
  }
  const refreshSheet = () => { if (ui.sheetGame) gameSheet(ui.sheetGame); };

  // ---------- Events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-action],[data-tab],[data-day],[data-close],#who");
    if (!el) return;
    if (el.id === "who") return pickPlayerSheet(false);
    if (el.hasAttribute("data-close")) { if (!$("#sheet").dataset.locked) closeSheet(); return; }
    if (el.dataset.day) { ui.day = el.dataset.day; return render(); }
    const a = el.dataset.action;
    if (!a && el.dataset.tab) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return; }

    const plan = db.currentMember ? myPlan() : null;
    const gid = el.dataset.game;
    switch (a) {
      case "tab": ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "pick":
        db.currentMember = el.dataset.member; ui.who = ""; save();
        $("#sheet").dataset.locked = ""; closeSheet(); render();
        toast(`Hi ${me().name}!`);
        break;
      case "who": pickPlayerSheet(false); break;
      case "view-who": ui.who = el.dataset.who === db.currentMember ? "" : el.dataset.who; render(); window.scrollTo(0, 0); break;
      case "open": gameSheet(gid); break;
      case "filter": ui.filter = el.dataset.filter; ui.limit = PAGE; render(); break;
      case "tag": {
        const t = el.dataset.tag;
        ui.tags = ui.tags.includes(t) ? ui.tags.filter(x => x !== t) : [...ui.tags, t];
        ui.limit = PAGE; render(); break;
      }
      case "tags-clear": ui.tags = []; ui.limit = PAGE; render(); break;
      case "more": ui.limit += PAGE * 2; render(); break;
      case "join": {
        const sid = el.dataset.session;
        const i = plan.sessions.indexOf(sid);
        if (i >= 0) { plan.sessions.splice(i, 1); toast("Left session"); }
        else {
          plan.sessions.push(sid);
          const s = sessionIndex().get(sid)?.s;
          if (s) ui.day = s.day;
          toast(s && conflictsFor(db.currentMember, s).length ? "Joined, but it clashes with another session" : "Joined! 🎉");
        }
        touch(db.currentMember); render(); refreshSheet();
        break;
      }
      case "buy": {
        const g = gameById(gid);
        plan.buy[gid] = { price: g.price ?? "", prio: "must", bought: false };
        touch(db.currentMember); render(); refreshSheet(); toast("Added to buy list");
        break;
      }
      case "pot-new": potSheet(null); break;
      case "pot-edit": potSheet(el.dataset.pot); break;
      case "pot-delete": {
        const p = db.pots.find(x => x.id === el.dataset.pot);
        if (!p || !confirm(`Delete the shared budget “${potLabel(p)}”? Its items go back to everyone's personal budget.`)) return;
        Object.assign(p, { deleted: true, updatedAt: Date.now() });
        save(); closeSheet(); render(); toast("Shared budget deleted");
        break;
      }
      case "fav": {
        plan.favs = isFav(db.currentMember, gid) ? plan.favs.filter(id => id !== gid) : [...(plan.favs || []), gid];
        touch(db.currentMember); render(); refreshSheet();
        toast(isFav(db.currentMember, gid) ? "★ Added to favorites" : "Removed from favorites");
        break;
      }
      case "add-visit": {
        const len = Number($("#visit-len").value), day = $("#visit-day").value;
        const t = visitTimes(day, $("#visit-start").value, len);
        if (!t) return;
        const v = { id: uid("v"), game: gid, day, ...t };
        plan.visits = (plan.visits || []).concat(v);
        ui.day = day;
        touch(db.currentMember); render(); refreshSheet();
        toast(conflictsFor(db.currentMember, v).length ? "Added, but it clashes with something else" : `Added: ${dayLabel(day)} ${t.start}`);
        break;
      }
      case "rm-visit":
        plan.visits = (plan.visits || []).filter(v => v.id !== el.dataset.visit);
        touch(db.currentMember); render(); refreshSheet(); toast("Visit removed");
        break;
      case "fix-clashes": {
        // Latest first: move each clashing visit to the first free time after where it was, else the first free time that day
        let moved = 0, stuck = 0;
        planItems(db.currentMember, ui.day).filter(x => x.kind === "visit").reverse().forEach(x => {
          if (!conflictsFor(db.currentMember, x).length) return;
          const len = mins(x.end) - mins(x.start);
          x.v.day = "";  // take it off the day while looking for room
          const t = nextFreeStart(db.currentMember, ui.day, len, mins(x.start)) ?? nextFreeStart(db.currentMember, ui.day, len);
          x.v.day = ui.day;
          if (t == null) { stuck++; return; }
          x.v.start = fmt(t); x.v.end = fmt(t + len); moved++;
        });
        touch(db.currentMember); render();
        toast(stuck ? `Moved ${moved}; no free time left for ${stuck}` : `Moved ${moved} visit${moved === 1 ? "" : "s"}`);
        break;
      }
      case "unbuy": delete plan.buy[gid]; touch(db.currentMember); render(); refreshSheet(); break;
      case "bought": plan.buy[gid].bought = !plan.buy[gid].bought; touch(db.currentMember); render(); refreshSheet(); break;
      case "prio": plan.buy[gid].prio = plan.buy[gid].prio === "must" ? "maybe" : "must"; touch(db.currentMember); render(); break;
      case "new": editSheet(null, el.dataset.name); break;
      case "edit": editSheet(gid); break;
      case "add-session": {
        const list = $("#sess-list");
        list.insertAdjacentHTML("beforeend", sessionRow({ id: uid("s"), day: ui.day }));
        list.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
      case "rm-session": el.closest(".sess-edit").remove(); break;
      case "delete": {
        const g = gameById(gid);
        if (!confirm(`Delete “${g.name}”${crewBase() ? " for the whole crew" : " from this device"}?`)) return;
        db.customGames = db.customGames.filter(x => x.id !== gid);
        if (!db.hiddenGames.includes(gid)) db.hiddenGames.push(gid);
        const sids = new Set((g.sessions || []).map(s => s.id));
        MEMBERS.forEach(m => { const p = db.plans[m.id]; p.sessions = p.sessions.filter(s => !sids.has(s)); p.visits = (p.visits || []).filter(v => v.game !== gid); delete p.buy[gid]; });
        save(); closeSheet(); render(); toast("Game deleted");
        break;
      }
      case "share": sharePlan(); break;
      case "crew-new":
        if (joinCrew(newCrewCode())) { render(); inviteCrew(); }
        break;
      case "crew-invite": inviteCrew(); break;
      case "crew-leave":
        if (!confirm("Stop syncing with the crew on this device? Your plans stay saved here.")) return;
        db.crewCode = ""; save(); connectSync(); render();
        break;
      case "accept-plan": {
        const data = JSON.parse($("#sheet").dataset.pending || "null");
        if (!data) return;
        db.plans[data.m] = cleanPlan(data.p);
        mergeGames(data.g, data.h);
        mergePots(data.pots);
        save(); delete $("#sheet").dataset.pending; closeSheet();
        ui.tab = "crew"; render(); toast(`${member(data.m).name}'s plan imported`);
        break;
      }
      case "export": {
        const blob = new Blob([JSON.stringify({ app: "spiel26", exportedAt: new Date().toISOString(), db }, null, 2)], { type: "application/json" });
        const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `spiel26-backup-${today}.json` });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        break;
      }
      case "clear-samples": {
        const ids = SEED.games.filter(g => g.sample).map(g => g.id);
        if (!confirm(`Remove ${ids.length} sample games?`)) return;
        ids.forEach(id => { if (!db.hiddenGames.includes(id)) db.hiddenGames.push(id); });
        db.customGames = db.customGames.filter(g => !ids.includes(g.id));
        invalidate();
        const valid = new Set(sessionIndex().keys());
        MEMBERS.forEach(m => { const p = db.plans[m.id]; p.sessions = p.sessions.filter(s => valid.has(s)); p.visits = (p.visits || []).filter(v => !ids.includes(v.game)); ids.forEach(id => delete p.buy[id]); });
        save(); render(); toast("Samples removed");
        break;
      }
      case "reset":
        if (!confirm("Erase every plan and added game on this device?")) return;
        try { localStorage.removeItem(STORE_KEY); } catch (_) {}
        db = load(); invalidate(); connectSync(); render(); pickPlayerSheet(true);
        break;
    }
  });

  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "search") {
      ui.query = t.value;
      ui.limit = PAGE;
      const pos = t.selectionStart;
      render();
      const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos);
    }
    if (t.id === "note" && ui.sheetGame) {
      const p = myPlan();
      if (t.value.trim()) p.notes[ui.sheetGame] = t.value; else delete p.notes[ui.sheetGame];
      touch(db.currentMember);
    }
  });

  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sort") { ui.sort = t.value; ui.limit = PAGE; render(); return; }
    if (t.id === "hall") { ui.hall = t.value; ui.limit = PAGE; render(); return; }
    if (t.dataset.potFor || (t.id === "buy-pot" && ui.sheetGame)) {
      const b = myPlan().buy[t.dataset.potFor || ui.sheetGame];
      if (!b) return;
      if (t.value) b.pot = t.value; else delete b.pot;
      touch(db.currentMember); render(); if (t.id === "buy-pot") refreshSheet();
      toast(t.value ? `Paid from ${potLabel(pots().find(p => p.id === t.value))}` : "Paid from your personal budget");
      return;
    }
    if (t.classList.contains("pot-budget")) {
      const p = db.pots.find(x => x.id === t.dataset.pot);
      if (p) { p.budget = Math.max(0, Number(t.value) || 0); p.updatedAt = Date.now(); save(); render(); }
      return;
    }
    if (t.id === "visit-day" && ui.sheetGame) {
      const n = nextFreeStart(db.currentMember, $("#visit-day").value, Number($("#visit-len").value));
      if (n != null) $("#visit-start").value = fmt(n);
    }
    if (t.dataset.visitField) {
      const v = (myPlan().visits || []).find(x => x.id === t.closest("[data-visit]").dataset.visit);
      if (!v) return;
      const row = t.closest("[data-visit]"), get = f => row.querySelector(`[data-visit-field="${f}"]`).value;
      const times = visitTimes(get("day"), get("start"), Number(get("len")));
      if (times) { Object.assign(v, { day: get("day") }, times); ui.day = v.day; touch(db.currentMember); render(); }
      refreshSheet();
    }
    if (t.id === "budget") { myPlan().budget = Math.max(0, Number(t.value) || 0); touch(db.currentMember); render(); }
    if ((t.id === "buy-price" || t.id === "buy-prio") && ui.sheetGame) {
      const b = myPlan().buy[ui.sheetGame];
      if (t.id === "buy-price") b.price = t.value === "" ? "" : Math.max(0, Number(t.value));
      else b.prio = t.value;
      touch(db.currentMember); render();
    }
    if (t.id === "import" && t.files[0]) {
      t.files[0].text().then(txt => {
        const data = JSON.parse(txt);
        if (data.app !== "spiel26" || !data.db) throw new Error("not a backup");
        if (!confirm("Replace everything on this device with this backup?")) return;
        const keepMe = db.currentMember;
        localStorage.setItem(STORE_KEY, JSON.stringify(data.db));
        const keepCrew = db.crewCode;
        db = load(); db.currentMember = keepMe || db.currentMember; db.crewCode = keepCrew || db.crewCode; save(); connectSync();
        render(); toast("Backup restored");
      }).catch(() => toast("That file isn't a SPIEL '26 backup"));
    }
  });

  // ---------- Drag to move / resize booth visits on My day ----------
  let drag = null;
  document.addEventListener("pointerdown", e => {
    const handle = e.target.closest("[data-drag]");
    const block = handle && handle.closest(".pblock-visit");
    if (!block || e.button > 0) return;
    const v = (myPlan().visits || []).find(x => x.id === block.dataset.item);
    if (!v) return;
    e.preventDefault();
    const plan = block.closest(".dayplan");
    drag = { v, block, mode: handle.dataset.drag, y0: e.clientY + scrollY, start: mins(v.start), end: mins(v.end),
      first: Number(plan.dataset.first), close: Number(plan.dataset.close),
      open: mins((DAYS.find(d => d.date === v.day) || DAYS[0]).open), pointer: e.pointerId };
    drag.next = { start: drag.start, end: drag.end };
    block.classList.add("dragging");
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  document.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    e.preventDefault();
    // Scroll the page when dragging near the top or bottom edge
    if (e.clientY < 70) scrollBy(0, -12); else if (e.clientY > innerHeight - 90) scrollBy(0, 12);
    const dm = Math.round((e.clientY + scrollY - drag.y0) / PX / 15) * 15;
    const len = drag.end - drag.start;
    if (drag.mode === "move") {
      const st = Math.min(Math.max(drag.start + dm, drag.open), drag.close - len);
      drag.next = { start: st, end: st + len };
    } else drag.next = { start: drag.start, end: Math.min(Math.max(drag.end + dm, drag.start + 15), drag.close) };
    const b = drag.block;
    b.style.top = `${(drag.next.start - drag.first) * PX}px`;
    b.style.height = `${Math.max(26, (drag.next.end - drag.next.start) * PX - 3)}px`;
    b.querySelector(".block-time").textContent = `${fmt(drag.next.start)}–${fmt(drag.next.end)} · booth visit`;
  }, { passive: false });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag; drag = null;
    if (e.type === "pointerup" && (d.next.start !== d.start || d.next.end !== d.end)) {
      d.v.start = fmt(d.next.start); d.v.end = fmt(d.next.end);
      touch(db.currentMember);
      toast(conflictsFor(db.currentMember, d.v).length ? `${fmt(d.next.start)}–${fmt(d.next.end)}: clashes with something` : `${fmt(d.next.start)}–${fmt(d.next.end)}`);
    }
    render();
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  document.addEventListener("submit", e => {
    if (e.target.id === "game-form") { e.preventDefault(); saveGameForm(e.target); }
    if (e.target.id === "pot-form") { e.preventDefault(); savePot(e.target); }
    if (e.target.id === "crew-join") {
      e.preventDefault();
      const code = new FormData(e.target).get("code");
      const m = String(code || "").match(/#crew=([A-Za-z0-9_-]+)/);  // a pasted invite link works too
      if (joinCrew(m ? m[1] : code)) { toast("Joined the crew: live sync is on"); render(); }
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#sheet").hidden && !$("#sheet").dataset.locked) closeSheet();
  });

  window.addEventListener("hashchange", () => { checkIncomingCrew() || checkIncomingPlan(); });

  // ---------- Boot ----------
  checkIncomingCrew();
  connectSync();
  render();
  if (!me()) pickPlayerSheet(true);
  else checkIncomingPlan();
  // Show an incoming plan after the player has been picked
  if (!me() && /^#plan=/.test(location.hash)) {
    const wait = setInterval(() => { if (me()) { clearInterval(wait); checkIncomingPlan(); } }, 400);
  }
  setInterval(renderHeader, 60 * 1000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
