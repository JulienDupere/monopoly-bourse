import sys,os,random; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import pymupdf, outils_cahiers as oc
random.seed(3)
import io
res=[]
for k in range(9):
    src='originaux/Cahier_%d.pdf'%k
    d=pymupdf.open(src); cand=[]
    for pn in range(d.page_count):
        pg=d[pn]; paras=oc.trouver_paragraphes(pg)
        for p in paras:
            cars,_=oc._cars_paragraphe(p)
            if any(c.fam is None for c in cars) or len(p.lignes)<2: continue
            t=oc.texte_paragraphe(p); words=t.split(' ')
            if len(words)<4: continue
            cand.append((pn+1,p,' '.join(words[1:3])))
    pick=random.sample(cand,min(8,len(cand)))
    corr=[{"page":pn,"ancien":a,"nouveau":a,"occurrence":None} for pn,p,a in pick]
    # occurrence ambiguity: drop those
    out='essais/noop_%d.pdf'%k
    j,e=oc.appliquer(src,out,corr,verbeux=False)
    # compare
    r=oc.comparer(src,out,verbeux=False)
    a=pymupdf.open(src); b=pymupdf.open(out)
    maxdiff=0
    for pn,p,_ in pick:
        pa=a[pn-1].get_pixmap(dpi=100); pb=b[pn-1].get_pixmap(dpi=100)
        import array
        sa=pa.samples; sb=pb.samples
        n=sum(1 for i in range(0,len(sa),3) if abs(sa[i]-sb[i])>60)
        maxdiff=max(maxdiff,n)
    print(k,'ok',len(j),'err',[x['erreur'][:90] for x in e],'textdiff pages',list(r['diff']),'maxpixdiff',maxdiff)
