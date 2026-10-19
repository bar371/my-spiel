#!/usr/bin/env bash
# Temporary: which BGG endpoints give ratings + vote counts?
UA="my-spiel planner (github.com/bar371/my-spiel)"
for u in "https://api.geekdo.com/api/dynamicinfo?objectid=15817&objecttype=thing" \
         "https://boardgamegeek.com/xmlapi2/thing?id=15817,446453&stats=1" \
         "https://api.geekdo.com/xmlapi2/thing?id=15817,446453&stats=1" \
         "https://boardgamegeek.com/search/boardgame?q=kalypso&nosession=1&showcount=5" \
         "https://api.geekdo.com/api/geekitems?objectid=15817&objecttype=thing&nosession=1"; do
  echo "== $u"; curl -sS -m 30 -A "$UA" -H "Accept: application/json" -w "\n-- HTTP %{http_code} %{content_type}\n" "$u" | head -c 1500; echo
done
