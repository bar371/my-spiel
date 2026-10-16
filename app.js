/* SPIEL '26 planner: a no-build, single-page app.
 *
 * Data model
 *   SEED (data/spiel-data.js)  shared starting data: fair days, members, games
 *   localStorage "spiel26:v1"  this device's DB:
 *     currentMember            who is using this device
 *     customGames[]            games added or edited in the app (override seed by id)
 *     hiddenGames[]            seed game ids removed in the app
 *     plans{memberId}          { sessions[], buy{gameId:{price,prio,bought}}, budget, notes{}, updatedAt }
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
  const emptyPlan = () => ({ sessions: [], buy: {}, budget: 0, notes: {}, updatedAt: 0 });

  function load() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* private mode etc. */ }
    db = db && typeof db === "object" ? db : {};
    db.currentMember = db.currentMember || null;
    db.customGames = Array.isArray(db.customGames) ? db.customGames : [];
    db.hiddenGames = Array.isArray(db.hiddenGames) ? db.hiddenGames : [];
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
  const whoJoins = sid => MEMBERS.filter(m => db.plans[m.id].sessions.includes(sid));
  const whoJoinsGame = g => MEMBERS.filter(m => (g.sessions || []).some(s => db.plans[m.id].sessions.includes(s.id)));

  function conflictsFor(memberId, session) {
    const idx = sessionIndex();
    return db.plans[memberId].sessions
      .filter(id => id !== session.id && idx.has(id))
      .map(id => idx.get(id))
      .filter(x => overlaps(x.s, session));
  }

  // ---------- Helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = sel => document.querySelector(sel);
  const meeple = (color, size = "") => `<svg ${size} fill="${esc(color)}" aria-hidden="true"><use href="#meeple"/></svg>`;
  const meeples = list => list.length
    ? `<span class="meeples" title="${esc(list.map(m => m.name).join(", "))}">${list.map(m => meeple(m.color)).join("")}</span>` : "";
  const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "game";
  const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
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
    limit: PAGE,
    sheetGame: null
  };
  try { Object.assign(ui, JSON.parse(sessionStorage.getItem("spiel26:ui") || "{}"), { sheetGame: null }); } catch (_) {}
  if (!DAYS.some(d => d.date === ui.day)) ui.day = DAYS[0].date;
  const keepUi = () => { try { sessionStorage.setItem("spiel26:ui", JSON.stringify({ tab: ui.tab, day: ui.day, filter: ui.filter })); } catch (_) {} };

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
    const idx = sessionIndex();
    const crew = ui.tab === "crew";
    const ids = crew ? new Set(MEMBERS.flatMap(m => db.plans[m.id].sessions)) : new Set(myPlan().sessions);
    nav.style.setProperty("--day-count", DAYS.length);
    nav.innerHTML = DAYS.map(d => {
      const n = [...ids].filter(id => idx.get(id)?.s.day === d.date).length;
      return `<button class="day ${ui.day === d.date ? "active" : ""}" data-day="${d.date}">
        <b>${d.label}</b><small>${Number(d.date.slice(8))} Oct</small><br><span class="count">${n}</span></button>`;
    }).join("");
  }

  // ---------- Views ----------
  function viewSchedule() {
    const idx = sessionIndex();
    const day = DAYS.find(d => d.date === ui.day) || DAYS[0];
    const mine = myPlan().sessions.map(id => idx.get(id)).filter(x => x && x.s.day === day.date)
      .sort((a, b) => mins(a.s.start) - mins(b.s.start));

    let html = `<h2 class="section-title">${esc(dayLabel(day.date))} <span class="pill">${day.open}–${day.close}</span></h2>`;
    if (!mine.length) {
      return html + `<div class="empty"><span class="big">🧩</span><b>Nothing planned yet</b>
        <p>Open a game and join one of its demo sessions to fill this day.</p>
        <button class="btn" data-action="tab" data-tab="games">Browse games</button></div>`;
    }
    let cursor = mins(day.open);
    const parts = [];
    mine.forEach(({ s, g }) => {
      const gap = mins(s.start) - cursor;
      if (gap >= 30) parts.push(`<div class="slot free"><span class="time">${fmt(cursor)}</span><span class="dot" style="background:transparent"></span>
        <div class="card small">☕ ${dur(gap)} free: browse the halls</div></div>`);
      const clash = conflictsFor(db.currentMember, s);
      parts.push(`<div class="slot ${clash.length ? "conflict" : ""}">
        <span class="time">${esc(s.start)}<small>${esc(s.end)}</small></span><span class="dot"></span>
        <article class="card tap" data-action="open" data-game="${esc(g.id)}">
          ${meeples(whoJoins(s.id))}
          <h3 class="game-name">${esc(g.name)}</h3>
          <div class="meta">
            ${hallPill(g)}
            ${s.location ? `<span class="pill">📍 ${esc(s.location)}</span>` : ""}
            ${clash.length ? `<span class="pill warn">⚠ Clashes with ${esc(clash.map(c => c.g.name).join(", "))}</span>` : ""}
          </div>
        </article></div>`);
      cursor = Math.max(cursor, mins(s.end));
    });
    return html + `<div class="board"><div class="timeline">${parts.join("")}</div></div>`;
  }
  const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const hallPill = g => (g.hall || g.booth) ? `<span class="pill">🏛 Hall ${esc(g.hall || "?")}${g.booth ? ` · ${esc(g.booth)}` : ""}</span>` : "";

  function viewGames() {
    const plan = myPlan();
    const q = ui.query.trim().toLowerCase();
    let list = games().filter(g => !q || [g.name, g.publisher, g.description].join(" ").toLowerCase().includes(q));
    if (ui.filter === "joining") list = list.filter(g => (g.sessions || []).some(s => plan.sessions.includes(s.id)));
    if (ui.filter === "buy") list = list.filter(g => plan.buy[g.id]);
    const anySample = games().some(g => g.sample);

    const chips = [["all", "All"], ["joining", "Joining"], ["buy", "Buy list"]]
      .map(([k, l]) => `<button class="btn small ${ui.filter === k ? "" : "secondary"}" data-action="filter" data-filter="${k}">${l}</button>`).join("");

    return `<h2 class="section-title">🎲 Games at SPIEL</h2>
      <div class="toolbar"><input class="search" id="search" type="search" placeholder="Search games, publishers…" value="${esc(ui.query)}" autocomplete="off">
      <button class="btn" data-action="new">＋ Add</button></div>
      <div class="row" style="margin-bottom:12px">${chips}</div>
      ${anySample ? `<div class="banner">🧪 Cards marked <b>sample</b> have placeholder booths and times. Edit them or clear them under <b>More</b>.</div>` : ""}
      <p class="muted small" style="color:var(--paper);opacity:.8;margin:0 4px 8px">${list.length} game${list.length === 1 ? "" : "s"}</p>
      ${list.length ? list.slice(0, ui.limit).map(gameCard).join("") : `<div class="empty"><span class="big">🔍</span><b>No games here</b><p>Try another filter or add a game.</p></div>`}
      ${list.length > ui.limit ? `<button class="btn secondary block" style="margin-top:12px" data-action="more">Show more (${list.length - ui.limit} left)</button>` : ""}`;
  }

  function gameCard(g) {
    const plan = myPlan();
    const joining = (g.sessions || []).filter(s => plan.sessions.includes(s.id)).length;
    const h = hue(g.name);
    return `<article class="card tap game-card" data-action="open" data-game="${esc(g.id)}">
      <div class="game-tile" style="background:hsl(${h} 55% 45%)">${esc(initials(g.name))}</div>
      <div>
        ${meeples(whoJoinsGame(g))}
        <h3 class="game-name" style="padding-right:${whoJoinsGame(g).length * 16 + 4}px">${esc(g.name)}</h3>
        ${g.publisher ? `<p class="muted small" style="margin:2px 0 0">${esc(g.publisher)}</p>` : ""}
        <p class="desc-short">${esc(g.description || "")}</p>
        <div class="meta">
          ${g.sample ? `<span class="pill sample">sample</span>` : ""}
          ${hallPill(g)}
          <span class="pill">🕒 ${(g.sessions || []).length} session${(g.sessions || []).length === 1 ? "" : "s"}</span>
          ${g.price ? `<span class="pill">${eur.format(g.price)}</span>` : ""}
          ${joining ? `<span class="pill ok">✓ Joining</span>` : ""}
          ${plan.buy[g.id] ? `<span class="pill gold">🛒 ${plan.buy[g.id].bought ? "Bought" : "Buy list"}</span>` : ""}
        </div>
      </div></article>`;
  }

  function viewCrew() {
    const idx = sessionIndex();
    const day = DAYS.find(d => d.date === ui.day) || DAYS[0];
    const cards = MEMBERS.map(m => {
      const p = db.plans[m.id];
      const n = p.sessions.filter(id => idx.has(id)).length;
      const spend = Object.values(p.buy).reduce((t, b) => t + (Number(b.price) || 0), 0);
      const when = p.updatedAt ? new Date(p.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "no plan yet";
      return `<div class="card crew-member">${meeple(m.color)}
        <div><h4>${esc(m.name)}${m.id === db.currentMember ? " <span class='pill gold'>you</span>" : ""}</h4>
        <p>${n} session${n === 1 ? "" : "s"} · ${eur.format(spend)} on the buy list · ${esc(when)}</p></div>
        ${m.id === db.currentMember && !crewBase() ? `<button class="btn small" data-action="share">Share</button>` : ""}</div>`;
    }).join("");

    // Every session anyone in the crew has joined on the selected day
    const going = [...idx.values()]
      .filter(x => x.s.day === day.date)
      .map(x => ({ ...x, who: whoJoins(x.s.id) }))
      .filter(x => x.who.length)
      .sort((a, b) => mins(a.s.start) - mins(b.s.start) || a.g.name.localeCompare(b.g.name));

    const banner = crewBase()
      ? `<div class="banner live">${sync.state === "live" ? "🟢 <b>Live.</b> Everyone's picks update here automatically." : "○ Connecting to the crew… changes are saved and will sync."}</div>`
      : `<div class="banner">Plans aren't syncing yet. ${SYNC_URL ? "Turn on <b>live crew sync</b> under <b>More</b> so everyone sees each other's picks automatically." : "Until live sync is set up, tap <b>Share</b> to send your plan as a link."}</div>`;

    return `<h2 class="section-title">🗺️ Who's going where · ${esc(dayLabel(day.date))}</h2>
      ${banner}
      ${going.length ? going.map(({ s, g, who }) => `<article class="card tap going ${who.length > 1 ? "together" : ""}" data-action="open" data-game="${esc(g.id)}">
          <div class="going-time"><b>${esc(s.start)}</b><small>${esc(s.end)}</small></div>
          <div><h3 class="game-name">${esc(g.name)}</h3>
            <div class="meta">${meeples(who)}<span class="small">${esc(who.map(m => m.name).join(", "))}</span></div>
            <div class="meta">${hallPill(g)}${s.location ? `<span class="pill">📍 ${esc(s.location)}</span>` : ""}
              ${who.length > 1 ? `<span class="pill ok">🤝 together</span>` : ""}
              ${who.some(m => m.id === db.currentMember) ? `<span class="pill gold">you're in</span>` : ""}</div></div>
        </article>`).join("")
        : `<div class="empty"><span class="big">🗺️</span><b>Nobody has joined a session on ${esc(day.label)} yet</b><p>Sessions anyone in the crew joins show up here with their meeples.</p></div>`}
      <h2 class="section-title">👥 The crew</h2>
      <div class="crew-grid">${cards}</div>`;
  }

  function viewBudget() {
    const plan = myPlan();
    const items = Object.entries(plan.buy).map(([id, b]) => ({ id, b, g: gameById(id) })).filter(x => x.g)
      .sort((a, b) => (a.b.bought - b.b.bought) || ((a.b.prio === "must" ? 0 : 1) - (b.b.prio === "must" ? 0 : 1)) || a.g.name.localeCompare(b.g.name));
    const bought = items.filter(x => x.b.bought).reduce((t, x) => t + (+x.b.price || 0), 0);
    const must = items.filter(x => !x.b.bought && x.b.prio === "must").reduce((t, x) => t + (+x.b.price || 0), 0);
    const maybe = items.filter(x => !x.b.bought && x.b.prio !== "must").reduce((t, x) => t + (+x.b.price || 0), 0);
    const budget = +plan.budget || 0;
    const left = budget - bought;
    const scale = Math.max(budget, bought + must, 1);

    return `<h2 class="section-title">💰 ${esc(me().name)}'s budget</h2>
      <div class="card budget-head">
        <label class="muted small">Budget for the fair&nbsp;
          <input class="inline" id="budget" type="number" inputmode="decimal" min="0" step="5" value="${budget || ""}" placeholder="€ 0"></label>
        <div class="coins ${left < 0 ? "over" : ""}">${eur.format(left)}</div>
        <div class="muted small">${left < 0 ? "over budget" : "left to spend"}</div>
        <div class="bar"><span class="bought" style="width:${bought / scale * 100}%"></span><span class="planned" style="width:${must / scale * 100}%"></span></div>
        <div class="legend"><span><i style="background:var(--ok)"></i>Bought ${eur.format(bought)}</span>
          <span><i style="background:var(--accent)"></i>Must-have ${eur.format(must)}</span>
          <span><i style="background:var(--paper-2)"></i>Maybe ${eur.format(maybe)}</span></div>
        ${budget && bought + must > budget ? `<p class="pill warn" style="margin-top:10px">⚠ Must-haves go ${eur.format(bought + must - budget)} over budget</p>` : ""}
      </div>
      <h2 class="section-title">🛒 Shopping list</h2>
      ${items.length ? items.map(({ id, b, g }) => `<div class="card buy-row ${b.bought ? "done" : ""}">
          <button class="check ${b.bought ? "on" : ""}" data-action="bought" data-game="${esc(id)}" aria-label="Mark bought">${b.bought ? "✓" : ""}</button>
          <div class="tap" data-action="open" data-game="${esc(id)}"><h3 class="game-name">${esc(g.name)}</h3>
            <div class="meta">${hallPill(g)}</div></div>
          <div style="text-align:right"><div class="price">${eur.format(+b.price || 0)}</div>
            <button class="prio ${b.prio === "must" ? "must" : "maybe"}" data-action="prio" data-game="${esc(id)}">${b.prio === "must" ? "must-have" : "maybe"}</button></div>
        </div>`).join("")
        : `<div class="empty"><span class="big">🛍️</span><b>Your buy list is empty</b><p>Open a game and tap “Add to buy list”.</p>
          <button class="btn" data-action="tab" data-tab="games">Browse games</button></div>`}`;
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

  function gameSheet(id) {
    const g = gameById(id); if (!g) return closeSheet();
    const plan = myPlan();
    const buy = plan.buy[g.id];
    const sessions = [...(g.sessions || [])].sort((a, b) => a.day.localeCompare(b.day) || mins(a.start) - mins(b.start));
    const url = safeUrl(g.url);

    openSheet(`
      <h2 id="sheet-title">${esc(g.name)}</h2>
      ${g.publisher ? `<p class="publisher">${esc(g.publisher)}</p>` : ""}
      ${g.sample ? `<p><span class="pill sample">sample data: check booth &amp; times</span></p>` : ""}
      <div class="facts">
        <div class="fact"><small>Hall / booth</small><b>${esc(g.hall || "?")} · ${esc(g.booth || "?")}</b></div>
        <div class="fact"><small>Players</small><b>${esc(g.players || "?")}</b></div>
        <div class="fact"><small>Play time</small><b>${esc(g.duration || "?")}</b></div>
        <div class="fact"><small>Fair price</small><b>${g.price ? eur.format(g.price) : "?"}</b></div>
      </div>
      ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
      ${url ? `<p><a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener">🔗 Game page</a></p>` : ""}

      <h3>🕒 Demo sessions</h3>
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
      }).join("") : `<p class="muted">No sessions listed yet. Edit the game to add times.</p>`}

      <h3>🛒 Buying it?</h3>
      <div class="buybox">
        ${buy ? `<div class="grid2">
            <label class="field">Price (€)<input id="buy-price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(buy.price ?? "")}"></label>
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

  function editSheet(id) {
    const g = id ? gameById(id) : { name: "", sessions: [] };
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
    const g = {
      id, name,
      publisher: String(f.get("publisher")).trim(),
      hall: String(f.get("hall")).trim(),
      booth: String(f.get("booth")).trim(),
      players: String(f.get("players")).trim(),
      duration: String(f.get("duration")).trim(),
      price: priceRaw === "" ? null : Number(priceRaw),
      url: String(f.get("url")).trim(),
      description: String(f.get("description")).trim(),
      sessions,
      updatedAt: Date.now()
    };
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
    const payload = { v: 1, m: db.currentMember, p: myPlan(), g: db.customGames, h: db.hiddenGames };
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
    const n = (data.p.sessions || []).length;
    const isMe = data.m === db.currentMember;
    openSheet(`<h2>${meeple(who.color, 'style="width:32px;height:32px;vertical-align:-6px"')} ${esc(who.name)}'s plan</h2>
      <p>${n} session${n === 1 ? "" : "s"} and ${Object.keys(data.p.buy || {}).length} game${Object.keys(data.p.buy || {}).length === 1 ? "" : "s"} on the buy list.
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
        db.currentMember = el.dataset.member; save();
        $("#sheet").dataset.locked = ""; closeSheet(); render();
        toast(`Hi ${me().name}!`);
        break;
      case "who": pickPlayerSheet(false); break;
      case "open": gameSheet(gid); break;
      case "filter": ui.filter = el.dataset.filter; ui.limit = PAGE; render(); break;
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
      case "unbuy": delete plan.buy[gid]; touch(db.currentMember); render(); refreshSheet(); break;
      case "bought": plan.buy[gid].bought = !plan.buy[gid].bought; touch(db.currentMember); render(); refreshSheet(); break;
      case "prio": plan.buy[gid].prio = plan.buy[gid].prio === "must" ? "maybe" : "must"; touch(db.currentMember); render(); break;
      case "new": editSheet(null); break;
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
        MEMBERS.forEach(m => { const p = db.plans[m.id]; p.sessions = p.sessions.filter(s => !sids.has(s)); delete p.buy[gid]; });
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
        db.plans[data.m] = Object.assign(emptyPlan(), data.p);
        mergeGames(data.g, data.h);
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
        MEMBERS.forEach(m => { const p = db.plans[m.id]; p.sessions = p.sessions.filter(s => valid.has(s)); ids.forEach(id => delete p.buy[id]); });
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

  document.addEventListener("submit", e => {
    if (e.target.id === "game-form") { e.preventDefault(); saveGameForm(e.target); }
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
