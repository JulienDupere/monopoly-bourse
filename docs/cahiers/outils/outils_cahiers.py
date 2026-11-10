#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Outils de correction en place des cahiers PDF de formation (Monopoly Bourse).

Usage en module :  import outils_cahiers as oc
Usage en ligne de commande : python -I outils_cahiers.py --help   (voir LISEZMOI-outils.md)

Principe de `appliquer` : pour chaque correction, on retrouve le paragraphe de la page (lignes de texte
regroupées d'après leur abscisse, leur taille, leur couleur et leur interligne), on reconstitue son texte avec
gras/italique, on y remplace `ancien` par `nouveau`, on efface seulement le texte du paragraphe (rédaction
PyMuPDF sans remplissage), puis on recompose le paragraphe avec une coupure de lignes maison, en Arial
(mêmes métriques que Liberation Sans) incorporée, à la même place, même taille, même couleur, même interligne.
Si le paragraphe est le dernier d'un encadré et qu'il grandit, l'encadré est agrandi (fond, filets, barre).
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import unicodedata

import pymupdf

for _f in (sys.stdout, sys.stderr):
    try:
        _f.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

POLICES_DIR = os.environ.get("CAHIERS_POLICES", r"C:\Windows\Fonts")
CHROME = os.environ.get(
    "CAHIERS_CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
MARGE = 2.0  # marge (pt) laissée avant l'obstacle suivant

_FICHIERS = {
    ("sans", False, False): "arial.ttf",
    ("sans", True, False): "arialbd.ttf",
    ("sans", False, True): "ariali.ttf",
    ("sans", True, True): "arialbi.ttf",
    ("serif", False, False): "times.ttf",
    ("serif", True, False): "timesbd.ttf",
    ("serif", False, True): "timesi.ttf",
    ("serif", True, True): "timesbi.ttf",
}
_cache_polices = {}


class ErreurCorrection(Exception):
    """Erreur claire sur une correction (introuvable, ambigu, déborde...)."""


# ----------------------------------------------------------------------------------------------
# Polices
# ----------------------------------------------------------------------------------------------
def police(famille, gras, ital):
    cle = (famille, bool(gras), bool(ital))
    if cle not in _cache_polices:
        chemin = os.path.join(POLICES_DIR, _FICHIERS[cle])
        if not os.path.exists(chemin):
            raise ErreurCorrection("police introuvable : " + chemin)
        _cache_polices[cle] = pymupdf.Font(fontfile=chemin)
    return _cache_polices[cle]


def _famille(nom):
    n = nom.lower()
    if "liberationsans" in n or "arial" in n:
        return "sans"
    if "liberationserif" in n or "times" in n:
        return "serif"
    return None


# ----------------------------------------------------------------------------------------------
# Normalisation
# ----------------------------------------------------------------------------------------------
_BLANCS = " \t\r\n\u00a0\u202f\u2009\u2007\u200a\u2002\u2003"


def _est_blanc(c):
    return c in _BLANCS


def normaliser(texte):
    """Renvoie (texte normalisé, début[], fin[]) : chaque caractère normalisé pointe sur la plage d'origine."""
    sortie, deb, fin = [], [], []
    i, n = 0, len(texte)
    while i < n:
        c = texte[i]
        if _est_blanc(c):
            j = i
            while j < n and _est_blanc(texte[j]):
                j += 1
            sortie.append(" ")
            deb.append(i)
            fin.append(j)
            i = j
        else:
            sortie.append(c)
            deb.append(i)
            fin.append(i + 1)
            i += 1
    return "".join(sortie), deb, fin


def _norm_simple(t):
    return normaliser(t)[0].strip()


# ----------------------------------------------------------------------------------------------
# Extraction des lignes et des paragraphes
# ----------------------------------------------------------------------------------------------
class Car:
    __slots__ = ("ch", "fam", "gras", "ital", "taille", "dy", "couleur")

    def __init__(self, ch, fam, gras, ital, taille, dy, couleur):
        self.ch, self.fam, self.gras, self.ital = ch, fam, gras, ital
        self.taille, self.dy, self.couleur = taille, dy, couleur

    def copie(self, ch=None):
        return Car(self.ch if ch is None else ch, self.fam, self.gras, self.ital, self.taille, self.dy,
                   self.couleur)

    def style(self):
        return (self.fam, self.gras, self.ital, round(self.taille, 2), round(self.dy, 2), self.couleur)


class Ligne:
    pass


class Paragraphe:
    def __init__(self):
        self.lignes = []

    # rectangle englobant
    @property
    def bbox(self):
        return pymupdf.Rect(min(l.bbox[0] for l in self.lignes), min(l.bbox[1] for l in self.lignes),
                            max(l.bbox[2] for l in self.lignes), max(l.bbox[3] for l in self.lignes))


def _lignes_page(page):
    d = page.get_text("dict")
    res = []
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            if abs(l["dir"][0] - 1) > 1e-3:
                continue
            spans = [s for s in l["spans"] if s["text"] != ""]
            txt = "".join(s["text"] for s in spans)
            if not spans or not txt.strip(_BLANCS):
                continue
            ln = Ligne()
            ln.bbox = tuple(l["bbox"])
            mx = max(s["size"] for s in spans)
            gros = max((s for s in spans if s["size"] > mx - 0.15), key=lambda s: len(s["text"]))
            ln.base = gros["origin"][1]
            ln.taille = gros["size"]
            ln.couleur = gros["color"]
            ln.x0, ln.x1 = ln.bbox[0], ln.bbox[2]
            ln.spans = spans
            ln.texte = txt
            res.append(ln)
    return res


def _cars_ligne(ln):
    cars = []
    for s in ln.spans:
        nom = s["font"]
        fam = _famille(nom)
        gras = "bold" in nom.lower()
        ital = "italic" in nom.lower() or "oblique" in nom.lower()
        dy = s["origin"][1] - ln.base
        for ch in s["text"]:
            cars.append(Car(ch, fam, gras, ital, s["size"], dy, s["color"]))
    # retire les blancs de début et de fin de ligne
    while cars and _est_blanc(cars[0].ch):
        cars.pop(0)
    while cars and _est_blanc(cars[-1].ch):
        cars.pop()
    return cars


def _traits_horizontaux(page):
    """Filets fins (lignes de tableau, bordures) : rectangles très plats."""
    res = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.height <= 2.0 and r.width > 8:
            res.append(r)
    return res


def _largeur(cars, bonus_police=None):
    """Largeur d'une suite de caractères, d'après les métriques Arial."""
    total = 0.0
    i, n = 0, len(cars)
    while i < n:
        j = i
        st = cars[i].style()
        while j < n and cars[j].style() == st:
            j += 1
        c = cars[i]
        total += police(c.fam or "sans", c.gras, c.ital).text_length(
            "".join(x.ch for x in cars[i:j]), c.taille)
        i = j
    return total


def trouver_paragraphes(page):
    lignes = _lignes_page(page)
    lignes.sort(key=lambda l: (round(l.base, 1), l.x0))
    filets = _traits_horizontaux(page)
    # borne droite de référence par colonne (x0 arrondi, taille, couleur)
    ref_droite = {}
    for l in lignes:
        k = (round(l.x0), round(l.taille, 1), l.couleur)
        ref_droite[k] = max(ref_droite.get(k, 0), l.x1)
    paras = []
    ouverts = []
    for l in lignes:
        cible = None
        for p in ouverts:
            d = p.lignes[-1]
            dy = l.base - d.base
            if abs(l.x0 - d.x0) > 1.2 or abs(l.taille - d.taille) > 0.15 or l.couleur != d.couleur:
                continue
            if not (0.5 < dy <= 1.9 * l.taille):
                continue
            if len(p.lignes) >= 2:
                lead = min(p.lignes[i + 1].base - p.lignes[i].base for i in range(len(p.lignes) - 1))
                if abs(dy - lead) > 1.2:
                    # une ligne qui porte un exposant (span plus petit) est plus haute : tolérance
                    expo = any(sp["size"] < l.taille - 0.5 for sp in l.spans) or any(
                        sp["size"] < d.taille - 0.5 for sp in d.spans)
                    if not (expo and lead - 1.2 <= dy <= lead + 4.0):
                        continue
            # un filet entre les deux lignes sépare deux cellules
            sep = False
            for f in filets:
                if d.bbox[3] - 3 < f.y0 < l.bbox[1] + 3 and f.x0 <= l.x0 + 1 and f.x1 >= l.x0 - 1 \
                        and f.y0 > d.base and f.y0 < l.base - l.taille * 0.6:
                    sep = True
                    break
            if sep:
                continue
            # la ligne précédente est-elle assez courte pour qu'un mot de la suivante y tienne ?
            k = (round(l.x0), round(l.taille, 1), l.couleur)
            mot = re.split(r"[ \u00a0]", l.texte.strip())[0] if False else l.texte.strip().split(" ")[0]
            cs = _cars_ligne(l)
            wmot = 0.0
            if cs:
                prem = []
                for c in cs:
                    if c.ch == " ":
                        break
                    prem.append(c)
                try:
                    wmot = _largeur(prem)
                except ErreurCorrection:
                    wmot = 0.0
            reste = ref_droite[k] - d.x1
            if reste > wmot + 3.0:
                continue
            cible = p
            break
        if cible is None:
            cible = Paragraphe()
            paras.append(cible)
            ouverts.append(cible)
        cible.lignes.append(l)
        # nettoie les paragraphes trop loin
        ouverts = [p for p in ouverts if l.base - p.lignes[-1].base < 40]
    for i, p in enumerate(paras):
        p.num = i
    return paras


def _cars_paragraphe(p):
    """Texte canonique du paragraphe : liste de Car ; renvoie (cars, debuts_de_ligne)."""
    cars, debuts = [], []
    for k, ln in enumerate(p.lignes):
        cl = _cars_ligne(ln)
        if k > 0 and cars:
            if cars[-1].ch == "-" and cl and cl[0].ch.isalnum() and len(cars) >= 2 and cars[-2].ch.isalnum():
                pass  # césure sur un vrai trait d'union : pas d'espace
            else:
                cars.append(cars[-1].copie(" "))
        debuts.append(len(cars))
        cars.extend(cl)
    return cars, debuts


def texte_paragraphe(p):
    cars, _ = _cars_paragraphe(p)
    return "".join(c.ch for c in cars)


# ----------------------------------------------------------------------------------------------
# Coupure de lignes
# ----------------------------------------------------------------------------------------------
class Unite:
    __slots__ = ("sep", "sp", "cars", "debut", "w")


def decouper_unites(cars):
    unites = []
    cur, sep, sp, debut = [], "deb", None, 0
    n = len(cars)
    for i, c in enumerate(cars):
        if c.ch == " ":
            if cur:
                u = Unite()
                u.sep, u.sp, u.cars, u.debut = sep, sp, cur, debut
                unites.append(u)
                cur = []
            if sep == "deb" and not unites:
                pass
            sep, sp, debut = "sp", c, i + 1
            continue
        if not cur:
            debut = i if sep != "sp" else debut
        cur.append(c)
        if c.ch == "-" and len(cur) >= 2 and cur[-2].ch.isalnum() and i + 1 < n and cars[i + 1].ch.isalnum():
            u = Unite()
            u.sep, u.sp, u.cars, u.debut = sep, sp, cur, debut
            unites.append(u)
            cur, sep, sp, debut = [], "tir", None, i + 1
    if cur:
        u = Unite()
        u.sep, u.sp, u.cars, u.debut = sep, sp, cur, debut
        unites.append(u)
    for u in unites:
        u.w = _largeur(u.cars)
    return unites


def _wsep(u):
    return _largeur([u.sp]) if (u.sep == "sp" and u.sp is not None) else 0.0


def couper(unites, largeur):
    """Glouton : renvoie la liste des lignes (listes d'unités)."""
    lignes, cur, w = [], [], 0.0
    for u in unites:
        ws = _wsep(u) if cur else 0.0
        if cur and w + ws + u.w > largeur + 1e-6:
            lignes.append(cur)
            cur, w = [u], u.w
        else:
            cur.append(u)
            w += ws + u.w
    if cur:
        lignes.append(cur)
    return lignes


def _cars_de_ligne(lig):
    cars = []
    for k, u in enumerate(lig):
        if k > 0 and u.sep == "sp" and u.sp is not None:
            cars.append(u.sp)
        cars.extend(u.cars)
    return cars


# ----------------------------------------------------------------------------------------------
# Markup du nouveau texte
# ----------------------------------------------------------------------------------------------
def _typographie(t):
    t = re.sub(r"(?<=\S) (?=[?!;:»%])", "\u00a0", t)
    t = re.sub(r"(?<=«) ", "\u00a0", t)
    return t


def _parser_nouveau(nouveau, base, principal, typo=True):
    """Convertit `nouveau` (avec **gras** et __italique__) en liste de Car."""
    if typo:
        nouveau = _typographie(nouveau)
    gras0 = base.gras if "**" not in nouveau else False
    ital0 = base.ital if "__" not in nouveau else False
    fam = base.fam or "sans"
    sty = base
    if abs(base.taille - principal.taille) > 0.05 or abs(base.dy) > 0.05:
        sty = principal
    gras, ital = gras0, ital0
    cars = []
    i = 0
    while i < len(nouveau):
        if nouveau.startswith("**", i):
            gras = not gras
            i += 2
            continue
        if nouveau.startswith("__", i):
            ital = not ital
            i += 2
            continue
        cars.append(Car(nouveau[i], fam, gras, ital, sty.taille, sty.dy if sty is base else 0.0,
                        sty.couleur))
        i += 1
    return cars


# ----------------------------------------------------------------------------------------------
# Géométrie : conteneurs et obstacles
# ----------------------------------------------------------------------------------------------
def _contient(grand, petit, tol=1.0):
    return (grand.x0 <= petit.x0 + tol and grand.x1 >= petit.x1 - tol and grand.y0 <= petit.y0 + tol
            and grand.y1 >= petit.y1 - tol)


def _chevauche_x(a0, a1, b0, b1, mini=0.5):
    return min(a1, b1) - max(a0, b0) > mini


class Contexte:
    pass


def analyser_contexte(page, para, paras):
    ctx = Contexte()
    bb = para.bbox
    ctx.bb = bb
    dess = page.get_drawings()
    page_r = page.rect
    # conteneur rempli le plus petit qui contient le paragraphe
    cont = None
    for d in dess:
        r = d["rect"]
        if d.get("fill") is None:
            continue
        if r.width * r.height > 0.9 * page_r.width * page_r.height:
            continue
        if r.height < 4 or r.width < 20:
            continue
        if _contient(r, bb):
            if cont is None or r.width * r.height < cont["rect"].width * cont["rect"].height:
                cont = d
    ctx.conteneur = cont
    ctx.pieces = {}
    if cont is not None:
        C = cont["rect"]
        for d in dess:
            r = d["rect"]
            if d is cont or d.get("fill") is None:
                continue
            if not _contient(C, r, 0.6):
                continue
            if r.width >= C.width - 3 and r.height <= 1.6 and abs(r.y1 - C.y1) < 1.0:
                ctx.pieces["bas"] = d
            elif r.width >= C.width - 3 and r.height <= 1.6 and abs(r.y0 - C.y0) < 1.0:
                ctx.pieces["haut"] = d
            elif r.width <= 3.2 and r.height >= C.height - 3 and abs(r.x0 - C.x0) < 1.0:
                ctx.pieces["gauche"] = d
            elif r.width <= 1.6 and r.height >= C.height - 3 and abs(r.x1 - C.x1) < 1.0:
                ctx.pieces["droite"] = d
    # colonne de tableau : plus étroit filet fin qui couvre l'abscisse
    colonne = None
    x0 = bb.x0
    for d in dess:
        r = d["rect"]
        if r.height <= 2.0 and r.width > 40 and r.x0 - 0.5 <= x0 <= r.x1 and r.width < 0.9 * page_r.width:
            if colonne is None or r.width < colonne.width:
                colonne = r
    ctx.colonne = colonne
    # cadre de page (rect non rempli qui contient tout)
    ctx.cadre = None
    for d in dess:
        r = d["rect"]
        if d.get("fill") is None and _contient(r, bb) and r.width > 0.5 * page_r.width:
            ctx.cadre = r
    return ctx


def largeur_candidate(page, para, paras, ctx):
    x0 = para.bbox.x0
    t = para.lignes[0].taille
    nb = 0.0
    for p in paras:
        for l in p.lignes:
            if abs(l.x0 - x0) <= 1.2 and abs(l.taille - t) < 0.15:
                nb = max(nb, l.x1 - x0)
    if ctx.conteneur is not None:
        C = ctx.conteneur["rect"]
        # rembourrage à droite = rembourrage utile à gauche (sans la barre de couleur)
        g = ctx.pieces.get("gauche")
        barre = g["rect"].width if g is not None else 0
        rem = x0 - C.x0 - barre
        return (C.x1 - 0.7 - rem) - x0, nb
    if ctx.colonne is not None:
        c = ctx.colonne
        return (c.x1 - (x0 - c.x0)) - x0, nb
    if ctx.cadre is not None:
        f = ctx.cadre
        return max((f.x1 - (x0 - f.x0)) - x0, nb), nb
    return nb, nb


def calibrer_largeur(page, para, paras, ctx, cars, debuts):
    """Choisit la largeur de colonne ; renvoie (largeur, info)."""
    unites = decouper_unites(cars)
    cand, nb = largeur_candidate(page, para, paras, ctx)
    # lignes d'origine en unités
    idx_ligne = []
    for k, d in enumerate(debuts):
        for ui, u in enumerate(unites):
            if u.debut == d:
                idx_ligne.append(ui)
                break
    lo, hi = 0.0, float("inf")
    if len(idx_ligne) == len(debuts) and len(debuts) >= 1:
        bornes = idx_ligne + [len(unites)]
        for k in range(len(debuts)):
            seg = unites[bornes[k]:bornes[k + 1]]
            w = 0.0
            for j, u in enumerate(seg):
                w += (_wsep(u) if j else 0.0) + u.w
            lo = max(lo, w)
            if k + 1 < len(debuts):
                nxt = unites[bornes[k + 1]]
                hi = min(hi, w + _wsep(nxt) + nxt.w)
    if len(debuts) == 1:
        lo = max(lo, nb if nb else 0)
        lo = lo  # une seule ligne : pas de borne haute
    info = "candidat %.1f, intervalle [%.1f ; %s]" % (cand, lo, ("%.1f" % hi) if hi < 1e9 else "inf")
    if hi < 1e9 and lo > hi:
        w = lo  # métriques sans crénage : lo l'emporte
        info += " (intervalle vide, on retient lo)"
    elif cand < lo:
        w = lo
    elif cand >= hi:
        w = hi - 0.01
    else:
        w = cand
    # contrôle : la recomposition de l'original redonne les mêmes coupures
    lignes = couper(unites, w)
    ok = len(lignes) == len(debuts) and all(
        lignes[k][0].debut == debuts[k] for k in range(len(debuts)))
    info += " ; recomposition de l'original %s" % ("identique" if ok else "DIFFÉRENTE")
    return w, info, ok



# ----------------------------------------------------------------------------------------------
# Réparation de la table ToUnicode des polices incorporées
# ----------------------------------------------------------------------------------------------
def _ordre_unicode():
    """Caractères par ordre de priorité : ASCII d'abord, pour qu'un glyphe partagé (espace / espace
    insécable, « - » / trait d'union conditionnel, « ; » / point d'interrogation grec) soit extrait comme
    le caractère courant."""
    ordre = list(range(0x20, 0x7F)) + list(range(0xA1, 0x100)) + list(range(0x100, 0x2300))
    ordre += [0xA0, 0xAD]
    return ordre


def _cmap_pour(fonte):
    gid2u = {}
    for u in _ordre_unicode():
        g = fonte.has_glyph(u)
        if g and g not in gid2u:
            gid2u[g] = u
    items = sorted(gid2u.items())
    nl = "\n"
    en_tete = nl.join([
        "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
        "/CIDSystemInfo <</Registry(Adobe)/Ordering(UCS)/Supplement 0>> def",
        "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def", "1 begincodespacerange",
        "<0000> <FFFF>", "endcodespacerange", ""])
    corps = ""
    for i in range(0, len(items), 100):
        bloc = items[i:i + 100]
        corps += "%d beginbfchar%s" % (len(bloc), nl)
        corps += "".join("<%04x> <%04x>%s" % (g, u, nl) for g, u in bloc)
        corps += "endbfchar" + nl
    fin = nl.join(["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end", ""])
    return (en_tete + corps + fin).encode("ascii")


def reparer_tounicode(doc):
    """Les glyphes Arial partagés (espace/insécable, « - »/trait d'union conditionnel, « ; ») seraient extraits
    comme U+00A0, U+00AD, U+037E : on réécrit la table ToUnicode des polices ajoutées par l'outil."""
    fait = 0
    for xref in range(1, doc.xref_length()):
        try:
            obj = doc.xref_object(xref, compressed=True)
        except Exception:
            continue
        if "/Type0" not in obj or "/ToUnicode" not in obj:
            continue
        m = re.search(r"/BaseFont\s*/(?:[A-Z]{6}\+)?([^\s/]+)", obj)
        if not m:
            continue
        nom = m.group(1).replace("#20", " ")
        if not (nom.startswith("Arial") or nom.startswith("Times")):
            continue
        gras = "Bold" in nom
        ital = "Italic" in nom
        fam = "sans" if nom.startswith("Arial") else "serif"
        t = doc.xref_get_key(xref, "ToUnicode")
        if t[0] != "xref":
            continue
        doc.update_stream(int(t[1].split()[0]), _cmap_pour(police(fam, gras, ital)))
        fait += 1
    return fait

# ----------------------------------------------------------------------------------------------
# Application d'une correction
# ----------------------------------------------------------------------------------------------
def _cherche(para_list, ancien):
    cible = _norm_simple(ancien)
    if not cible:
        raise ErreurCorrection("champ « ancien » vide")
    trouves = []
    for p in para_list:
        cars, debuts = _cars_paragraphe(p)
        texte = "".join(c.ch for c in cars)
        norm, deb, fin = normaliser(texte)
        start = 0
        while True:
            i = norm.find(cible, start)
            if i < 0:
                break
            trouves.append((p, cars, debuts, deb[i], fin[i + len(cible) - 1]))
            start = i + 1
    return trouves


def _appliquer_une(doc, page, corr, num_corr, log):
    ancien, nouveau = corr["ancien"], corr["nouveau"]
    occ = corr.get("occurrence")
    paras = trouver_paragraphes(page)
    trouves = _cherche(paras, ancien)
    if not trouves:
        # tentative : césure interprétée comme espace
        raise ErreurCorrection("introuvable sur la page %d : « %s »" % (corr["page"], ancien))
    if occ is not None:
        if not (1 <= occ <= len(trouves)):
            raise ErreurCorrection("occurrence %s demandée mais %d trouvée(s)" % (occ, len(trouves)))
        trouves = [trouves[occ - 1]]
    elif len(trouves) > 1:
        raise ErreurCorrection(
            "ambigu sur la page %d : %d occurrences de « %s » (paragraphes %s) ; "
            "préciser davantage ou ajouter \"occurrence\": n" % (
                corr["page"], len(trouves), ancien, sorted({t[0].num for t in trouves})))
    para, cars, debuts, s, e = trouves[0]
    for c in cars:
        if c.fam is None:
            raise ErreurCorrection("police non prise en charge dans ce paragraphe (%s)" % [
                sp["font"] for ln in para.lignes for sp in ln.spans][0])
    ctx = analyser_contexte(page, para, paras)
    # style principal : style le plus fréquent
    freq = {}
    for c in cars:
        freq[c.style()] = freq.get(c.style(), 0) + 1
    st_princ = max(freq, key=freq.get)
    principal = next(c for c in cars if c.style() == st_princ)
    base = cars[s]
    nouveaux = _parser_nouveau(nouveau, base, principal, corr.get("typographie", True))
    cars_new = cars[:s] + nouveaux + cars[e:]
    largeur, info_larg, ok_calib = calibrer_largeur(page, para, paras, ctx, cars, debuts)
    unites_new = decouper_unites(cars_new)
    lignes_new = couper(unites_new, largeur)
    # interligne
    bases = [l.base for l in para.lignes]
    if len(bases) >= 2:
        dd = [bases[i + 1] - bases[i] for i in range(len(bases) - 1)]
        dd = [x for x in dd if x < min(dd) + 1.2]   # écarte les lignes à exposant (plus hautes)
        lead = sum(dd) / len(dd)   # Chrome arrondit chaque ligne à 0,75 pt : la moyenne évite la dérive
    else:
        t = para.lignes[0].taille
        lead = 15.5 if abs(t - 9.9) < 0.06 else 1.5 * t
    x0 = para.lignes[0].bbox[0]
    base0 = bases[0]
    ln_dernier = para.lignes[-1]
    desc = ln_dernier.bbox[3] - ln_dernier.base
    bas_nouveau = base0 + (len(lignes_new) - 1) * lead + desc
    bb = para.bbox
    bas_ancien = bb.y1

    # --- place disponible
    toutes = [l for p in paras for l in p.lignes if p is not para]
    obst = []
    for l in toutes:
        if l.bbox[1] >= bas_ancien - 0.5 and _chevauche_x(l.bbox[0], l.bbox[2], x0, x0 + largeur):
            obst.append(l.bbox[1])
    for b in page.get_text("dict")["blocks"]:
        if b["type"] == 1 and b["bbox"][1] >= bas_ancien - 0.5 and _chevauche_x(
                b["bbox"][0], b["bbox"][2], x0, x0 + largeur):
            obst.append(b["bbox"][1])
    C = ctx.conteneur["rect"] if ctx.conteneur is not None else None
    piece_rects = [d["rect"] for d in ctx.pieces.values()]
    obst_cont = []   # obstacles extérieurs au conteneur
    for d in page.get_drawings():
        r = d["rect"]
        if r == (C if C is not None else None):
            continue
        if any(r == pr for pr in piece_rects):
            continue
        if C is not None and r.x0 == C.x0 and r.y0 == C.y0 and r.x1 == C.x1 and r.y1 == C.y1:
            continue
        if r.width * r.height > 0.9 * page.rect.width * page.rect.height:
            continue
        if _contient(r, bb, 1.0):
            if d.get("fill") is None and r.width > 0.5 * page.rect.width:
                obst_cont.append(("cadre", r.y1 - 2 * MARGE))  # ne pas franchir le cadre de la page
            continue
        if r.y0 >= bas_ancien - 0.5 and _chevauche_x(r.x0, r.x1, x0, x0 + largeur):
            if C is not None and _contient(C, r, 0.6):
                obst.append(r.y0)
            else:
                obst_cont.append(("dessin", r.y0))
    # texte / images en dessous du conteneur (déjà dans obst) : on sépare dedans / dehors
    interieur = [y for y in obst if C is None or y < C.y1 - 1.0]
    exterieur = [y for y in obst if C is not None and y >= C.y1 - 1.0] if C is not None else []
    ext = exterieur + [y for _, y in obst_cont]
    extension = None
    if C is None:
        limite = (min(obst + [y for _, y in obst_cont]) - MARGE) if (obst or obst_cont) else page.rect.y1
        reste = limite - bas_nouveau
        deborde = -reste if reste < 0 else 0
    else:
        marge_bas = C.y1 - bas_ancien   # rembourrage bas d'origine (jusqu'au bord de l'encadré)
        if interieur:
            limite = min(interieur) - MARGE
            reste = limite - bas_nouveau
            deborde = -reste if reste < 0 else 0
        else:
            nouveau_bas_C = bas_nouveau + marge_bas
            if nouveau_bas_C <= C.y1 + 1e-6:
                reste = C.y1 - nouveau_bas_C
                deborde = 0
            else:
                limite_ext = (min(ext) - MARGE) if ext else page.rect.y1
                reste = limite_ext - nouveau_bas_C
                deborde = -reste if reste < 0 else 0
                if deborde == 0:
                    extension = nouveau_bas_C
    nb_anc, nb_new = len(para.lignes), len(lignes_new)
    entree = {"page": corr["page"], "ancien": ancien, "nouveau": nouveau, "lignes_avant": nb_anc,
              "lignes_apres": nb_new, "largeur": round(largeur, 1), "calibrage": info_larg,
              "place_restante_pt": round(reste, 1), "paragraphe": para.num,
              "encadre_agrandi_de_pt": None, "statut": "ok"}
    if deborde > 0:
        entree["statut"] = "REFUSÉ"
        entree["erreur"] = "déborde de %.1f pt" % deborde
        log.append(entree)
        raise ErreurCorrection("page %d : « %s » -> déborde de %.1f pt (%d lignes au lieu de %d)" % (
            corr["page"], ancien, deborde, nb_new, nb_anc))

    # --- effacement du texte du paragraphe seul
    zone = pymupdf.Rect(bb.x0 + 0.3, bb.y0 + 0.8, bb.x1 - 0.3, bb.y1 - 0.8)
    for p in paras:
        if p is para:
            continue
        for l in p.lignes:
            if pymupdf.Rect(l.bbox).intersects(zone):
                raise ErreurCorrection("la zone du paragraphe chevauche un autre texte (page %d)" % corr["page"])
    page.add_redact_annot(zone, fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)

    # --- agrandissement de l'encadré
    if extension is not None:
        assert C is not None
        fill = ctx.conteneur["fill"]
        bas = ctx.pieces.get("bas")
        y_deb = bas["rect"].y0 if bas is not None else C.y1 - 0.7
        page.draw_rect(pymupdf.Rect(C.x0, y_deb, C.x1, extension), color=None, fill=fill, width=0)
        for nom in ("droite", "bas", "gauche"):
            pc = ctx.pieces.get(nom)
            if pc is None:
                continue
            r = pc["rect"]
            if nom == "bas":
                nr = pymupdf.Rect(r.x0, extension - r.height, r.x1, extension)
            else:
                nr = pymupdf.Rect(r.x0, y_deb, r.x1, extension)
            page.draw_rect(nr, color=None, fill=pc["fill"], width=0)
        entree["encadre_agrandi_de_pt"] = round(extension - C.y1, 1)

    # --- écriture
    ecrivains = {}
    for k, lig in enumerate(lignes_new):
        y = base0 + k * lead
        x = x0
        cs = _cars_de_ligne(lig)
        i, n = 0, len(cs)
        while i < n:
            j = i
            st = cs[i].style()
            while j < n and cs[j].style() == st:
                j += 1
            c = cs[i]
            f = police(c.fam, c.gras, c.ital)
            txt = "".join(z.ch for z in cs[i:j])
            for z in txt:
                if not f.has_glyph(ord(z)):
                    raise ErreurCorrection("caractère absent de la police : U+%04X (%r)" % (ord(z), z))
            col = c.couleur
            rgb = (((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255)
            if rgb not in ecrivains:
                ecrivains[rgb] = pymupdf.TextWriter(page.rect, color=rgb)
            ecrivains[rgb].append(pymupdf.Point(x, y + c.dy), txt, font=f, fontsize=c.taille)
            x += f.text_length(txt, c.taille)
            i = j
    for tw in ecrivains.values():
        tw.write_text(page)
    log.append(entree)
    return entree


def _enregistrer(doc, chemin):
    """Enregistre ; si `chemin` est le fichier ouvert lui-même, passe par un fichier temporaire."""
    if os.path.abspath(chemin) == os.path.abspath(doc.name or ""):
        tmp = chemin + ".tmp"
        doc.save(tmp, garbage=3, deflate=True)
        doc.close()
        os.replace(tmp, chemin)
    else:
        doc.save(chemin, garbage=3, deflate=True)
        doc.close()


def appliquer(pdf_entree, pdf_sortie, corrections, polices_incorporees_reduites=True, verbeux=True):
    """Applique la liste de corrections ; écrit pdf_sortie.
    Les corrections refusées (introuvable, ambigu, déborde) sont signalées et ignorées ; le fichier est écrit
    avec les autres. Renvoie (journal, erreurs)."""
    doc = pymupdf.open(pdf_entree)
    journal, erreurs = [], []
    for i, corr in enumerate(corrections):
        n = corr["page"]
        try:
            if not (1 <= n <= doc.page_count):
                raise ErreurCorrection("page %d inexistante (%d pages)" % (n, doc.page_count))
            _appliquer_une(doc, doc[n - 1], corr, i, journal)
        except ErreurCorrection as ex:
            erreurs.append({"correction": i, "page": n, "ancien": corr.get("ancien"), "erreur": str(ex)})
            if verbeux:
                print("  ERREUR  %s" % ex)
            continue
        if verbeux:
            e = journal[-1]
            print("  ok p.%d  lignes %d -> %d, place restante %.1f pt%s  [%s]" % (
                e["page"], e["lignes_avant"], e["lignes_apres"], e["place_restante_pt"],
                (", encadré agrandi de %.1f pt" % e["encadre_agrandi_de_pt"]) if e["encadre_agrandi_de_pt"] else "",
                e["calibrage"]))
    if polices_incorporees_reduites:
        try:
            doc.subset_fonts()
        except Exception as ex:  # fonttools absent, etc.
            if verbeux:
                print("  (réduction des polices ignorée : %s)" % ex)
    reparer_tounicode(doc)
    _enregistrer(doc, pdf_sortie)
    return journal, erreurs


def appliquer_dossier(dossier_originaux, fichier_corrections, dossier_sortie):
    """Applique tout `corrections.json` ({"Cahier_1.pdf": [...], ...}) ; les cahiers sans correction sont copiés."""
    with open(fichier_corrections, encoding="utf-8") as f:
        tout = json.load(f)
    os.makedirs(dossier_sortie, exist_ok=True)
    bilan = {}
    for nom in sorted(os.listdir(dossier_originaux)):
        if not nom.lower().endswith(".pdf"):
            continue
        src = os.path.join(dossier_originaux, nom)
        dst = os.path.join(dossier_sortie, nom)
        corr = tout.get(nom, [])
        print("%s : %d correction(s)" % (nom, len(corr)))
        if corr:
            bilan[nom] = appliquer(src, dst, corr)
        else:
            import shutil
            shutil.copyfile(src, dst)
    inconnus = set(tout) - set(os.listdir(dossier_originaux))
    for nom in sorted(inconnus):
        print("ATTENTION : %s figure dans le JSON mais pas dans le dossier" % nom)
    nerr = sum(len(v[1]) for v in bilan.values())
    print("Terminé : %d erreur(s) de correction." % nerr)
    return bilan


# ----------------------------------------------------------------------------------------------
# Ajout d'une page
# ----------------------------------------------------------------------------------------------
def ajouter_page(pdf_entree, pdf_sortie, html):
    """Imprime `html` avec Chrome sans interface, vérifie 1 page Lettre, l'ajoute à la fin du cahier."""
    if not os.path.exists(CHROME):
        raise ErreurCorrection("Chrome introuvable : " + CHROME)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        fh = os.path.join(tmp, "page.html")
        fp = os.path.join(tmp, "page.pdf")
        with open(fh, "w", encoding="utf-8") as f:
            f.write(html)
        cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
               "--user-data-dir=" + os.path.join(tmp, "profil"), "--print-to-pdf=" + fp,
               "file:///" + fh.replace("\\", "/")]
        subprocess.run(cmd, check=False, capture_output=True, timeout=120)
        if not os.path.exists(fp):
            raise ErreurCorrection("Chrome n'a pas produit de PDF")
        nouv = pymupdf.open(fp)
        try:
            if nouv.page_count != 1:
                raise ErreurCorrection("la page imprimée fait %d pages au lieu de 1 (contenu trop long ?)" %
                                       nouv.page_count)
            r = nouv[0].rect
            if abs(r.width - 612) > 1 or abs(r.height - 792) > 1:
                raise ErreurCorrection("format %.0f×%.0f pt au lieu de 612×792" % (r.width, r.height))
            doc = pymupdf.open(pdf_entree)
            doc.insert_pdf(nouv)
            n = doc.page_count
            _enregistrer(doc, pdf_sortie)
        finally:
            nouv.close()
    return n


def remplir_gabarit(chemin_gabarit, cahier, page):
    with open(chemin_gabarit, encoding="utf-8") as f:
        h = f.read()
    return h.replace("{{CAHIER}}", str(cahier)).replace("{{PAGE}}", str(page))


# ----------------------------------------------------------------------------------------------
# Rendu et comparaison
# ----------------------------------------------------------------------------------------------
def rendre(pdf, pages, dossier, dpi=110):
    """PNG des pages (numérotées à partir de 1) ; renvoie les chemins."""
    os.makedirs(dossier, exist_ok=True)
    doc = pymupdf.open(pdf)
    base = os.path.splitext(os.path.basename(pdf))[0]
    res = []
    for n in pages:
        pix = doc[n - 1].get_pixmap(dpi=dpi)
        chemin = os.path.join(dossier, "%s_p%02d.png" % (base, n))
        pix.save(chemin)
        res.append(chemin)
    doc.close()
    return res


def comparer(pdf_avant, pdf_apres, verbeux=True):
    """Différentiel de texte par page. Renvoie {'pages': (a, b), 'diff': {page: {'retirees': [...], 'ajoutees': [...]}}}."""
    a, b = pymupdf.open(pdf_avant), pymupdf.open(pdf_apres)
    res = {"pages": (a.page_count, b.page_count), "diff": {}}
    if verbeux:
        print("Pages : %d -> %d" % res["pages"])
    for i in range(max(a.page_count, b.page_count)):
        la = _lignes_texte(a[i]) if i < a.page_count else []
        lb = _lignes_texte(b[i]) if i < b.page_count else []
        ca, cb = list(la), list(lb)
        retirees = []
        for l in la:
            if l in cb:
                cb.remove(l)
            else:
                retirees.append(l)
        ajoutees = cb
        if retirees or ajoutees:
            res["diff"][i + 1] = {"retirees": retirees, "ajoutees": ajoutees}
            if verbeux:
                print("Page %d : %d ligne(s) retirée(s), %d ajoutée(s)" % (i + 1, len(retirees), len(ajoutees)))
                for l in retirees:
                    print("   - " + l)
                for l in ajoutees:
                    print("   + " + l)
    if verbeux and not res["diff"]:
        print("Aucune différence de texte.")
    a.close()
    b.close()
    return res


def _lignes_texte(page):
    out = []
    for ln in _lignes_page(page):
        out.append(_norm_simple(ln.texte))
    return out


# ----------------------------------------------------------------------------------------------
# Ligne de commande
# ----------------------------------------------------------------------------------------------
def _main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("appliquer-tout", help="applique corrections.json à un dossier d'originaux")
    a.add_argument("originaux")
    a.add_argument("corrections")
    a.add_argument("sortie")
    a = sp.add_parser("appliquer", help="applique des corrections à un seul PDF")
    a.add_argument("entree")
    a.add_argument("sortie")
    a.add_argument("corrections", help="JSON : liste, ou dictionnaire {nom: liste}")
    a = sp.add_parser("ajouter-page", help="ajoute une page HTML (Chrome) à la fin d'un cahier")
    a.add_argument("entree")
    a.add_argument("sortie")
    a.add_argument("html", help="fichier HTML (gabarit rempli ou non)")
    a.add_argument("--cahier", help="remplace {{CAHIER}}")
    a.add_argument("--page", help="remplace {{PAGE}}")
    a = sp.add_parser("rendre", help="PNG de pages")
    a.add_argument("pdf")
    a.add_argument("dossier")
    a.add_argument("pages", type=int, nargs="+")
    a.add_argument("--dpi", type=int, default=110)
    a = sp.add_parser("comparer", help="différentiel de texte avant/après")
    a.add_argument("avant")
    a.add_argument("apres")
    a = sp.add_parser("paragraphes", help="liste les paragraphes détectés d'une page (aide à écrire « ancien »)")
    a.add_argument("pdf")
    a.add_argument("page", type=int)
    args = ap.parse_args(argv)
    if args.cmd == "appliquer-tout":
        bilan = appliquer_dossier(args.originaux, args.corrections, args.sortie)
        return 1 if any(v[1] for v in bilan.values()) else 0
    if args.cmd == "appliquer":
        with open(args.corrections, encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c, dict):
            nom = os.path.basename(args.entree)
            if nom not in c:
                raise SystemExit("« %s » absent du JSON (clés : %s)" % (nom, ", ".join(c)))
            c = c[nom]
        j, e = appliquer(args.entree, args.sortie, c)
        return 1 if e else 0
    if args.cmd == "ajouter-page":
        with open(args.html, encoding="utf-8") as f:
            h = f.read()
        if args.cahier:
            h = h.replace("{{CAHIER}}", args.cahier)
        if args.page:
            h = h.replace("{{PAGE}}", args.page)
        print("pages :", ajouter_page(args.entree, args.sortie, h))
        return 0
    if args.cmd == "rendre":
        for c in rendre(args.pdf, args.pages, args.dossier, args.dpi):
            print(c)
        return 0
    if args.cmd == "comparer":
        r = comparer(args.avant, args.apres)
        return 0
    if args.cmd == "paragraphes":
        doc = pymupdf.open(args.pdf)
        for p in trouver_paragraphes(doc[args.page - 1]):
            bb = p.bbox
            print("[%d] x=%.1f y=%.1f lignes=%d taille=%.1f : %s" % (
                p.num, bb.x0, bb.y0, len(p.lignes), p.lignes[0].taille, texte_paragraphe(p)))
        return 0


if __name__ == "__main__":
    sys.exit(_main())
