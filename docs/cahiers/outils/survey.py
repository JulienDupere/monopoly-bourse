import sys,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import pymupdf, outils_cahiers as oc
tot=bad=0; nolines=0; badlist=[]
for k in range(9):
    d=pymupdf.open('originaux/Cahier_%d.pdf'%k)
    for pn in range(d.page_count):
        pg=d[pn]; paras=oc.trouver_paragraphes(pg)
        for p in paras:
            if len(p.lignes)<2: continue
            cars,deb=oc._cars_paragraphe(p)
            if any(c.fam is None for c in cars): continue
            ctx=oc.analyser_contexte(pg,p,paras)
            w,info,ok=oc.calibrer_largeur(pg,p,paras,ctx,cars,deb)
            tot+=1
            if not ok: bad+=1; badlist.append((k,pn+1,p.num,info,oc.texte_paragraphe(p)[:60]))
print(tot,bad)
for b in badlist[:25]: print(b)
