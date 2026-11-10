# Vérifie corrections.json : `ancien` trouvé une seule fois sur la page (lignes jointes par une espace),
# dans un seul paragraphe reconstitué, et estimation de la place disponible sous le paragraphe.
import sys, json, re, math, pymupdf, os
CAH = r"C:\Users\Julien\Desktop\Application CLAUDE\Monopoly Finance\docs\cahiers"
sys.stdout.reconfigure(encoding='utf-8')

def page_lines(page):
    d = page.get_text("dict")
    L = []
    imgs = []
    for b in d["blocks"]:
        if b["type"] != 0:
            imgs.append(pymupdf.Rect(b["bbox"])); continue
        for l in b["lines"]:
            t = "".join(s["text"] for s in l["spans"])
            if not t.strip(): continue
            size = max(s["size"] for s in l["spans"])
            L.append({"text": t, "bbox": pymupdf.Rect(l["bbox"]), "size": round(size, 1)})
    return L, imgs

def paragraph(L, idx):
    """Étend autour des lignes idx (liste) aux lignes voisines du même paragraphe."""
    first, last = min(idx), max(idx)
    def same(a, b):  # b suit a dans le même paragraphe ?
        A, B = L[a], L[b]
        if abs(A["size"] - B["size"]) > 0.3: return False
        dy = B["bbox"].y0 - A["bbox"].y0
        if not (0.9 * A["size"] <= dy <= 1.75 * A["size"]): return False
        return abs(B["bbox"].x0 - A["bbox"].x0) < 25 or (B["bbox"].x0 > A["bbox"].x0 and B["bbox"].x0 < A["bbox"].x1)
    while first > 0 and same(first - 1, first): first -= 1
    while last + 1 < len(L) and same(last, last + 1): last += 1
    return list(range(first, last + 1))

def room_below(page, L, imgs, para):
    r = pymupdf.Rect(L[para[0]]["bbox"])
    for i in para: r |= L[i]["bbox"]
    lim, why = page.rect.y1 - 48, "pied de page"
    for j, l in enumerate(L):
        if j in para: continue
        b = l["bbox"]
        if b.y0 >= r.y1 - 1 and b.x0 < r.x1 - 2 and b.x1 > r.x0 + 2 and b.y0 < lim:
            lim, why = b.y0, "texte « " + l["text"][:35] + " »"
    for im in imgs:
        if im.y0 >= r.y1 - 1 and im.x0 < r.x1 - 2 and im.x1 > r.x0 + 2 and im.y0 < lim and im.height > 1:
            lim, why = im.y0, "image"
    for dr in page.get_drawings():
        q = dr["rect"]
        if q.width < 2 and q.height < 2: continue
        if q.x0 <= r.x0 + 2 and q.x1 >= r.x1 - 2 and q.y0 <= r.y0 + 2 and q.y1 >= r.y1 - 1 and q.height < page.rect.height * 0.8:
            if q.y1 < lim: lim, why = q.y1, "bas de l'encadré"
        elif q.y0 >= r.y1 - 0.5 and q.x0 < r.x1 - 2 and q.x1 > r.x0 + 2 and q.y0 < lim:
            lim, why = q.y0, "dessin/filet"
    return r, lim, why

def main(path):
    data = json.load(open(path, encoding="utf-8"))
    bad = 0
    for pdf, items in data.items():
        doc = pymupdf.open(os.path.join(CAH, pdf))
        for it in items:
            page = doc[it["page"] - 1]
            L, imgs = page_lines(page)
            s, owner = "", []
            for i, l in enumerate(L):
                if s: s += " "; owner.append(-1)
                s += l["text"]; owner += [i] * len(l["text"])
            anc = it["ancien"]
            n = s.count(anc)
            if n != 1:
                bad += 1
                print(f"!! {pdf} p.{it['page']} : {n} occurrence(s) — {anc[:80]!r}"); continue
            k = s.index(anc)
            idx = sorted({owner[c] for c in range(k, k + len(anc)) if owner[c] >= 0})
            para = paragraph(L, idx)
            if not set(idx) <= set(para):
                bad += 1; print(f"!! {pdf} p.{it['page']} : `ancien` déborde du paragraphe — {anc[:60]!r}"); continue
            ptxt = " ".join(L[i]["text"] for i in para)
            new = ptxt.replace(anc, re.sub(r"\*\*", "", it["nouveau"]))
            nl = len(para)
            cpl = max(len(L[i]["text"]) for i in para[:-1]) if nl > 1 else max(60, len(ptxt))
            # largeur moyenne d'un caractère, pour un paragraphe d'une ligne : largeur de colonne inconnue
            est = math.ceil(len(new) / (cpl * 0.96))
            lh = (L[para[-1]]["bbox"].y0 - L[para[0]]["bbox"].y0) / (nl - 1) if nl > 1 else L[para[0]]["size"] * 1.5
            r, lim, why = room_below(page, L, imgs, para)
            extra = int((lim - r.y1 - 0.2 * lh) // lh)
            # simulation du retour à la ligne avec les métriques Helvetica (≈ Arial / Liberation Sans)
            size = L[para[0]]["size"]
            left = min(L[i]["bbox"].x0 for i in para); right = max(L[i]["bbox"].x1 for i in para)
            def wrap(txt, width):
                n, cur = 1, 0.0
                for w in txt.split(" "):
                    wl = pymupdf.get_text_length(w + " ", fontname="helv", fontsize=size) * 1.02
                    if cur + wl > width + 2 and cur > 0: n += 1; cur = wl
                    else: cur += wl
                return n
            width = right - left
            sim_old, sim_new = wrap(ptxt, width), wrap(new, width)
            est = nl + (sim_new - sim_old)
            ok = est <= nl + max(0, extra)
            if not ok: bad += 1
            pct = (len(it["nouveau"]) - len(anc)) / max(1, len(ptxt)) * 100
            print(f"{'OK ' if ok else 'TROP'} {pdf} p.{it['page']}: § {nl} l. ({cpl} car./l.) -> ~{est} l. (simulé {sim_old}->{sim_new}) ; place libre ≈ {extra} l. ({why}) ; paragraphe {pct:+.0f} %")
    print("TOUT VA BIEN" if bad == 0 else f"{bad} point(s) à revoir")

main(sys.argv[1])
