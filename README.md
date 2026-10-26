# Plateforme d'entraînement au contourage

Application web statique (HTML + JavaScript, sans serveur applicatif) d'entraînement au contourage en radiothérapie. La visionneuse reprend celle du dépôt [contourage](https://github.com/nesqeak/contourage), sans ses images scanner : les images, les structures et l'histoire clinique sont fournies dossier par dossier.

> Plateforme à but de formation. Elle ne doit pas être utilisée pour la planification clinique.

## Utilisation

Servir la racine du dépôt par un serveur web (GitHub Pages, ou en local) :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

### Menu principal

Les dossiers sont classés par localisation tumorale (Crâne, ORL, Sein, Poumon, Œsophage, Foie, Pancréas, Rein, Col utérin, Endomètre, Vessie, Prostate, Rectum, Canal anal, Os). Chaque ligne donne accès à :

- **Histoire clinique** : le PDF du dossier ;
- **Contourage** : ouverture dans la visionneuse, après saisie du mot de passe du dossier ;
- **Historique** : scores Dice des sessions validées, courbes de progression et export PDF.

### Ajouter un dossier

Bouton **Ajouter un dossier** en bas du menu, mot de passe de chargement `sfro`. La fenêtre demande le nom du dossier, le type tumoral, les images DICOM (fichiers ou dossier), le fichier structure (RTSTRUCT), le PDF de l'histoire clinique, la liste des structures à contourer et le mot de passe d'ouverture du dossier.

Le chargement est refusé, avec la liste des erreurs, si un élément manque, si les images ou le RTSTRUCT sont illisibles, si une structure à contourer n'existe pas dans le RTSTRUCT (la comparaison des noms ignore la casse) ou si son contour ne recoupe pas les images.

**Important : un dossier ajouté par ce bouton est enregistré dans le navigateur qui l'a chargé (IndexedDB), et seulement là.** Le site étant statique, il n'a pas d'espace de stockage commun. Pour publier un dossier pour tous les utilisateurs, l'ajouter au dépôt avec le script :

```bash
python3 scripts/ajouter_dossier.py --id orl-01 --titre "Oropharynx T2N1" --categorie ORL \
    --images chemin/CT/ --rtstruct RS.dcm --pdf histoire.pdf \
    --cible CTV_T --cible CTV_N --mot-de-passe secret
```

Le script copie les fichiers dans `dossiers/orl-01/` et ajoute le dossier à `dossiers/catalogue.json` (le mot de passe y est stocké sous forme d'empreinte SHA-256). Il reste à committer et pousser. Tous les fichiers doivent être anonymisés avant d'être publiés.

### Contourage

- Les structures du RTSTRUCT sont affichées en lecture seule, sauf les structures cibles : celles-ci sont créées vides et modifiables, et leur contour de référence reste masqué.
- Outils repris de la visionneuse d'origine : pinceau et gomme (rayon 1–25 mm), option pour ne pas peindre l'air ni l'os, copie de la coupe voisine, vider la coupe, effacer la structure, annulation (Ctrl+Z). Raccourcis : P pinceau, G gomme, `[` et `]` rayon, flèches haut/bas pour la coupe axiale.
- Les contours en cours sont enregistrés dans le navigateur après chaque tracé et sont repris quand on rouvre le dossier.
- **Validation des contours** (en bas de la visionneuse) : après confirmation, les contours sont figés, les contours de référence des cibles s'affichent en pointillés et l'index de Dice de chaque cible (2 |A ∩ B| / (|A| + |B|), calculé sur la grille du scanner) remplace les outils de contourage. Le résultat est enregistré avec sa date, et le dossier rouvert ensuite repart d'une session vierge.

### Historique

Pour chaque dossier : tableau des Dice par validation, courbes de progression avec le seuil de 80 % en pointillés rouges, export PDF (type tumoral, nom du dossier, résultats et courbe). Les résultats sont conservés dans le navigateur de l'utilisateur.

## Formats pris en charge

- Images : série CT DICOM non compressée (Implicit ou Explicit VR Little Endian), 16 bits, coupes axiales. La série la plus longue est retenue si plusieurs sont fournies. Les images compressées (JPEG, JPEG 2000…) sont refusées avec un message.
- Structures : RTSTRUCT, contours `CLOSED_PLANAR`, rastérisés sur la grille du scanner (les contours d'une même coupe se combinent en OU exclusif pour respecter les trous).

## Fichiers

| Chemin | Contenu |
|---|---|
| `index.html`, `css/app.css` | page et styles |
| `js/dicom.js` | lecture DICOM, volume CT, RTSTRUCT, rastérisation |
| `js/viewer.js` | visionneuse, outils de contourage, validation et Dice |
| `js/history.js` | historique, courbes, export PDF |
| `js/store.js` | stockage local (IndexedDB) |
| `js/app.js` | menu, chargement des dossiers, mots de passe, navigation |
| `dossiers/catalogue.json` | dossiers publiés pour tous |
| `assets/logo-hcl.png` | logo des HCL affiché à côté du titre (à déposer) |
| `lib/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) 2.5.2, licence MIT (`lib/jspdf.LICENSE`) |

## Limites

Les mots de passe sont vérifiés dans le navigateur (celui du chargement, `sfro`, figure en clair dans `js/app.js`) : ils limitent l'accès aux dossiers dans le cadre d'une formation mais ne protègent pas les fichiers publiés, qui restent téléchargeables par qui connaît leur adresse. D'où l'exigence d'anonymisation.
