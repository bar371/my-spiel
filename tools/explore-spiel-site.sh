#!/usr/bin/env bash
# Temporary: snapshot SPIEL's official novelty + exhibitor lists (compact) for local development.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
B=https://maps.eyeled-services.de/en/spiel26
mkdir -p out dev-snapshot
for n in products exhibitors productFilters; do curl -sS -m 90 -A "$UA" -H "Referer: https://www.spiel-essen.de/" -o "out/$n.json" "$B/$n"; done
node -e '
const fs=require("fs"); const rd=f=>JSON.parse(fs.readFileSync("out/"+f,"utf8"));
const P=rd("products.json"), E=rd("exhibitors.json"), F=rd("productFilters.json");
const strip=s=>String(s||"").replace(/<\/(td|tr|p|li)>/gi," | ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
const products=P.products.map(p=>({ID:p.ID,TITEL:p.TITEL,UNTERTITEL:p.UNTERTITEL,FIRMA_ID:p.FIRMA_ID,HALLE:p.HALLE,STAND:p.STAND,STAENDE:(p.STAENDE||[]).map(s=>[s.HALLE,s.NAME]),WEB:p.WEB,THEMEN:p.THEMEN,INFO:strip(p.INFO).slice(0,900)}));
const exhibitors=E.exhibitors.map(e=>({ID:e.ID,NAME:e.NAME,HALLE:e.HALLE,STAND:e.STAND,STAENDE:(e.STAENDE||[]).map(s=>[s.HALLE,s.NAME]),WEB:e.WEB,LAND:e.LAND}));
const themes=Object.fromEntries((P.productThemes||[]).map(t=>[t.ID,t.TITEL]));
fs.writeFileSync("dev-snapshot/spiel26.json",JSON.stringify({fetched:new Date().toISOString(),themes,filters:F,products,exhibitors}));
console.log("snapshot", products.length, exhibitors.length, fs.statSync("dev-snapshot/spiel26.json").size);'
