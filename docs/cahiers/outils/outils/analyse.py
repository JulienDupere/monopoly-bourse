# Outils d'analyse des cahiers (PyMuPDF) : blocs d'une page, vérification de corrections.json.
import sys, json, re, math, pymupdf, os
CAH = r"C:\Users\Julien\Desktop\Application CLAUDE\Monopoly Finance\docs\cahiers"
sys.stdout.reconfigure(encoding='utf-8')

def blocks(page):
    d = page.get_text("dict")
    out = []
    for b in d["blocks"]:
        if b["type"] != 0:
            out.append({"type": "img", "bbox": b["bbox"], "text": "", "lines": []})
            continue
        lines = []
        for l in b["lines"]:
            t = "".join(s["text"] for s in l["spans"])
            size = max((s["size"] for s in l["spans"]), default=0)
            lines.append({"text": t, "bbox": l["bbox"], "size": size})
        txt = " ".join(l["text"] for l in lines)
        out.append({"type": "txt", "bbox": b["bbox"], "text": txt, "lines": lines})
    return out

def norm(s):
    return re.sub(r"[ \u00a0\u202f\n]+", " ", s).strip()

def space_limit(page, blks, i):
    b = blks[i]; x0, y0, x1, y1 = b["bbox"]
    lim = page.rect.y1 - 40
    why = "bas de page"
    for j, o in enumerate(blks):
        if j == i: continue
        ox0, oy0, ox1, oy1 = o["bbox"]
        if oy0 >= y1 - 1 and ox0 < x1 - 2 and ox1 > x0 + 2:
            if oy0 < lim: lim, why = oy0, f"bloc {j} ({o['text'][:30]!r})"
    for dr in page.get_drawings():
        r = dr["rect"]
        # cadre qui contient le bloc : son bord bas limite
        if r.x0 <= x0 + 1 and r.x1 >= x1 - 1 and r.y0 <= y0 + 1 and r.y1 >= y1 - 1 and r.height < page.rect.height * 0.9:
            if r.y1 < lim: lim, why = r.y1, f"cadre {tuple(round(v) for v in r)}"
        # trait ou rectangle sous le bloc
        elif r.y0 >= y1 - 0.5 and r.x0 < x1 - 2 and r.x1 > x0 + 2:
            if r.y0 < lim: lim, why = r.y0, f"dessin {tuple(round(v) for v in r)}"
    return lim, why

def cmd_blocs(pdf, pno):
    doc = pymupdf.open(os.path.join(CAH, pdf)); page = doc[pno - 1]
    for i, b in enumerate(blocks(page)):
        print(i, b["type"], [round(v) for v in b["bbox"]], b["text"][:160])

def cmd_verifie(path):
    data = json.load(open(path, encoding="utf-8"))
    ok = True
    for pdf, items in data.items():
        doc = pymupdf.open(os.path.join(CAH, pdf))
        for it in items:
            page = doc[it["page"] - 1]
            blks = blocks(page)
            anc = it["ancien"]
            hits = [i for i, b in enumerate(blks) if anc in b["text"]]
            total = sum(b["text"].count(anc) for b in blks)
            pagetxt = norm(page.get_text())
            if len(hits) != 1 or total != 1:
                ok = False
                print(f"!! {pdf} p.{it['page']} : {len(hits)} bloc(s), {total} occurrence(s) — {anc[:70]!r}")
                # occurrences en ignorant les blancs
                if norm(anc) in pagetxt: print("   (trouvé en normalisant les blancs : vérifier NBSP/retours)")
                continue
            i = hits[0]; b = blks[i]
            lines = b["lines"]; n = len(lines)
            width = b["bbox"][2] - b["bbox"][0]
            chars = max(len(l["text"]) for l in lines)
            lh = (lines[-1]["bbox"][1] - lines[0]["bbox"][1]) / (n - 1) if n > 1 else (lines[0]["bbox"][3] - lines[0]["bbox"][1]) * 1.25
            newtxt = b["text"].replace(anc, it["nouveau"].replace("**", ""))
            # estimation des lignes : longueur / caractères par ligne pleine
            full = [len(l["text"]) for l in lines[:-1]] or [len(lines[0]["text"])]
            cpl = max(full)
            est = math.ceil(len(newtxt) / (cpl * 0.97))
            lim, why = space_limit(page, blks, i)
            room = int((lim - b["bbox"][3]) // lh) if lh > 0 else 0
            grow = len(it["nouveau"]) - len(anc)
            flag = "OK" if est <= n + max(0, room) else "TROP LONG"
            if flag != "OK": ok = False
            print(f"{flag:9} {pdf} p.{it['page']} bloc {i}: {n} l. -> ~{est} l. ; place sous le bloc ≈ {room} l. ({why}) ; {grow:+d} car. ; {cpl} car./l.")
    print("TOUT VA BIEN" if ok else "À REVOIR")

if __name__ == "__main__":
    if sys.argv[1] == "blocs": cmd_blocs(sys.argv[2], int(sys.argv[3]))
    elif sys.argv[1] == "verifie": cmd_verifie(sys.argv[2])
