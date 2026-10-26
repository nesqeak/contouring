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

Bouton **Ajouter un dossier** en bas du menu, mot de passe de chargement `sfro`. La fenêtre demande le nom du dossier, le type tumoral, les images DICOM (fichiers ou dossier), le fichier structure (RTSTRUCT), le PDF de l'histoire clinique et le mot de passe d'ouverture du dossier. Une fois le RTSTRUCT choisi, ses structures s'affichent une par ligne avec deux cases : **Structure à charger** (cochée par défaut, sauf pour une structure sans contour) et **Structure cible**. Une case en haut de la liste coche ou décoche d'un coup toutes les structures à charger. Seules les structures à charger sont ajoutées au dossier. Une cible est toujours chargée : elle est créée vide, sous son nom du RTSTRUCT, pour être contourée, et son contour du fichier sert de référence au Dice.

Le chargement est refusé, avec la liste des erreurs, si un élément manque, si les images ou le RTSTRUCT sont illisibles, si aucune structure n'est cochée comme cible, si deux cibles portent le même nom ou si le contour d'une cible ne recoupe pas les images.

Où le dossier est enregistré dépend de la façon dont la plateforme est servie :

- **Publiée comme Artifact claude.ai (stockage partagé)**, à partir de `artifact.html` : le dossier est visible par toutes les personnes avec qui l'Artifact est partagé. Ses métadonnées vont dans la base partagée de l'Artifact (collection `dossiers`, modifiable par les seuls éditeurs) et ses fichiers dans les assets de l'Artifact. Les assets n'acceptent pas le DICOM : au chargement, le scanner est converti en PNG 16 bits en niveaux de gris (HU + 1024, sans perte, jusqu'à 18 Mo de pixels par image) et le RTSTRUCT en JSON (contours en coordonnées voxel). Seuls les éditeurs de l'Artifact peuvent ajouter ou supprimer un dossier ; le PDF est limité à 20 Mo.
- **Site statique (GitHub Pages, serveur local)**, à partir de `index.html` : le dossier est enregistré dans le navigateur qui l'a chargé (IndexedDB), et seulement là. Pour publier un dossier pour tous sur le site statique, l'ajouter au dépôt avec le script :

```bash
python3 scripts/ajouter_dossier.py --id orl-01 --titre "Oropharynx T2N1" --categorie ORL \
    --images chemin/CT/ --rtstruct RS.dcm --pdf histoire.pdf \
    --cible CTV_T --cible CTV_N --charger Moelle --charger Parotide_G --mot-de-passe secret
```

(`--charger`, facultatif et répétable, limite les structures non cibles affichées ; sans lui, toutes les structures du RTSTRUCT sont chargées.)

Le script copie les fichiers dans `dossiers/orl-01/` et ajoute le dossier à `dossiers/catalogue.json` (le mot de passe y est stocké sous forme d'empreinte SHA-256). Il reste à committer et pousser. Tous les fichiers doivent être anonymisés avant d'être publiés.

Dans les deux cas, les contours en cours et l'historique des scores restent propres à chaque utilisateur, dans son navigateur.

### Contourage

- Les structures choisies au chargement sont affichées en lecture seule, sauf les structures cibles : celles-ci sont créées vides et modifiables, et leur contour de référence reste masqué.
- Outils repris de la visionneuse d'origine : pinceau et gomme (rayon 1–25 mm), option pour ne pas peindre l'air ni l'os, copie de la coupe voisine, vider la coupe, effacer la structure, annulation (Ctrl+Z).
- **Interpoler les coupes** (raccourci I) : après avoir contouré une coupe axiale sur deux ou trois, crée les coupes intermédiaires de la structure active. Pour une coupe située à la fraction t entre deux coupes contourées, chaque contour est déplacé de la fraction correspondante du vecteur entre leurs barycentres (la moitié pour la coupe du milieu), puis les deux formes sont fondues par interpolation de cartes de distance signée, ce qui fait aussi évoluer la forme progressivement. Une coupe interpolée retouchée à la main devient une coupe de référence et n'est plus recalculée ; Ctrl+Z annule l'interpolation. Raccourcis : P pinceau, G gomme, I interpoler, `[` et `]` rayon, flèches haut/bas pour la coupe axiale.
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
| `js/shared.js` | stockage partagé de l'Artifact : base `dossiers`, assets, codage PNG 16 bits du scanner |
| `artifact.html` | point d'entrée de la version Artifact (mêmes scripts que `index.html`) |
| `js/app.js` | menu, chargement des dossiers, mots de passe, navigation |
| `dossiers/catalogue.json` | dossiers publiés pour tous |
| `assets/logo-hcl.png` | logo des HCL affiché à côté du titre |
| `lib/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) 2.5.2, licence MIT (`lib/jspdf.LICENSE`) |

## Limites

Les mots de passe sont vérifiés dans le navigateur (celui du chargement, `sfro`, figure en clair dans `js/app.js`) : ils limitent l'accès aux dossiers dans le cadre d'une formation mais ne protègent pas les fichiers publiés, qui restent téléchargeables par qui connaît leur adresse. D'où l'exigence d'anonymisation.
