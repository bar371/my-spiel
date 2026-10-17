#!/usr/bin/env bash
# Temporary: find the data behind spiel-essen.de's exhibitor and novelty pages.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdir -p out
fetch() { curl -sSL -m 40 -A "$UA" -o "out/$2" -w "%{http_code} %{size_download} %{content_type} %{url_effective}\n" "$1"; }
for p in en/the-spiel/novelties en/the-spiel/exhibitors en/the-spiel/hall-plans en/the-spiel/spiel-app; do
  f=$(echo "$p" | tr '/' '_').html; echo "== $p"; fetch "https://www.spiel-essen.de/$p" "$f"
  echo "-- iframes / scripts / data urls"
  grep -oiE '<iframe[^>]+>|<script[^>]+src="[^"]+"|data-[a-z-]*(url|src|api|endpoint)[a-z-]*="[^"]+"|https?://[^"'"'"' <>)]*(eyeled|api|json|novelt|neuheit|exhibitor|aussteller|catalog)[^"'"'"' <>)]*' "out/$f" | sort -u | head -40
  echo "-- visible text sample"
  sed 's/<script.*<\/script>//g; s/<[^>]*>/ /g' "out/$f" | tr -s ' \n' | grep -iE 'novelt|exhibit|game|app|eyeled|list|search' | head -15
done
