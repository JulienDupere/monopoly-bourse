import pymupdf,sys
d=pymupdf.open(sys.argv[1]); p=d[int(sys.argv[2])-1]
for b in p.get_text("dict")["blocks"]:
    if b["type"]==0:
        print("BLOCK",[round(x,1) for x in b["bbox"]])
        for l in b["lines"]:
            print("  L",[round(x,1) for x in l["bbox"]],[(s["text"],s["font"],round(s["size"],1),hex(s["color"])) for s in l["spans"]])
    else: print("IMG",[round(x,1) for x in b["bbox"]])
for dr in p.get_drawings(): print("DR",[round(x,1) for x in dr["rect"]],dr.get("fill"))
