# SPIEL '26 Planner 🎲

A small planner for our crew (Sjoerd, Annemieke, Bar and Naomi) at **SPIEL Essen 2026**
(Messe Essen, Thu 22 – Sun 25 October 2026).

- **My day**: a time grid of your day: demo sessions you've joined (fixed times 🔒) and booth visits you've planned. Drag a visit by its ⠿ grip to move it, or by its bottom edge to change its length (15-minute steps, mouse or touch). Clashes are outlined in red, and **Fix clashes** moves overlapping visits to the next free time.
- **Games**: every game we're tracking with publisher, hall/booth, players, play time, price, description, a link, and its session times. Tap a game to join a demo session, **plan a booth visit** (any game, no demo needed: pick a day, start and length; it suggests your next free slot), add it to your buy list, or write notes.
- **Favorites**: tap ☆ on any game to mark one you like, even if you won't plan it. **★ Favorites** filters the list, and the Crew tab shows the crew's favorites, most-liked first.
- **Crew**: *Who's going where*: day by day, every demo session and booth visit anyone has planned, with everyone's meeples and a 🤝 badge when you're going together. Updates live once crew sync is on.
- **Budget**: set your budget, mark games must-have or maybe, tick them off when bought, and see what's left.
- **More**: switch player, share your plan, back up or restore, and install instructions.

It's a single static page (HTML, CSS and plain JS, with no build step) that works offline once loaded.

## Running it

- **Locally:** open `index.html` in a browser, or run `python3 -m http.server` and visit http://localhost:8000.
- **Online:** every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
  One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
  The site is then at `https://bar371.github.io/my-spiel/`.

## Installing on iPhone / iPad

1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen**.

It launches full-screen with its own icon, like an app, and keeps working offline.
No App Store or Xcode needed.

## Where data lives

| What | Where |
| --- | --- |
| Members, fair days, the shared game list | `data/spiel-data.js` (edit and push to `main` to update everyone) |
| Your sessions, booth visits, buy list, budget, notes, games added in the app | the phone's `localStorage`, mirrored to the crew's live database when crew sync is on |

## Live crew sync (Firebase, one-time setup, about 5 minutes)

