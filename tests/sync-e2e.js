// Live crew sync: several "phones" against a mock Firebase.
// Run: python3 -m http.server 8765 & npm i --no-save playwright-core && node tests/sync-e2e.js
const { chromium } = require("playwright-core");
const startMock = require("./mock-firebase");
const APP = process.env.APP_URL || "http://localhost:8765/";
const DBURL = "http://localhost:8766";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
const norm = s => s.replace(/ /g, " ");

(async () => {
  const mock = await startMock(8766);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errs = [];
  async function phone(name) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ctx.route("**/data/sync-config.js", r => r.fulfill({ contentType: "application/javascript", body: `window.SPIEL_SYNC = { databaseURL: "${DBURL}" };` }));
    await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "share", { value: undefined }); } catch (_) {} });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${name}: ${e.message}`));
    p.on("dialog", d => d.accept());
    p.ctx = ctx;
    return p;
  }
  const tab = (p, t) => p.click(`.tabbar [data-tab="${t}"]`);
  const crewText = async (p, day = "2026-10-22") => { await tab(p, "crew"); await p.click(`[data-day="${day}"]`); return norm(await p.locator("#view").innerText()); };
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

  console.log("Start a crew (Bar)");
  const A = await phone("A");
  await A.goto(APP); await A.click('[data-member="bar"]');
  await tab(A, "settings");
  ok((await A.locator("text=Start a crew").count()) === 1, "More tab offers Start a crew");
  await A.click('[data-action="crew-new"]');
  await A.waitForTimeout(300);
  const invite = await A.evaluate(() => navigator.clipboard.readText());
  ok(/#crew=[a-z0-9]{12}$/.test(invite), "invite link copied: " + invite.replace(APP, ""));
  ok(await until(async () => (await A.locator("#countdown").innerText()).includes("live")), "header shows live");

  console.log("Join via invite (Naomi)");
  const B = await phone("B");
  await B.goto(invite.replace("http://localhost:8765/", APP));
  await B.click('[data-member="naomi"]');
  ok(await until(async () => (await B.locator("#countdown").innerText()).includes("live")), "Naomi's phone is live");
  ok(!B.url().includes("#crew"), "invite hash cleared");

  console.log("Live session visibility");
  await tab(A, "games"); await A.click('[data-game="cascadia"]'); await A.click('[data-session="cascadia-1"]'); await A.click(".sheet-x");
  ok(await until(async () => (await crewText(B)).includes("Cascadia")), "Naomi sees Bar's Cascadia session on Thu");
  ok((await crewText(B)).includes("Bar"), "…with Bar's name");
  await tab(B, "games"); await B.click('[data-game="cascadia"]');
  ok(await until(async () => norm(await B.locator("#sheet-body").innerText()).includes("Bar")), "game detail lists Bar on the session");
  await B.click('[data-session="cascadia-1"]'); await B.click(".sheet-x");
  ok(await until(async () => { const t = await crewText(A); return t.includes("together") && t.includes("Bar, Naomi"); }), "Bar sees 'together' with Naomi");

  console.log("Shared games");
  await tab(B, "games"); await B.click('[data-action="new"]');
  await B.fill("[name=name]", "Crew Game");
  await B.click('[data-action="add-session"]');
  await B.selectOption(".sess-edit select[name=day]", "2026-10-23");
  await B.fill(".sess-edit [name=start]", "15:00"); await B.fill(".sess-edit [name=end]", "16:00");
  await B.click("#game-form button[type=submit]"); await B.click("#sheet-body [data-action=join]"); await B.click(".sheet-x");
  ok(await until(async () => (await crewText(A, "2026-10-23")).includes("Crew Game")), "Bar sees Naomi's new game + session on Fri");
  await A.click(".going.tap >> text=Crew Game"); await A.click("#sheet-body [data-action=join]");
  ok(await until(async () => (await crewText(B, "2026-10-23")).includes("Bar, Naomi")), "Naomi sees Bar join her game");
  await A.click(".sheet-x").catch(() => {});

  console.log("Typing isn't interrupted by remote updates");
  await tab(A, "games"); await A.fill("#search", "casc");
  await tab(B, "games"); await B.click('[data-game="heat"]'); await B.click('[data-session="heat-1"]'); await B.click(".sheet-x");
  await A.waitForTimeout(800);
  ok(await A.evaluate(() => document.activeElement.id === "search" && document.activeElement.value === "casc"), "search keeps focus and text");
  await A.locator("#search").blur();
  ok(await until(async () => (await A.locator(".game-card").count()) === 1), "list still filtered after deferred refresh");

  console.log("Delete for everyone");
  await tab(A, "games"); await A.fill("#search", "Crew Game"); await A.click(".game-card"); await A.click('[data-action="delete"]');
  ok(await until(async () => { await tab(B, "games"); await B.fill("#search", "Crew Game"); return (await B.locator(".game-card").count()) === 0; }), "deleted game disappears on Naomi's phone");
  await B.fill("#search", "");

  console.log("Offline edits catch up");
  await B.ctx.setOffline(true);
  await tab(B, "games"); await B.click('[data-game="cascadia"]'); await B.click('[data-session="cascadia-1"]'); await B.click(".sheet-x");
  await A.waitForTimeout(1000);
  ok((await crewText(A)).includes("Bar, Naomi"), "while Naomi is offline, Bar still sees the old plan");
  await B.ctx.setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event("online")));
  ok(await until(async () => { const t = await crewText(A); return t.includes("Cascadia") && !t.includes("Bar, Naomi"); }, 8000), "after reconnect Bar sees Naomi left");

  console.log("An old phone can't overwrite newer data");
  const C = await phone("C");
  await C.goto(APP);
  await C.evaluate(() => localStorage.setItem("spiel26:v1", JSON.stringify({ currentMember: "sjord", plans: { bar: { sessions: [], buy: {}, budget: 0, notes: {}, updatedAt: 1 } } })));
  await C.goto(invite.replace("http://localhost:8765/", APP + "?fresh=1"));  // full reload so the stored data is read
  ok(await until(async () => (await crewText(C)).includes("Bar")), "stale phone adopts Bar's newer plan");
  const serverBar = (mock.dump().crews[invite.split("#crew=")[1]].plans.bar.sessions || []);
  ok(serverBar.includes("cascadia-1"), "server still has Bar's Cascadia session");

  console.log("Leave crew");
  await tab(C, "settings"); await C.click('[data-action="crew-leave"]');
  ok((await C.locator("text=Start a crew").count()) === 1, "after leaving, offers Start a crew again");
  ok(!(await C.locator("#countdown").innerText()).includes("live"), "no live badge");

  console.log("Join by pasting a code");
  const D = await phone("D");
  await D.goto(APP); await D.click('[data-member="annemieke"]'); await tab(D, "settings");
  await D.fill("#crew-join [name=code]", "bad code!"); await D.click("#crew-join button");
  ok(norm(await D.locator("#toast").innerText()).includes("doesn't look right"), "invalid code rejected");
  await D.fill("#crew-join [name=code]", invite); await D.click("#crew-join button");
  ok(await until(async () => (await crewText(D)).includes("Cascadia")), "pasted invite link joins the crew");

  ok(errs.length === 0, "no JS errors " + JSON.stringify(errs));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); mock.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
