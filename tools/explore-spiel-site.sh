#!/usr/bin/env bash
# Temporary: find the data URLs used by the EyeLed exhibitor / novelty apps on spiel-essen.de.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdir -p out
for p in en/the-spiel/novelties en/the-spiel/exhibitors; do
  f=$(echo "$p" | tr '/' '_').html
  curl -sSL -m 40 -A "$UA" -o "out/$f" "https://www.spiel-essen.de/$p"
  echo "== $p: eyeled tags"
  grep -oiE '<[^>]*eyeled[^>]*>' "out/$f" | head -10
  for js in $(grep -oE 'https://[a-z.]*eyeled-services\.de/[^"]+\.js' "out/$f" | sort -u); do
    n=$(basename "$js"); curl -sSL -m 60 -A "$UA" -o "out/$n" "$js"; echo "-- $js ($(wc -c < out/$n) bytes)"
    grep -oE '"https?://[^"]{6,200}"|"/[a-zA-Z0-9_./?=&{}-]*(api|json|data|exhib|novel|product|neuheit|aussteller)[a-zA-Z0-9_./?=&{}-]*"|baseURL:[^,]{1,120}|axios\.[a-z]+\("[^"]+"' "out/$n" | sort -u | head -60
  done
done
