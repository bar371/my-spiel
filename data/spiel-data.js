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
    { id: "sjord",    name: "Sjord",    color: "#d64545" },
    { id: "annemieke", name: "Annemieke", color: "#3a7bd5" },
    { id: "bar",      name: "Bar",      color: "#e8b22d" },
    { id: "naomi",    name: "Naomi",    color: "#3f9c5a" }
  ],

  // Starter list compiled from SPIEL 2026 preview articles (October 2026). Each
  // game links to its source. Booths and demo times are mostly unpublished, so
  // they are left empty: add them in the app (Edit game) or here.
  // The full catalogue can be imported once boardgamegeek.com is reachable.
  games: [
    {"id": "braided-skies", "preview": true, "name": "Braided Skies", "publisher": "Stonemaier Games", "players": "1–5", "duration": "60–90 min", "url": "https://icv2.com/articles/news/view/63451/stonemaier-announces-braided-skies", "description": "Designed by Dan Germain, art by Andrew Bosley, set in the Smoking Bones universe. Each player runs an airship company in the Northlands, competing for fame and the title “Commodore of the Clouds”. On your turn you either deploy one of your three ships to a port or recall all of them. Medium-weight euro with a solo mode (Automa).", "sessions": []},
    {"id": "queen-alice", "preview": true, "name": "Queen Alice", "publisher": "Combo Games", "players": "1–4", "duration": "30–120 min", "url": "https://www.tabletopsentinel.com/news/fantasy/road-to-spiel-2026-queen-alice-checkmate-through-the-looking-glass", "description": "Mid-heavy euro inspired by Lewis Carroll’s Through the Looking-Glass, designed by Héctor Carrión Benavent and David Heras Pino. Chess pieces trigger actions, with their movement tied to a card system (“chess-building”). Crowdfunded on Gamefound; copies may be available at the fair.", "sessions": []},
    {"id": "60-sixty-below", "preview": true, "name": "-60° (Sixty Below)", "publisher": "Nanox Games / dlp games", "booth": "dlp games stand", "players": "1–4", "duration": "120–180 min", "price": 80, "url": "https://www.wericmartin.com/nanox-games-60-alexander-pfister-peter-prinz/", "description": "Alexander Pfister and Peter Prinz head to Antarctica: in an alternate 1971 a meteorite strikes the continent and research teams build stations and race to the impact site. Worker placement, exploration, resource and hand management with push-your-luck. Preorder (about €80) for pickup at the dlp games stand was reported.", "sessions": []},
    {"id": "kingdom-come-deliverance-the-board-game", "preview": true, "name": "Kingdom Come: Deliverance – The Board Game", "publisher": "Czech Games Edition", "players": "1–4", "duration": "90+ min", "url": "https://www.wericmartin.com/chvatil-and-holek-join-forces-for-kingdom-come-deliverance-the-board-game/", "description": "Adaptation of the video game by Tomáš Holek and Vlaada Chvátil. Plays over five in-game days with deck-building and skill tests, with a solo mode. Big box: about €150 retail was reported; release dates vary between Q4 2026 and Q1 2027.", "sessions": []},
    {"id": "medico", "preview": true, "name": "Medico", "publisher": "Hall Games / Pegasus Spiele", "booth": "Pegasus Spiele stand", "players": "2–4", "duration": "60–90 min", "price": 59.99, "url": "https://hallgames.de/en_us/2026/06/13/neuheit-2026-medico/", "description": "Stefan Feld design with art by Dennis Lohausen. You are travelling barbers: each round everyone secretly picks one of seven locations to travel to. Eight or nine rounds; scoring for recipe books, instruments and apprentices. €59.99 retail, at the Pegasus Spiele stand.", "sessions": []},
    {"id": "entropy", "preview": true, "name": "Entropy", "publisher": "Board&Dice", "players": "1–4", "duration": "90–120 min", "url": "https://icv2.com/articles/news/view/61518/board-dice-unveils-entropy", "description": "Sci-fi strategy by Tommaso Battista, Simone Luciani and Nestore Mangone (Barrage). Build solar systems of stars, planets and asteroids, then fill them with life by playing cards. Your scientist moves 1–3 spaces around a rondel; the game ends when two of six main objectives are completed.", "sessions": []},
    {"id": "timespan", "preview": true, "name": "Timespan", "publisher": "Alion (by Dr Ø)", "players": "1–5", "duration": "90 min", "url": "https://frogames.it/en/products/timespan", "description": "Civilization game from the Stone Age to the Space Age by Kenneth Minde and Kristian Amundsen Østby. Worker placement, tech trees and variable player powers across four eras.", "sessions": []},
    {"id": "prague-unseen", "preview": true, "name": "Prague Unseen", "publisher": "Albi (English: Capstone Games)", "players": "1–4", "url": "https://www.tabletopsentinel.com/news/fantasy/road-to-spiel-2026-prague-unseen-rebuilding-the-city-of-a-hundred-spires", "description": "Medium-heavy worker-placement euro set in historic Prague with legendary creatures, by Jindřich Pavlásek, Michal Peichl and Petr Vojtěch. Resource management, influence and four different neighbourhood systems. Release set for 22 October, the fair’s opening day.", "sessions": []},
    {"id": "thessaloniki", "preview": true, "name": "Thessaloniki", "publisher": "Board&Dice", "players": "1–4", "url": "https://boardanddice.com/thessaloniki/", "description": "Strategy game by Federico Pierlorenzi and Daniele Tascini, set in the Tetrarchy-era Roman Empire of the 4th century. Board&Dice’s SPIEL release.", "sessions": []},
    {"id": "carl-von-linn", "preview": true, "name": "Carl von Linné", "publisher": "Pink Troubadour", "hall": "4", "players": "1–4", "duration": "60–120 min", "url": "https://www.tabletopsentinel.com/news/historical/road-to-spiel-2026-carl-von-linne-by-pink-troubadour", "description": "Taxonomy and naturalist discovery game by Michal Peichl (Forestry), the follow-up to Pink Troubadour’s Galileo Galilei. SPIEL preorders were offered.", "sessions": []},
    {"id": "oil-rock", "preview": true, "name": "Oil Rock", "publisher": "Cranio Creations / Intrafin Games", "players": "2–4", "duration": "90 min", "url": "https://www.meeplemountain.com/boardgame/oil-rock/", "description": "Oil-industry strategy game by Marco Piola Caselli.", "sessions": []},
    {"id": "chronocritters", "preview": true, "name": "Chronocritters", "publisher": "Delicious Games", "players": "1–4", "url": "https://mr-boardgames.com/en/news/chronocritters-time-travel-meets-delicious-games/", "description": "Time-travel worker-placement game by Tristan Geeraert, set in 2562 as time and space are tearing apart.", "sessions": []},
    {"id": "greylune", "preview": true, "name": "Greylune", "publisher": "Sorry We Are French (US: Pandasaurus Games)", "url": "https://www.tabletopsentinel.com/news/fantasy/road-to-spiel-2026-greylune-by-sorry-we-are-french", "description": "Expert game from William Attia (Caylus), described as a successor to Spyrium.", "sessions": []},
    {"id": "gunsen-the-battle-for-toshi-ranbo", "preview": true, "name": "Gunsen: The Battle for Toshi Ranbo", "publisher": "Office Dog", "url": "https://www.legendofthefiverings.com/introducing-gunsen-the-battle-for-toshi-ranbo/", "description": "Game set in the Legend of the Five Rings world.", "sessions": []},
    {"id": "lairs", "preview": true, "name": "Lairs", "publisher": "Kids Table Board Gaming", "url": "https://boardgamegeek.com/boardgame/404883/lairs", "description": "Dungeon-crawling game; the Deeper Dungeons expansion is also out.", "sessions": []},
    {"id": "faraway-beyond-the-veil", "preview": true, "name": "Faraway: Beyond the Veil", "publisher": "Catch Up Games", "url": "https://shop.hachetteboardgames.co.uk/products/faraway-beyond-the-veil-expansion", "description": "Expansion for Faraway (base game required): adds 13 Spirit cards, shared objectives and new scoring modes.", "sessions": []},
    {"id": "cascadia-alpine-lakes", "preview": true, "name": "Cascadia: Alpine Lakes", "publisher": "Flatout Games", "players": "1–4", "duration": "30–45 min", "url": "https://www.meeplemountain.com/articles/most-anticipated-games-of-essen-spiel/", "description": "Standalone follow-up to Cascadia by Randy Flynn, adding height, larger tiles and new ways to score.", "sessions": []},
    {"id": "villa", "preview": true, "name": "Villa", "publisher": "DV Games", "players": "2–4", "url": "https://www.wericmartin.com/dv-games-raindrops-cucumbers-villa-sensu-combo-creatures/", "description": "Spatial tile-laying game about arranging hedges in the garden of your Italian villa.", "sessions": []},
    {"id": "fomo-foragers-of-mechanical-oddities", "preview": true, "name": "FOMO: Foragers of Mechanical Oddities", "publisher": "Esper Game Studio", "players": "3–5", "duration": "20–30 min", "url": "https://www.esper.games/fomo-en", "description": "Bidding game for mysterious mecha parts, where not every reward is a good one.", "sessions": []},
    {"id": "snowy-tricks", "preview": true, "name": "Snowy Tricks", "publisher": "Jolly Dutch Productions", "url": "https://www.meeplemountain.com/articles/most-anticipated-games-of-essen-spiel/", "description": "Trick-taking game said to have more in common with Torchlit than with Spades or Hearts.", "sessions": []},
    {"id": "foundation", "preview": true, "name": "Foundation", "publisher": "CREARDO", "url": "https://www.meeplemountain.com/articles/most-anticipated-games-of-essen-spiel/", "description": "Game based on Isaac Asimov’s Foundation, designed by Mirko Bazzoli.", "sessions": []},
    {"id": "kano", "preview": true, "name": "Kano", "url": "https://boardgamereview.co.uk/features/top-10-games-im-excited-for-at-spiel-essen-2026/", "description": "Pattern building, set collection and tile placement.", "sessions": []},
    {"id": "excursions", "preview": true, "name": "Excursions", "players": "up to 6", "url": "https://boardgamereview.co.uk/features/top-10-games-im-excited-for-at-spiel-essen-2026/", "description": "More accessible game with artwork by Ian O’Toole, for up to six players.", "sessions": []},
    {"id": "meow-heist", "preview": true, "name": "Meow Heist", "url": "https://boardgamereview.co.uk/game-reviews/meow-heist-card-game-review/", "description": "Card game: match a number to steal the gems from whoever most recently revealed it. Debuting at SPIEL.", "sessions": []},
    {"id": "grizzo", "preview": true, "name": "Grizzo", "hall": "8", "url": "https://boardgamereview.co.uk/features/top-10-games-im-excited-for-at-spiel-essen-2026/", "description": "On Board Game Review’s SPIEL 2026 list (Hall 8).", "sessions": []},
    {"id": "forest-shuffle-smoky-mountains", "preview": true, "name": "Forest Shuffle: Smoky Mountains", "publisher": "Lookout Games", "hall": "3", "booth": "3V300", "url": "https://www.spiel-essen.de/en/news", "description": "New Forest Shuffle title shown at Lookout Games’ main stand.", "sessions": []},
    {"id": "syncanite-foundation", "preview": true, "name": "Syncanite Foundation", "publisher": "Syncanite Games", "hall": "3", "booth": "N510", "url": "https://www.spiel-essen.de/en/news", "description": "Debut title from Syncanite Games, released at the fair.", "sessions": []},
    {"id": "dashin-dinos", "preview": true, "name": "Dashin' Dinos", "publisher": "Arcane Wonders", "url": "https://www.arcanewonders.com/spiel-essen-2026/", "description": "Listed by Arcane Wonders as a SPIEL Essen pickup.", "sessions": []},
    {"id": "got-your-goat", "preview": true, "name": "Got Your Goat", "publisher": "Arcane Wonders", "url": "https://www.arcanewonders.com/spiel-essen-2026/", "description": "Listed by Arcane Wonders as a SPIEL Essen pickup.", "sessions": []},
    {"id": "bologna", "preview": true, "name": "Bologna", "players": "2", "url": "https://www.tlamagames.com/en/essen-2026-novalties/", "description": "Two-player strategy: Bologna, the city of towers, torn between Guelfs and Ghibellines competing for influence and the favour of the podestà.", "sessions": []},
    {"id": "lost-ruins-of-arnak-surprise-shipment", "preview": true, "name": "Lost Ruins of Arnak: Surprise Shipment", "publisher": "Czech Games Edition", "url": "https://www.tlamagames.com/en/essen-2026-novalties/", "description": "Arnak add-on tagged as an Essen 2026 release: venture deeper into the jungle.", "sessions": []},
    {"id": "wingspan-pocket", "preview": true, "name": "Wingspan Pocket", "publisher": "Stonemaier Games", "players": "1–5", "duration": "25–35 min", "url": "https://stonemaiergames.com/games/wingspan/wingspan-pocket/", "description": "Standalone compact Wingspan: activate just one row of cards per turn. Already released in summer 2026, so likely at the Stonemaier/retailer stands.", "sessions": []}
  ]
};
