#!/usr/bin/env python3
"""Regénère sitemap.xml à partir des pages du site (index.html).

Pages exclues : l'espace d'administration, les archives, et toute page marquée
<meta name="robots" content="noindex">. La date de dernière modification vient de git.
Lancer depuis la racine du dépôt :  python3 outils/sitemap.py
"""
import os
import re
import subprocess

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://niderlabs.com"
EXCLUS = ("espace", "archives", "outils", ".git", ".github", "node_modules")


def date_git(chemin):
    try:
        d = subprocess.run(["git", "log", "-1", "--format=%cs", "--", chemin], cwd=RACINE,
                           capture_output=True, text=True, check=False).stdout.strip()
        return d or None
    except OSError:
        return None


def pages():
    for dossier, sous, fichiers in os.walk(RACINE):
        rel = os.path.relpath(dossier, RACINE)
        if rel != "." and rel.split(os.sep)[0] in EXCLUS:
            sous[:] = []
            continue
        sous.sort()
        if "index.html" not in fichiers:
            continue
        chemin = os.path.join(dossier, "index.html")
        with open(chemin, encoding="utf-8") as f:
            html = f.read()
        if re.search(r'<meta\s+name="robots"\s+content="[^"]*noindex', html, re.I):
            continue
        url = SITE + "/" + ("" if rel == "." else rel.replace(os.sep, "/") + "/")
        yield url, date_git(os.path.relpath(chemin, RACINE))


def main():
    lignes = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    n = 0
    for url, date in sorted(pages()):
        lignes.append("  <url><loc>%s</loc>%s</url>" % (url, "<lastmod>%s</lastmod>" % date if date else ""))
        n += 1
    lignes.append("</urlset>")
    with open(os.path.join(RACINE, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lignes) + "\n")
    print("sitemap.xml : %d pages" % n)


if __name__ == "__main__":
    main()
