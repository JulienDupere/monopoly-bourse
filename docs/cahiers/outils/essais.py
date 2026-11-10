import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import outils_cahiers as oc
W = os.path.dirname(os.path.abspath(__file__))
O = W + "/originaux/Cahier_1.pdf"
E = W + "/essais"
os.makedirs(E, exist_ok=True)
tests = {
 "meme_longueur": [{"page":15,"ancien":"à votre prix limite (chapitre 11).","nouveau":"à votre prix plafond (chapitre 12)."}],
 "plus_long": [{"page":15,"ancien":"à votre prix limite (chapitre 11).","nouveau":"à votre prix limite (chapitre 11), jamais à un prix moins favorable que celui que vous avez vous-même fixé : c'est la règle."}],
 "cellule_gras": [{"page":15,"ancien":"Aucune limite","nouveau":"**Aucune limite (à surveiller)**"}],
 "milieu_gras": [{"page":6,"ancien":"La somme des mouvements doit toujours être nulle.","nouveau":"La somme des mouvements doit toujours rester **exactement nulle**."}],
 "p6_deborde": [{"page":6,"ancien":"La somme des mouvements doit toujours être nulle.","nouveau":"La somme des mouvements doit toujours rester exactement nulle, au centime près, quels que soient le montant et les parties concernées."}],
 "deborde": [{"page":15,"ancien":"Jamais","nouveau":"Jamais, aucun coût de portage, aucun intérêt, aucune charge, aucun frais caché, rien du tout à payer pendant la durée de la position, jamais."}],
 "introuvable": [{"page":15,"ancien":"texte qui n'existe pas","nouveau":"x"}],
 "tout_p15": None,
}
tests["tout_p15"] = tests["plus_long"] + tests["cellule_gras"]
for nom, c in tests.items():
    out = "%s/%s.pdf" % (E, nom)
    print("==", nom)
    j, er = oc.appliquer(O, out, c)
    if os.path.exists(out):
        pg = c[0]["page"]
        oc.rendre(out, [pg], E + "/png")
        oc.comparer(O, out)
oc.rendre(O, [6, 15], E + "/png_orig")
