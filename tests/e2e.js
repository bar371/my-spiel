// End-to-end check of the planner in headless Chromium.
// Run: python3 -m http.server 8765 & npm i --no-save playwright-core && node tests/e2e.js
// (set CHROMIUM_PATH to a Chromium binary if Playwright has none installed)
const { chromium } = require('playwright-core');
const SP = require('os').tmpdir(), URL = process.env.APP_URL || 'http://localhost:8765/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('spiel26:v1')));
  const text = async s => (await p.locator(s).innerText()).replace(/\u00a0/g, ' ');
  const tab = async t => { await p.click(`.tabbar [data-tab="${t}"]`); };
  const close = () => p.click('.sheet-x');

  console.log('Player picker');
  await p.goto(URL);
  ok(await p.locator('.player').count() === 4, '4 members shown');
  await p.click('.sheet-backdrop', { position: { x: 10, y: 10 } });
  ok(await p.isVisible('#sheet'), 'first-run picker cannot be dismissed');
  await p.click('[data-member="annemike"]');
  ok((await text('#who')).includes('Annemike'), 'header shows Annemike');
  await p.reload();
  ok(!(await p.isVisible('#sheet')) && (await text('#who')).includes('Annemike'), 'player remembered after reload');
  await p.click('#who'); await p.click('[data-member="sjord"]');
  ok((await text('#who')).includes('Sjord'), 'switch player works');
  await p.click('#who'); await p.keyboard.press('Escape');
  ok(!(await p.isVisible('#sheet')), 'Escape closes switch sheet');

  console.log('Countdown & days');
  ok(/6 days to go/.test(await text('#countdown')), 'countdown: ' + await text('#countdown'));
  ok(await p.locator('.day').count() === 4, '4 day tiles');
  ok((await text('.view')).includes('Nothing planned'), 'empty state on schedule');

  console.log('Games: search & filters');
  await tab('games');
  ok(await p.locator('.game-card').count() === 4, '4 sample games');
  await p.fill('#search', 'feuer');
  ok(await p.locator('.game-card').count() === 1 && (await text('.game-card')).includes('Ark Nova'), 'search by publisher');
  await p.type('#search', 'zzz');
  ok(await p.locator('.game-card').count() === 0, 'no-match search');
  ok(await p.evaluate(() => document.activeElement.id) === 'search', 'search keeps focus while typing');
  await p.fill('#search', '');
  await p.click('[data-filter="joining"]');
  ok(await p.locator('.game-card').count() === 0, 'Joining filter empty');
  await p.click('[data-filter="all"]');

  console.log('Join / leave / clash');
  await p.click('[data-game="cascadia"]');
  await p.click('[data-session="cascadia-1"]');
  ok((await db()).plans.sjord.sessions.includes('cascadia-1'), 'join saved');
  await p.click('[data-session="cascadia-1"]');
  ok(!(await db()).plans.sjord.sessions.includes('cascadia-1'), 'leave saved');
  await p.click('[data-session="cascadia-1"]'); await close();
  await p.click('[data-filter="joining"]');
  ok(await p.locator('.game-card').count() === 1, 'Joining filter shows 1');
  await p.click('[data-filter="all"]');

  console.log('Add / edit / validation');
  await p.click('[data-action="new"]');
  await p.fill('[name=name]', 'Clash <b>Test</b> & “Ünïcode”');
  await p.fill('[name=price]', '19.5');
  await p.fill('[name=url]', 'https://example.com/game');
  await p.click('[data-action="add-session"]');
  await p.fill('.sess-edit [name=start]', '11:30'); await p.fill('.sess-edit [name=end]', '11:00');
  await p.click('#game-form button[type=submit]');
  ok(await p.isVisible('#game-form'), 'end-before-start rejected');
  await p.fill('.sess-edit [name=end]', '12:30');
  await p.click('#game-form button[type=submit]');
  ok((await text('#sheet-title')).includes('<b>Test</b>'), 'HTML in names is escaped, not rendered');
  await p.click('#sheet-body [data-action="join"]');
  ok((await text('#sheet-body')).includes('Clashes with Cascadia'), 'clash shown in detail');
  await p.click('[data-action="edit"]');
  await p.fill('[name=hall]', '5'); await p.fill('.sess-edit [name=start]', '13:00'); await p.fill('.sess-edit [name=end]', '14:00');
  await p.click('#game-form button[type=submit]');
  ok(!(await text('#sheet-body')).includes('Clashes'), 'edited time removes clash');
  const gid = (await db()).customGames[0].id;
  ok((await db()).plans.sjord.sessions.length === 2, 'session still joined after edit (same id)');
  await p.click('[data-action="edit"]'); await p.click('[data-action="rm-session"]'); await p.click('#game-form button[type=submit]');
  ok((await db()).plans.sjord.sessions.length === 1, 'removing a session drops it from plans');
  await close();
  // edit a seed game
  await p.click('[data-game="heat"]'); await p.click('[data-action="edit"]');
  await p.fill('[name=booth]', '3-B210'); await p.click('#game-form button[type=submit]');
  ok((await text('#sheet-body')).includes('3-B210'), 'seed game editable');
  await close();
  ok(await p.locator('.game-card').count() === 5, 'no duplicate after editing seed game');

  console.log('Notes');
  await p.click('[data-game="heat"]'); await p.fill('#note', 'bring dice'); await close();
  await p.reload(); await tab('games'); await p.click('[data-game="heat"]');
  ok(await p.inputValue('#note') === 'bring dice', 'note persists after reload');
  await close();

  console.log('Buy list & budget');
  await p.click('[data-game="heat"]'); await p.click('[data-action="buy"]');
  await p.fill('#buy-price', '50'); await p.locator('#buy-price').blur();
  await p.selectOption('#buy-prio', 'maybe');
  await close();
  await p.click(`[data-game="${gid}"]`); await p.click('[data-action="buy"]'); await close();
  await tab('budget');
  ok(await p.locator('.buy-row').count() === 2, '2 items on buy list');
  await p.fill('#budget', '60'); await p.locator('#budget').blur();
  ok((await text('.coins')).includes('60,00'), 'left = 60 before buying');
  await p.click(`[data-action="bought"][data-game="${gid}"]`);
  ok((await text('.coins')).includes('40,50'), 'left = 40.50 after buying 19.50: ' + await text('.coins'));
  await p.click('[data-action="prio"][data-game="heat"]');
  ok((await text('.view')).includes('go 9,50 € over'), 'must-have over-budget warning');
  await p.fill('#budget', '10'); await p.locator('#budget').blur();
  ok(await p.locator('.coins.over').count() === 1, 'over-budget styling');
  await p.click('.buy-row .tap >> nth=0');
  ok(await p.isVisible('#sheet'), 'tapping buy row opens game'); await close();

  console.log('Schedule');
  await tab('schedule'); await p.click('[data-day="2026-10-22"]');
  ok(await p.locator('.slot:not(.free)').count() === 1, 'Thu shows 1 session');
  ok((await text('[data-day="2026-10-22"] .count')) === '1', 'day badge count');
  await p.click('.slot .card.tap'); ok(await p.isVisible('#sheet'), 'timeline card opens game'); await close();

  console.log('Share link round-trip (other device)');
  let shared = null;
  await p.evaluate(() => { navigator.share = undefined; });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await tab('settings'); await p.click('text=Share my plan');
  await p.waitForTimeout(300);
  shared = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (!shared) shared = await p.locator('#sheet textarea').inputValue().catch(() => null);
  ok(shared && shared.includes('#plan='), 'share link produced (' + (shared||'').length + ' chars)');
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const q = await ctx2.newPage(); q.on('pageerror', e => errs.push('dev2: ' + e.message));
  await q.goto(shared); await q.waitForTimeout(300);
  ok((await q.locator('.player').count()) === 4, 'new device: picker first');
  await q.click('[data-member="naomi"]'); await q.waitForTimeout(700);
  ok((await q.locator('#sheet-body').innerText()).includes("Sjord's plan"), 'import prompt after picking');
  await q.click('[data-action="accept-plan"]');
  const d2 = await q.evaluate(() => JSON.parse(localStorage.getItem('spiel26:v1')));
  ok(d2.plans.sjord.sessions.length === 1 && d2.customGames.length === 2, 'Sjord plan + custom games imported');
  ok(q.url().indexOf('#plan') === -1, 'hash cleared after import');
  await q.click('.tabbar [data-tab="games"]');
  ok(await q.locator('.game-card').count() === 5, 'other device sees added game');

  console.log('Backup export / restore');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-action="export"]')]);
  const file = SP + '/backup.json'; await dl.saveAs(file);
  ok(JSON.parse(require('fs').readFileSync(file)).app === 'spiel26', 'backup downloaded');
  await p.click('[data-action="reset"]');
  ok(await p.locator('.player').count() === 4, 'reset → picker shown');
  await p.click('[data-member="bar"]'); await tab('settings');
  await p.setInputFiles('#import', file); await p.waitForTimeout(400);
  ok((await db()).plans.sjord.sessions.length === 1 && (await text('#who')).includes('Bar'), 'restore keeps current player, restores data');
  require('fs').writeFileSync(SP + '/bad.json', '{"nope":1}');
  await p.setInputFiles('#import', SP + '/bad.json'); await p.waitForTimeout(300);
  ok((await text('#toast')).includes("isn't"), 'bad backup rejected');

  console.log('Delete & clear samples');
  await tab('games'); await p.click(`[data-game="${gid}"]`); await p.click('[data-action="delete"]');
  ok(await p.locator('.game-card').count() === 4, 'custom game deleted');
  ok(!(await db()).plans.sjord.buy[gid], 'deleted game removed from buy list');
  await tab('settings'); await p.click('[data-action="clear-samples"]');
  await tab('games');
  ok(await p.locator('.game-card').count() === 0, 'samples cleared');
  await p.reload(); await tab('games');
  ok(await p.locator('.game-card').count() === 0, 'samples stay cleared after reload');

  console.log('Offline (service worker)');
  const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const r = await ctx3.newPage();
  await r.goto(URL); await r.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready);
  await r.reload(); await r.waitForTimeout(800);
  await ctx3.setOffline(true);
  await r.reload(); await r.waitForTimeout(500);
  ok(await r.locator('.player').count() === 4, 'app loads offline');
  await r.click('[data-member="bar"]');
  ok((await r.locator('#who').innerText()).includes('Bar'), 'works offline');

  console.log('Layout');
  for (const w of [320, 390, 768, 1280]) {
    await p.setViewportSize({ width: w, height: 800 });
    for (const t of ['schedule','games','crew','budget','settings']) {
      await tab(t);
      const o = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (o) ok(false, `horizontal overflow at ${w}px on ${t}`);
    }
  }
  ok(true, 'no horizontal overflow at 320/390/768/1280px');

  ok(errs.length === 0, 'no JS errors: ' + JSON.stringify(errs));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})().then(() => process.exit(fail ? 1 : 0)).catch(e => { console.error("CRASH", e.message); process.exit(1); });
