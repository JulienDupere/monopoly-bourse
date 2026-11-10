# Affiche les mots en gras (ou en italique) contenus dans chaque `ancien` de corrections.json.
import sys, json, pymupdf, os
CAH = r"C:\Users\Julien\Desktop\Application CLAUDE\Monopoly Finance\docs\cahiers"
sys.stdout.reconfigure(encoding='utf-8')
data = json.load(open(sys.argv[1], encoding="utf-8"))
for pdf, items in data.items():
    doc = pymupdf.open(os.path.join(CAH, pdf))
    for it in items:
        page = doc[it["page"] - 1]
        s = ""; marks = []
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0: continue
            for l in b["lines"]:
                t = "".join(sp["text"] for sp in l["spans"])
                if not t.strip(): continue
                if s: s += " "; marks.append(None)
                for sp in l["spans"]:
                    f = sp["font"]; bold = ("Bold" in f) or (sp["flags"] & 16)
                    for ch in sp["text"]:
                        s += ch; marks.append((bold, f, round(sp["size"],1)))
        k = s.find(it["ancien"])
        if k < 0: print(pdf, it["page"], "INTROUVABLE"); continue
        seg = marks[k:k+len(it["ancien"])]
        fonts = sorted({m[1] for m in seg if m}); sizes = sorted({m[2] for m in seg if m})
        out, cur = [], ""
        for ch, m in zip(it["ancien"], seg):
            if m and m[0]: cur += ch
            elif cur: out.append(cur); cur = ""
        if cur: out.append(cur)
        out = [w.strip() for w in out if w.strip()]
        print(f"{pdf} p.{it['page']}: gras = {out} ; polices = {fonts} {sizes}")
