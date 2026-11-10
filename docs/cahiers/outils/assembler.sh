#!/bin/sh
# Assemblage final des cahiers (sections 307-317) : repart des PDF du dépôt, applique les corrections
# (corrections-A.json + corrections-B.json, scissions comprises), ajoute les pages « Mise à jour »,
# régénère l'aide-mémoire. N'écrit que dans W/final.
set -e
W="$(cd "$(dirname "$0")" && pwd)"
REPO="C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance/docs/cahiers"
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
cd "$W"
rm -rf final && mkdir -p final/origine final/sortie final/controle
cp "$REPO"/Cahier_*.pdf "$REPO"/Aide_memoire.pdf final/origine/
node -e '
const fs=require("fs");
const a=JSON.parse(fs.readFileSync("sortie-A/corrections-A.json","utf8"));
const b=JSON.parse(fs.readFileSync("sortie-B/corrections-B.json","utf8"));
fs.writeFileSync("final/corrections-final.json",JSON.stringify({...a,...b},null,1));
console.log("corrections :",Object.entries({...a,...b}).map(([k,v])=>k+" "+v.length).join(", "));'
python -I outils_cahiers.py appliquer-tout final/origine final/corrections-final.json final/sortie
for f in maj-Cahier_*.html; do
  c=$(echo "$f" | sed -E 's/maj-(Cahier_[0-9]).*/\1/')
  python -I outils_cahiers.py ajouter-page "final/sortie/$c.pdf" "final/sortie/$c.pdf" "$f"
done
# Aide-mémoire : envelopper la source modifiée et imprimer.
node -e '
const fs=require("fs");const s=fs.readFileSync("Aide_memoire.html","utf8");
fs.writeFileSync("final/aide_tmp.html","<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"></head><body>"+s+"</body></html>");'
"$CHROME" --headless=new --no-pdf-header-footer --print-to-pdf="$W/final/sortie/Aide_memoire.pdf" "$W/final/aide_tmp.html" 2>/dev/null
python -I -c "
import pymupdf,glob,os
for f in sorted(glob.glob('final/sortie/*.pdf')):
    a=pymupdf.open('final/origine/'+os.path.basename(f)).page_count; b=pymupdf.open(f).page_count
    print(os.path.basename(f), a, '->', b)
"
