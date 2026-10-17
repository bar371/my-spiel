#!/usr/bin/env bash
# Temporary: fetch SPIEL's official novelty and exhibitor lists (the same public requests the
# spiel-essen.de pages make) and summarise them.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
B=https://maps.eyeled-services.de/en/spiel26
mkdir -p out
get() { curl -sS -m 90 -A "$UA" -H "Origin: https://www.spiel-essen.de" -H "Referer: https://www.spiel-essen.de/" -o "out/$2" -w "%{http_code} %{size_download} %{content_type}  $1\n" "$1"; }
get "$B/products" products.json
get "$B/exhibitors" exhibitors.json
get "$B/productFilters" productFilters.json
node -e '
const fs=require("fs"); const rd=f=>{try{return JSON.parse(fs.readFileSync("out/"+f,"utf8"))}catch(e){console.log(f,"not JSON:",fs.readFileSync("out/"+f,"utf8").slice(0,300));return null}};
const P=rd("products.json"), E=rd("exhibitors.json"), F=rd("productFilters.json");
for (const [n,j] of [["products",P],["exhibitors",E],["filters",F]]) if(j) console.log(n,"top keys:",Object.keys(j), "data keys:", j.data&&Object.keys(j.data));
const prods=P&&P.data&&P.data.products||[], ex=E&&E.data&&E.data.exhibitors||[];
console.log("products",prods.length,"exhibitors",ex.length);
console.log("product sample:",JSON.stringify(prods[0]).slice(0,1500));
console.log("exhibitor sample:",JSON.stringify(ex[0]).slice(0,800));
console.log("product keys:",[...new Set(prods.flatMap(p=>Object.keys(p)))].join(","));
console.log("themes:",JSON.stringify((P.data.productThemes||[]).slice(0,40)).slice(0,1500));
if(F) console.log("filters:",JSON.stringify(F.data).slice(0,1500));
const byId=new Map(ex.map(e=>[String(e.ID),e]));
for (const q of ["dungeon crawler","agent avenue","danes","dänen","braided","tag team","container","courtroom","codenames","faraway"]) {
  const hits=prods.filter(p=>JSON.stringify([p.TITEL,p.UNTERTITEL]).toLowerCase().includes(q));
  console.log("## "+q+": "+hits.slice(0,6).map(p=>{const e=byId.get(String(p.FIRMA_ID))||{};return `${p.TITEL} [${e.NAME||"?"} ${p.HALLE||e.HALLE||""} ${p.STAND||e.STAND||""}]`}).join(" ; "));
}'
