#!/usr/bin/env bash
# Temporary: see how the EyeLed novelties app calls getDumps.php
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdir -p out
curl -sSL -m 60 -A "$UA" -o out/products.js https://spiel.eyeled-services.de/products26/js/app.b1f802a9.js
curl -sSL -m 60 -A "$UA" -o out/index.html https://spiel.eyeled-services.de/products26/
echo "== products26 index"; head -c 1500 out/index.html; echo
for k in getDumps baseURL 'products26/' 'pics/spiel26' 'dumpName\|dump:' '\.php'; do
  echo "== context: $k"
  grep -ob "$k" out/products.js | head -6 | while IFS=: read off _; do s=$((off>500?off-500:0)); dd if=out/products.js bs=1 skip=$s count=1100 2>/dev/null | tr '\n' ' '; echo; echo ---; done
done
