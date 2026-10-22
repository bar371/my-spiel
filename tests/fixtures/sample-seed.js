// Test fixture: the original sample seed (fake booths and session times) that the e2e tests rely on.
/*
 * Seed "database" for the SPIEL '26 planner.
 *
 * Edit this file (and push to main) to change the shared starting data that
 * everybody sees. Personal picks, budgets and games added in the app are
 * stored on each device and can be shared with "Share my plan".
 *
 * Session `day` values must be one of the fair days below (the days we attend;
 * the fair itself also runs on Sunday 25 October).
 */
window.SPIEL_SEED = {
  version: 1,
  fair: {
    name: "SPIEL Essen 2026",
    venue: "Messe Essen, Germany",
    days: [
      { date: "2026-10-22", label: "Thu", open: "10:00", close: "19:00" },
      { date: "2026-10-23", label: "Fri", open: "10:00", close: "19:00" },
      { date: "2026-10-24", label: "Sat", open: "10:00", close: "19:00" }
    ]
  },

  members: [
    { id: "sjord",    name: "Sjoerd",   color: "#d64545" },
    { id: "annemieke", name: "Annemieke", color: "#3a7bd5" },
    { id: "bar",      name: "Bar",      color: "#e8b22d" },
    { id: "naomi",    name: "Naomi",    color: "#3f9c5a" }
  ],

  tags: ["Engine building", "Drafting", "Tile laying", "Co-op", "Dice", "Puzzle", "Card game", "2 players", "6+ players", "Long (2h+)"],

  exhibitors: [
    { name: "Flatout Games", hall: "3", booth: "3-A100" },
    { name: "TLAMA games", hall: "2", booth: "2-C145", more: ["2-C150"] }
  ],
  otherLanguage: [
    { name: "Kaskadien", publisher: "Kosmos", langs: ["de"], hall: "7", booth: "7-E311" }
  ],
    notAtFair: [
    { name: "Firesiege", publisher: "Deer Games Studio", why: "Not on SPIEL's novelty list.", url: "https://example.com/firesiege" },
    { name: "Gloomy Gardens", publisher: "Nobody Games", src: "bgg" }
  ],

  // Sample games so the app isn't empty on first launch. Booths and session
  // times are placeholders: replace them with real ones once the hall plan
  // is out, or delete them from the Settings tab.
  games: [
    {
      id: "cascadia",
      langs: ["en", "de"],
      spiel: 101,
      otherBooths: ["7-E100"],
      tags: ["Drafting", "Tile laying", "Puzzle"],
      sample: true,
      name: "Cascadia",
      publisher: "Flatout Games / AEG",
      hall: "TBD",
      booth: "TBD",
      players: "1–4",
      duration: "30–45 min",
      price: 40,
      url: "https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=Cascadia",
      description:
        "Tile-laying and token-drafting game about building the Pacific Northwest. Draft habitat tiles and wildlife tokens, and score patterns for bears, elk, salmon, hawks and foxes.",
      sessions: [
        { id: "cascadia-1", day: "2026-10-22", start: "11:00", end: "12:00", location: "Demo table", note: "Sample time" },
        { id: "cascadia-2", day: "2026-10-24", start: "15:00", end: "16:00", location: "Demo table", note: "Sample time" }
      ]
    },
    {
      id: "ark-nova",
      rating: 8.5,
      votes: 52000,
      preview: true,
      tags: ["Engine building", "Card game", "Long (2h+)"],
      sample: true,
      name: "Ark Nova",
      publisher: "Feuerland Spiele",
      hall: "TBD",
      booth: "TBD",
      players: "1–4",
      duration: "90–150 min",
      price: 60,
      url: "https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=Ark+Nova",
      description:
        "Plan and build a modern, scientifically managed zoo. Card-driven engine building with animal enclosures, conservation projects and a tight action-strength system.",
      sessions: [
        { id: "ark-nova-1", day: "2026-10-22", start: "13:30", end: "15:30", location: "Demo table", note: "Sample time" },
        { id: "ark-nova-2", day: "2026-10-23", start: "10:30", end: "12:30", location: "Demo table", note: "Sample time" }
      ]
    },
    {
      id: "heat",
      tags: ["Card game", "6+ players"],
      sample: true,
      name: "Heat: Pedal to the Metal",
      publisher: "Days of Wonder",
      hall: "TBD",
      booth: "TBD",
      players: "1–6",
      duration: "30–60 min",
      price: 55,
      url: "https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=Heat+Pedal+to+the+Metal",
      description:
        "Classic-era motorsport racing. Manage your hand of speed cards and your engine's heat to push through the corners without spinning out.",
      sessions: [
        { id: "heat-1", day: "2026-10-23", start: "14:00", end: "15:00", location: "Demo table", note: "Sample time" },
        { id: "heat-2", day: "2026-10-24", start: "12:00", end: "13:00", location: "Demo table", note: "Sample time" }
      ]
    },
    {
      id: "sky-team",
      rating: 8.0,
      votes: 9000,
      tags: ["Co-op", "Dice", "2 players"],
      sample: true,
      name: "Sky Team",
      publisher: "Le Scorpion Masqué",
      hall: "6",
      booth: "6-K300",
      players: "2",
      duration: "15 min",
      price: 30,
      url: "https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=Sky+Team",
      description:
        "Cooperative two-player dice game: pilot and co-pilot try to land a plane safely, placing dice in secret without talking about them.",
      sessions: [
        { id: "sky-team-1", day: "2026-10-24", start: "10:30", end: "11:00", location: "Demo table", note: "Sample time" },
        { id: "sky-team-2", day: "2026-10-23", start: "16:00", end: "16:30", location: "Demo table", note: "Sample time" }
      ]
    }
  ]
};
