# SPIEL '26 Planner 🎲

A small planner for our crew (Sjord, Annemike, Bar and Naomi) at **SPIEL Essen 2026**
(Messe Essen, Thu 22 – Sun 25 October 2026).

- **My day**: a timeline of the demo sessions you've joined, day by day, with free gaps and clash warnings.
- **Games**: every game we're tracking with publisher, hall/booth, players, play time, price, description, a link, and its session times. Tap a game to join a session, add it to your buy list, or write notes.
- **Crew**: what everyone has planned, and the sessions two or more of us are joining together.
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
| Your sessions, buy list, budget, notes, games added in the app | the browser's `localStorage` on each device |

To combine plans, each person taps **Share** (Crew or More tab) and sends the link to the group.
Opening the link imports that person's plan, so their meeple shows on shared sessions.
**Download backup** saves everything on a device as a JSON file.

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
node tests/e2e.js
```
