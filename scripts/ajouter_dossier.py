#!/usr/bin/env python3
"""Publie un dossier clinique pour tous les utilisateurs : copie les fichiers dans
dossiers/<id>/ et ajoute l'entrée correspondante à dossiers/catalogue.json.

Exemple :
  python3 scripts/ajouter_dossier.py --id orl-01 --titre "Oropharynx T2N1" --categorie ORL \
      --images chemin/vers/CT/ --rtstruct RS.dcm --pdf histoire.pdf \
      --cible CTV_T --cible CTV_N --mot-de-passe secret

Les fichiers doivent être anonymisés avant publication.
"""
import argparse, hashlib, json, pathlib, shutil, sys

CATEGORIES = ['Crâne', 'ORL', 'Sein', 'Poumon', 'Œsophage', 'Foie', 'Pancréas', 'Rein',
              'Col utérin', 'Endomètre', 'Vessie', 'Prostate', 'Rectum', 'Canal anal', 'Os']
RACINE = pathlib.Path(__file__).resolve().parent.parent


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--id', required=True, help='identifiant court (lettres, chiffres, tirets)')
    p.add_argument('--titre', required=True)
    p.add_argument('--categorie', required=True, choices=CATEGORIES)
    p.add_argument('--images', required=True, type=pathlib.Path, help='dossier des images DICOM')
    p.add_argument('--rtstruct', required=True, type=pathlib.Path)
    p.add_argument('--pdf', required=True, type=pathlib.Path)
    p.add_argument('--cible', action='append', required=True, help='structure à contourer (répéter)')
    p.add_argument('--mot-de-passe', required=True)
    a = p.parse_args()

    if not a.id.replace('-', '').isalnum():
        sys.exit("--id : lettres, chiffres et tirets uniquement")
    images = sorted(f for f in a.images.rglob('*') if f.is_file() and not f.name.startswith('.'))
    if not images:
        sys.exit(f"aucun fichier dans {a.images}")

    dest = RACINE / 'dossiers' / a.id
    if dest.exists():
        sys.exit(f"{dest} existe déjà")
    (dest / 'images').mkdir(parents=True)
    noms = []
    for k, f in enumerate(images):
        nom = f'{k + 1:04d}.dcm'
        shutil.copyfile(f, dest / 'images' / nom)
        noms.append(f'dossiers/{a.id}/images/{nom}')
    shutil.copyfile(a.rtstruct, dest / 'rtstruct.dcm')
    shutil.copyfile(a.pdf, dest / 'histoire.pdf')

    cat_path = RACINE / 'dossiers' / 'catalogue.json'
    cat = json.loads(cat_path.read_text(encoding='utf-8')) if cat_path.exists() else {'dossiers': []}
    cat['dossiers'] = [d for d in cat['dossiers'] if d['id'] != a.id]
    cat['dossiers'].append({
        'id': a.id, 'titre': a.titre, 'categorie': a.categorie, 'cibles': a.cible,
        'mot_de_passe_sha256': hashlib.sha256(a.mot_de_passe.encode('utf-8')).hexdigest(),
        'pdf': f'dossiers/{a.id}/histoire.pdf', 'rtstruct': f'dossiers/{a.id}/rtstruct.dcm', 'images': noms,
    })
    cat_path.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f"{a.titre} : {len(noms)} images copiées dans {dest.relative_to(RACINE)}, catalogue mis à jour.")
    print("Les noms des cibles sont vérifiés à l'ouverture : ils doivent correspondre aux ROI du RTSTRUCT.")


if __name__ == '__main__':
    main()
