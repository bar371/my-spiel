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
const fs=require("fs"); const rd=f=>JSON.parse(fs.readFileSync("out/"+f,"utf8"));
const P=rd("products.json"), E=rd("exhibitors.json"), F=rd("productFilters.json");
const prods=P.products||[], ex=E.exhibitors||[], themes=P.productThemes||[];
console.log("products",prods.length,"exhibitors",ex.length,"productThemes",themes.length,"path",P.path,"picturePath",P.picturePath);
console.log("product keys:",[...new Set(prods.flatMap(p=>Object.keys(p)))].join(","));
console.log("exhibitor keys:",[...new Set(ex.flatMap(p=>Object.keys(p)))].join(","));
const short=o=>JSON.stringify(o,(k,v)=>typeof v==="string"&&v.length>200?v.slice(0,200)+"…":v);
console.log("product sample 1:",short(prods[0]).slice(0,2500));
console.log("product sample 2:",short(prods[Math.floor(prods.length/2)]).slice(0,2500));
console.log("exhibitor sample:",short(ex[0]).slice(0,1200));
console.log("theme sample:",short(themes.slice(0,8)).slice(0,1500));
for (const k of Object.keys(F)) console.log("filter",k,":",short(F[k]).slice(0,700));
const byId=new Map(ex.map(e=>[String(e.ID),e]));
for (const q of ["dungeon crawler","agent avenue","danes","dänen","braided","tag team","container","courtroom","codenames","faraway"]) {
  const hits=prods.filter(p=>JSON.stringify([p.TITEL,p.UNTERTITEL]).toLowerCase().includes(q));
  console.log("## "+q+" ("+hits.length+"): "+hits.slice(0,6).map(p=>{const e=byId.get(String(p.FIRMA_ID))||{};return `${p.TITEL}${p.UNTERTITEL?" – "+p.UNTERTITEL:""} [${e.NAME||"?"} | ${p.HALLE||e.HALLE||""} ${p.STAND||e.STAND||""}]`}).join(" ; "));
}'
