# Enveloppe un Aide_memoire.html (contenu sans squelette), l'imprime avec Chrome et contrôle les 5 pages.
import sys, os, subprocess, pymupdf
sys.stdout.reconfigure(encoding='utf-8')
src, tag = sys.argv[1], sys.argv[2]
T = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(src, encoding="utf-8").read()
wrapped = os.path.join(T, "rendus", f"aide-{tag}-enveloppe.html")
open(wrapped, "w", encoding="utf-8").write('<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + html + '</body></html>')
pdf = os.path.join(T, "rendus", f"aide-{tag}.pdf")
subprocess.run([r"C:\Program Files\Google\Chrome\Application\chrome.exe", "--headless=new", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}", "file:///" + wrapped.replace("\\", "/")], capture_output=True, timeout=120)
d = pymupdf.open(pdf)
print(f"{tag}: {len(d)} pages")
for i, pg in enumerate(d):
    blocks = pg.get_text("blocks")
    foot = [b for b in blocks if "Monopoly Bourse · Aide-mémoire" in b[4] or "Cahiers complets" in b[4]]
    fy = min(b[1] for b in foot) if foot else None
    body = [b[3] for b in blocks if (fy is None or b[1] < fy - 1)]
    print(f"  p.{i+1}: pied à y={fy if fy is None else round(fy)} ; bas du contenu y={round(max(body))} ; marge={None if fy is None else round(fy-max(body))} pt")
