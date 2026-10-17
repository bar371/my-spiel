#!/usr/bin/env bash
# Temporary: find the novelties / exhibitors request paths and fetch a sample.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdir -p out
curl -sSL -m 60 -A "$UA" -o out/products.js https://spiel.eyeled-services.de/products26/js/app.b1f802a9.js
curl -sSL -m 60 -A "$UA" -o out/exhibitors.js https://spiel.eyeled-services.de/exhibitors26/js/app.732137e1.js
for f in products exhibitors; do
  for k in 'backendUrl+' 'backendUrl}' '.backendUrl' 'Ou.project' 'e.data.products' 'e.data.exhibitors' '/api/' 'json'; do
    echo "== $f: $k"
    grep -obF "$k" out/$f.js | head -4 | while IFS=: read off _; do s=$((off>400?off-400:0)); dd if=out/$f.js bs=1 skip=$s count=700 2>/dev/null | tr '\n' ' '; echo; echo ---; done
  done
done
