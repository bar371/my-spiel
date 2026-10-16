# SPIEL '26 Planner 🎲

A small planner for our crew (Sjord, Annemieke, Bar and Naomi) at **SPIEL Essen 2026**
(Messe Essen, Thu 22 – Sun 25 October 2026).

- **My day**: a timeline of the demo sessions you've joined, day by day, with free gaps and clash warnings.
- **Games**: every game we're tracking with publisher, hall/booth, players, play time, price, description, a link, and its session times. Tap a game to join a session, add it to your buy list, or write notes.
- **Crew**: *Who's going where*: day by day, every session anyone has joined, with everyone's meeples and a 🤝 badge when you're going together. Updates live once crew sync is on.
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
| Your sessions, buy list, budget, notes, games added in the app | the phone's `localStorage`, mirrored to the crew's live database when crew sync is on |

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

The four `sample: true` games are placeholders (booths and times are made up).
Delete them from the file, or tap **More → Remove sample games** in the app.

## Testing

`tests/e2e.js` drives the app in headless Chromium through 53 checks: player pick, search and filters,
join, leave and clashes, add, edit and delete, notes, budget maths, share-link import, backup and restore,
offline mode, and layout from 320px to desktop.

```sh
python3 -m http.server 8765 &
npm i --no-save playwright-core
node tests/e2e.js        # the app on one phone
node tests/sync-e2e.js   # live crew sync across several phones, against tests/mock-firebase.js
```