So everyone sees who's going to which session, the app syncs through a free
[Firebase Realtime Database](https://firebase.google.com/docs/database). There's no server to run.

1. Go to <https://console.firebase.google.com>, choose **Create a project** (any name, e.g. `spiel26-crew`), and switch Google Analytics off.
2. In the project, open **Build → Realtime Database → Create Database**. Pick **Belgium (europe-west1)** and **Start in locked mode**.
3. Open the **Rules** tab, replace everything with the rules below, and click **Publish**:

   ```json
   {
     "rules": {
       "crews": {
         "$crew": {
           ".read": "$crew.length >= 10",
           ".write": "$crew.length >= 10"
         }
       }
     }
   }
   ```

4. Copy the database URL from the **Data** tab (it looks like `https://spiel26-crew-default-rtdb.europe-west1.firebasedatabase.app`)
   and put it in `data/sync-config.js` as `databaseURL`. Push to `main`.
5. In the app: **More → Live crew sync → Start a crew**, then send the invite link to the others.
   Opening the link joins the crew. A crew code can also be pasted under **More**.

Notes:
- The crew code is a random 12-character key that only travels in the invite link. Anyone with the link can see and edit the crew's plans, so share it only with the crew.
  The database can't be listed, so nobody can find your crew without the code.
- Each phone keeps working offline and catches up when it's back online. When two phones change the same thing, the newer change wins.
- Before crew sync is set up, **Share my plan** still sends your plan as a one-off link.

### Adding a game to the shared list

Add an entry to `games` in `data/spiel-data.js`:

```js
{
  id: "my-game",                 // unique, never reuse
  name: "My Game",
  publisher: "Some Publisher",
  hall: "3", booth: "3-B210",
  players: "2–4", duration: "60 min",
  price: 45,
  url: "https://boardgamegeek.com/boardgame/…",
  description: "…",
  sessions: [
    { id: "my-game-1", day: "2026-10-23", start: "11:00", end: "12:00", location: "Table 4", note: "" }
  ]
}
```

The shared list comes from two sources plus hand-picked games:

1. **SPIEL's official novelty list** (spiel-essen.de → The SPIEL → Novelties, about 1,900 games). It is read from the
   same public data the SPIEL website uses (`maps.eyeled-services.de/en/spiel26/products` and `/exhibitors`) and gives the
   official hall and booth, extra booths (`otherBooths`), players, play time, retail price and the exhibitor's mechanisms
   and categories. These games have `spiel: <id>` and the **✅ SPIEL list** chip.
2. **BoardGameGeek's SPIEL 2026 preview** (boardgamegeek.com/geekpreviewv2/93), for BGG links and tags and for games the
   official list doesn't have (`bgg: <id>`). A BGG listing without a booth gets its publisher's stand from the official
   exhibitor list (shown as "publisher's stand", `boothFrom: "publisher"`); listings with no booth anywhere are left out.
3. **33 picks from preview articles** (`preview: true`, each linking to its source), kept as written; the sources only fill
   their empty fields, except the booth, which the official list always sets.

Only games are listed: no accessories, playmats, sleeves, dice sets or gaming tables (the official "Game accessories" category, BGG accessory listings and `NON_GAME` titles in the importer). Only English editions are listed (plus language-independent games) (`langs` on each official game).
Editions only in other languages, mostly German, are kept in `SPIEL_SEED.otherLanguage` and show up under
**🌍 Only in other languages** when you search for them. BGG has no language field, so BGG listings with a German
title (`GERMAN_TITLE` in the importer) go there too.

Searching tells three cases apart: the game is in the list; we know it but it isn't expected at SPIEL (**🚫 Known, but
not expected at SPIEL**, with the reason: `SPIEL_SEED.notAtFair`, from BGG listings without any stand and from
`MANUAL_NOT_AT_FAIR` in the importer); or none of the sources know it (**🤷 We don't know …**). Search also lists matching
exhibitors from SPIEL's official exhibitor list (`SPIEL_SEED.exhibitors`) with their stands, so a publisher's name tells
you whether they're at the fair.

Demo times are unpublished, so add them with **Edit game** in the app (shared with the crew when sync is on) or in this file.

To refresh the list, run the **Import SPIEL games** workflow (Actions tab), or locally `node tools/import-games.js`
(`--skip-bgg` to only refresh the official list).

Every game has `tags` for the type filter in the Games tab (Engine building, Deck building, Worker placement,
PvP / conflict, Co-op, Trick-taking, Party, Solo, Quick, Beginner / Connoisseur / Expert, …; the chip order is
`SPIEL_SEED.tags`). The importer derives them from the official mechanisms, categories and level, from BGG's
mechanics, categories and subdomains, from keywords in the description, and from `MANUAL_TAGS` in
`tools/import-games.js`. Selecting several tags shows games that have all of them. Three extra chips come first:
**✅ SPIEL list**, **📰 Preview** (the preview-article games) and **🎲 Demo slot** (games with at least one demo session,
including ones added in the app). Tags can also be changed per game with **Edit game**.
The tests use their own sample data in `tests/fixtures/sample-seed.js`.

## Testing

`tests/e2e.js` drives the app in headless Chromium through 106 checks: player pick, search and filters,
join, leave and clashes, add, edit and delete, notes, budget maths, share-link import, backup and restore,
offline mode, and layout from 320px to desktop.

```sh
python3 -m http.server 8765 &
npm i --no-save playwright-core
node tests/e2e.js        # the app on one phone
node tests/sync-e2e.js   # live crew sync across several phones, against tests/mock-firebase.js
```
