# Plateforme d'entraînement au contourage

Application web statique (HTML + JavaScript, sans serveur applicatif) d'entraînement au contourage en radiothérapie. La visionneuse reprend celle du dépôt [contourage](https://github.com/nesqeak/contourage), sans ses images scanner : les images, les structures et l'histoire clinique sont fournies dossier par dossier.

> Plateforme à but de formation. Elle ne doit pas être utilisée pour la planification clinique.

## Utilisation

Servir la racine du dépôt par un serveur web (GitHub Pages, ou en local) :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

### Comptes et connexion

Toutes les pages portent un bandeau avec le logo des HCL et le titre « Plateforme d'entraînement au contourage ». La page d'accueil permet de se connecter avec une adresse e-mail et un mot de passe. Au tout premier démarrage (aucun compte), elle propose de créer le compte administrateur principal, avec son mot de passe.

- **Création des comptes** : par un administrateur (bouton **Créer un compte**) : nom, prénom, adresse e-mail (identifiant) et type de compte, **Étudiant** ou **Administrateur**. Le site génère un **code d'activation à 8 chiffres**, affiché une seule fois (bouton pour le copier) et conservé uniquement sous forme hachée ; l'administrateur le transmet à la personne.
- **Première connexion** : adresse e-mail et code d'activation (le champ du code remplace celui du mot de passe pour un compte non activé), puis le profil s'affiche et doit être complété : subdivision (Clermont-Ferrand, Grenoble, Lyon, Saint-Etienne), année de début d'internat (de 2000 à l'année en cours, étudiants seulement) et mot de passe (au moins 12 caractères, dont un chiffre et une majuscule). Ces informations ne sont plus modifiables ensuite, sauf le mot de passe.
- **Profil** (bouton en haut de page) : rappel des informations, changement du mot de passe (protégé par le mot de passe actuel) et, pour les internes, la liste de leurs semestres (10 lignes, du 1er au 10ème semestre : période, spécialité, terrain de stage).
- **Interne** : liste des dossiers avec Histoire clinique, Contourage et Historique de ses propres scores.
- **Administrateur** : liste des dossiers avec **Statistiques** (moyenne, médiane, écart type, minimum et maximum du Dice par structure, sur la dernière validation de chaque interne, exportables en PDF), ajout de dossiers, suppression d'un dossier par le bouton **Supprimer** en fin de ligne (avertissement « Attention cette action est irréversible » et mot de passe administrateur requis), **Créer un compte** et **Suivi des internes**.
- **Administrateurs** (bouton sur l'accueil administrateur) : liste des comptes administrateurs (nom, e-mail, subdivision, état d'activation, date de création) avec, pour les autres administrateurs, **Nouveau code** (compte non activé), **Réinitialiser le mot de passe** et **Supprimer** (avertissement d'irréversibilité, mot de passe administrateur requis). On ne peut pas supprimer son propre compte, et il doit toujours rester au moins un autre administrateur activé.
- **Suivi des internes** : menu déroulant des internes par ordre alphabétique (nom, prénom, subdivision, année de début), filtrable par subdivision et par année. Pour l'interne choisi : profil, semestres en consultation, fiches d'historique des scores par dossier, groupées par localisation dans des menus repliables. Le bouton **Exporter le suivi en PDF** produit un document avec le profil, les semestres et, par localisation puis par dossier, le tableau des validations et la courbe de progression. État d'activation du compte ; pour un compte pas encore activé, bouton **Nouveau code d'activation** (mot de passe administrateur requis, l'ancien code cesse de fonctionner). Boutons **Réinitialiser le mot de passe** (après saisie du mot de passe administrateur, l'administrateur choisit le nouveau mot de passe) et **Supprimer le compte** (avertissement d'irréversibilité, mot de passe administrateur requis ; le compte et ses résultats sont supprimés).

Les mots de passe sont stockés hachés (PBKDF2-SHA-256, 150 000 itérations, sel aléatoire). Les comptes et les résultats Dice sont enregistrés dans la base partagée de l'Artifact (collections `comptes` et `resultats`) ou, sur le site statique, dans le navigateur. Le stockage passe par `js/accounts.js`, qui isole ces opérations pour pouvoir brancher plus tard un serveur (Supabase, serveur des HCL). Les contours en cours restent dans le navigateur, propres à chaque compte.

### Menu principal

Les dossiers sont classés par localisation tumorale (Crâne, ORL, Sein, Poumon, Œsophage, Foie, Pancréas, Rein, Col utérin, Endomètre, Vessie, Prostate, Rectum, Canal anal, Os). Chaque localisation se replie ou se déplie d'un clic sur son nom (boutons **Tout déplier** et **Tout replier** ; l'état est retenu dans le navigateur, et une localisation avec des dossiers est dépliée par défaut). Chaque ligne donne accès à :

- **Histoire clinique** : le PDF du dossier ;
- **Contourage** : ouverture dans la visionneuse (sans mot de passe propre au dossier : il faut être connecté à son compte pour voir la liste) ;
- **Historique** : scores Dice des sessions validées, courbes de progression et export PDF.

### Ajouter un dossier

Bouton **Ajouter un dossier** (comptes administrateurs). La fenêtre demande le nom du dossier, le type tumoral, les images DICOM (fichiers ou dossier), le fichier structure (RTSTRUCT), et le PDF de l'histoire clinique. Une fois le RTSTRUCT choisi, ses structures s'affichent une par ligne avec deux cases : **Structure à charger** (cochée par défaut, sauf pour une structure sans contour) et **Structure cible**. Une case en haut de la liste coche ou décoche d'un coup toutes les structures à charger. Seules les structures à charger sont ajoutées au dossier. Une cible est toujours chargée : elle est créée vide, sous son nom du RTSTRUCT, pour être contourée, et son contour du fichier sert de référence au Dice.

Le chargement est refusé, avec la liste des erreurs, si un élément manque, si les images ou le RTSTRUCT sont illisibles, si aucune structure n'est cochée comme cible, si deux cibles portent le même nom ou si le contour d'une cible ne recoupe pas les images.

Où le dossier est enregistré dépend de la façon dont la plateforme est servie :

- **Publiée comme Artifact claude.ai (stockage partagé)**, à partir de `artifact.html` : le dossier est visible par toutes les personnes avec qui l'Artifact est partagé. Ses métadonnées vont dans la base partagée de l'Artifact (collection `dossiers`, modifiable par les seuls éditeurs) et ses fichiers dans les assets de l'Artifact. Les assets n'acceptent pas le DICOM : au chargement, le scanner est converti en PNG 16 bits en niveaux de gris (HU + 1024, sans perte, jusqu'à 18 Mo de pixels par image) et le RTSTRUCT en JSON (contours en coordonnées voxel). Seuls les éditeurs de l'Artifact peuvent ajouter ou supprimer un dossier ; le PDF est limité à 20 Mo. Si la page ne peut pas joindre le stockage partagé (Artifact ouvert hors de claude.ai, dans un onglet séparé ou sans être connecté), elle l'indique et désactive l'ajout de dossiers plutôt que de les enregistrer dans le navigateur. Un dossier resté dans le navigateur s'affiche avec la mention « dans ce navigateur uniquement » et un bouton **Mettre en partage** qui l'envoie au stockage partagé, en gardant son historique et les contours en cours.
- **Site statique (GitHub Pages, serveur local)**, à partir de `index.html` : le dossier est enregistré dans le navigateur qui l'a chargé (IndexedDB), et seulement là. Pour publier un dossier pour tous sur le site statique, l'ajouter au dépôt avec le script :

```bash
python3 scripts/ajouter_dossier.py --id orl-01 --titre "Oropharynx T2N1" --categorie ORL \
    --images chemin/CT/ --rtstruct RS.dcm --pdf histoire.pdf \
    --cible CTV_T --cible CTV_N --charger Moelle --charger Parotide_G
```

(`--charger`, facultatif et répétable, limite les structures non cibles affichées ; sans lui, toutes les structures du RTSTRUCT sont chargées.)

Le script copie les fichiers dans `dossiers/orl-01/` et ajoute le dossier à `dossiers/catalogue.json` (le mot de passe y est stocké sous forme d'empreinte SHA-256). Il reste à committer et pousser. Tous les fichiers doivent être anonymisés avant d'être publiés.

Dans les deux cas, les contours en cours et l'historique des scores restent propres à chaque utilisateur, dans son navigateur.

### Imageries de fusion

Le formulaire d'ajout accepte, en option, une ou plusieurs imageries de fusion (IRM, TEP…) : pour chacune, un nom affiché, ses images DICOM et son fichier de recalage DICOM REG (Spatial Registration, recalage rigide ou affine ; le recalage déformable est refusé). Le REG peut manquer seulement si la série partage le référentiel (Frame of Reference) du scanner, comme une TEP-TDM. Au chargement, la série est recalée (matrices *Frame of Reference Transformation Matrix* du REG) puis rééchantillonnée en trilinéaire sur la grille du scanner et fenêtrée en 8 bits (percentiles 0,5–99,5 %, 0–99,9 % pour la TEP) ; le dossier garde ce volume rééchantillonné. Le chargement est refusé si le REG ne concerne pas le scanner ou la série, ou si la série ne recoupe pas le scanner après recalage. Les dossiers publiés par `scripts/ajouter_dossier.py` n'ont pas de fusion.

Dans la visionneuse, un menu en haut à gauche de la vue axiale liste les fusions du dossier ; la fusion choisie s'affiche en filigrane sur le scanner dans les trois vues (niveaux de gris, ou échelle « chaude » pour la TEP), avec une barre de balance de Scanner 100 % · Fusion 0 % à Scanner 0 % · Fusion 100 %. Sous la balance, « Fenêtrage de la fusion » règle le seuil bas et le seuil haut (en % de la plage enregistrée), avec l'option « Transparent sous le seuil bas » (cochée par défaut pour la TEP) et un bouton pour revenir au réglage initial ; le réglage est gardé pour chaque fusion pendant la session. La dernière option du menu, « Scanner seul », décharge la fusion.

### Contourage

- Les structures choisies au chargement sont affichées en lecture seule, sauf les structures cibles : celles-ci sont créées vides et modifiables, et leur contour de référence reste masqué.
- Vue axiale : boutons − / + pour dézoomer et zoomer (jusqu'à 800 %, ou Ctrl + molette), bouton du pourcentage pour revenir à l'image entière ; Maj + glisser (ou bouton du milieu) pour déplacer l'image zoomée. Chaque barre de coupes a une flèche à chaque extrémité pour avancer ou reculer d'une coupe.
- Outils repris de la visionneuse d'origine : pinceau et gomme (rayon 1–25 mm), option pour ne pas peindre l'air ni l'os, copie de la coupe voisine, vider la coupe, effacer la structure, annulation (Ctrl+Z).
- **Interpoler les coupes** (raccourci I) : après avoir contouré une coupe axiale sur deux ou trois, crée les coupes intermédiaires de la structure active. Pour une coupe située à la fraction t entre deux coupes contourées, chaque contour est déplacé de la fraction correspondante du vecteur entre leurs barycentres (la moitié pour la coupe du milieu), puis les deux formes sont fondues par interpolation de cartes de distance signée, ce qui fait aussi évoluer la forme progressivement. Une coupe interpolée retouchée à la main devient une coupe de référence et n'est plus recalculée ; Ctrl+Z annule l'interpolation. Raccourcis : P pinceau, G gomme, I interpoler, `[` et `]` rayon, flèches haut/bas pour la coupe axiale.
- **Marge** : structure source et structure de sortie choisies parmi les structures à contourer, marges en mm dans les six directions (droite, gauche, antérieure, postérieure, supérieure, inférieure), pas forcément égales, négatives pour rétrécir. Les marges positives dilatent la source par un ellipsoïde dont chaque demi-axe est la marge de sa direction ; les négatives l'érodent ensuite de la même façon. Le résultat remplace la structure de sortie (Ctrl+Z pour annuler).
- **Opérations booléennes** : volume A et volume B choisis parmi toutes les structures affichées (à contourer ou de référence), opération ET (intersection), OU (union), SAUF (A privé de B) ou OU exclusif, volume de sortie choisi parmi les structures à contourer. Le résultat remplace le volume de sortie (Ctrl+Z pour annuler). Les contours de référence des cibles restent inaccessibles avant la validation.
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
| `js/accounts.js` | comptes, mots de passe, résultats par compte, session |
| `js/shared.js` | stockage partagé de l'Artifact : base `dossiers`, assets, codage PNG 16 bits du scanner |
| `artifact.html` | point d'entrée de la version Artifact (mêmes scripts que `index.html`) |
| `js/app.js` | menu, chargement des dossiers, mots de passe, navigation |
| `dossiers/catalogue.json` | dossiers publiés pour tous |
| `assets/logo-hcl.png` | logo des HCL affiché à côté du titre |
| `lib/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) 2.5.2, licence MIT (`lib/jspdf.LICENSE`) |

## Limites

Les comptes et leurs mots de passe sont vérifiés dans le navigateur : ils organisent l'accès dans le cadre d'une formation mais ne constituent pas une protection forte. Toute personne ayant accès à la base partagée peut techniquement lire les données (dont les empreintes des mots de passe) et contourner les contrôles de la page ; seul un serveur avec authentification (Supabase, serveur des HCL) les appliquerait réellement. Les fichiers publiés restent téléchargeables par qui connaît leur adresse. D'où l'exigence d'anonymisation.

Dans l'Artifact claude.ai, seuls le propriétaire et les personnes invitées par e-mail comme éditeurs (lien public désactivé) peuvent écrire dans la base partagée : les internes doivent donc être invités ainsi pour enregistrer leur profil et leurs scores.
