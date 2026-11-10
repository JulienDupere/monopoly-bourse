# Génère maj-Cahier_*.html à partir du gabarit et des fichiers contenu/<nom>.html
# (première ligne du fichier de contenu : « CAHIER|PAGE », le reste = contenu de <main> après le filet).
import sys, os, re, glob, subprocess, pymupdf
T = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
gab = open(os.path.join(T, "gabarit-mise-a-jour.html"), encoding="utf-8").read()
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
for f in sorted(glob.glob(os.path.join(T, "contenu", "*.html"))):
    nom = os.path.basename(f)[:-5]
    lines = open(f, encoding="utf-8").read().split("\n", 1)
    cahier, page = lines[0].strip().split("|")
    body = lines[1]
    # espaces insécables de la typographie française (évite « ; » ou « : » en début de ligne)
    for a, b in [(" ;", " ;"), (" :", " :"), ("« ", "« "), (" »", " »"), (" %", " %"),
                 (" M$", " M$"), (" K$", " K$"), (" $", " $"), (" ?", " ?"), (" !", " !")]:
        body = body.replace(a, b)
    h = gab.replace("{{CAHIER}}", cahier).replace("{{PAGE}}", page)
    h = re.sub(r"(<div class=\"filet\"></div>\n).*?(\n  </main>)", lambda m: m.group(1) + body.rstrip() + m.group(2), h, flags=re.S)
    out = os.path.join(T, f"maj-{nom}.html")
    open(out, "w", encoding="utf-8").write(h)
    pdf = os.path.join(T, "rendus", f"maj-{nom}.pdf")
    subprocess.run([CHROME, "--headless=new", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", "file:///" + out.replace("\\", "/")], capture_output=True, timeout=60)
    d = pymupdf.open(pdf); pg = d[0]
    # bas du dernier encadré : plus grand y des textes situés au-dessus du pied de page (y < 740)
    ys = [b[3] for b in pg.get_text("blocks") if b[3] < 740]
    boxes = [dr["rect"].y1 for dr in pg.get_drawings() if dr.get("fill") and dr["rect"].width < 500 and dr["rect"].height > 20]
    ys.append(max(boxes) if boxes else 0)
    txt = re.sub(r"<[^>]+>", "", body); txt = re.sub(r"\s+", " ", txt)
    n_enc = body.count('class="encadre')
    print(f"{nom}: {len(d)} page(s), bas du dernier encadré y={max(ys):.0f} pt, {n_enc} encadrés, {len(txt)} caractères")
    pg.get_pixmap(dpi=60).save(os.path.join(T, "rendus", f"maj-{nom}.png"))
