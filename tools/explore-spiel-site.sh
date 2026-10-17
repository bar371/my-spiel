#!/usr/bin/env bash
# Temporary: map spiel-essen.de's exhibitor / novelty pages and any data endpoints behind them.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdir -p out
fetch() { curl -sSL -m 30 -A "$UA" -o "out/$2" -w "%{http_code} %{size_download} %{url_effective}\n" "$1"; }
for u in https://www.spiel-essen.de/ https://www.spiel-essen.de/en/ https://www.spiel-essen.de/sitemap.xml https://www.spiel-essen.de/robots.txt; do
  f=$(echo "$u" | sed 's#https://##; s#[/:]#_#g'); echo "== $u"; fetch "$u" "$f"
done
echo "== links mentioning exhibitors / novelties / hall plan / app"
cat out/* | grep -oiE 'https?://[^"'"'"' <>)]+|href="[^"]+"' | sed 's/^href="//; s/"$//' | grep -iE 'ausstell|exhibit|neuheit|novelt|new-games|hallenplan|hall-plan|floor|app|messe|mapyourshow|expo|catalog|katalog|api|json' | sort -u | head -150
echo "== sitemap urls (filtered)"
grep -oE '<loc>[^<]+' out/*sitemap* 2>/dev/null | sed 's/.*<loc>//' | grep -iE 'ausstell|exhibit|neuheit|novelt|game|spiel' | head -80
