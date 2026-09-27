# مِربَط · MAQIDH — Application web de gestion du مقيض

Application web (HTML / JS / CSS + Tailwind CSS) réalisée à partir de la présentation
« Mirbat_Maqidh_Presentation_Visuelle ». Interface en arabe (RTL), aux couleurs de la charte
(bleu nuit `#17294A`, or `#D6B26B`, vert `#2A6B4F`, rouge brique `#A6472E`).

## Lancer
Ouvrir `index.html` dans un navigateur (connexion Internet requise pour les CDN :
Tailwind CSS 4, Lucide Icons, Chart.js, Google Fonts Tajawal / Reem Kufi).
Aucune installation ni serveur n'est nécessaire. Les données de démonstration sont générées
localement et les modifications sont conservées dans le `localStorage` du navigateur
(bouton « إعادة التعيين » dans les paramètres pour tout réinitialiser).

## Comptes de démonstration (profils du slide « الموظفون والصلاحيات »)

| Profil | Identifiant | Mot de passe | Modules |
|---|---|---|---|
| المشرف / المدير (superviseur / directeur) | `admin` | `admin123` | tous + personnel, paramètres |
| المحاسب (comptable) | `comptable` | `compta123` | المالية |
| الممرض / الطبيب (infirmier / vétérinaire) | `docteur` | `vet123` | الطيور، الصحة |
| موظف الاستقبال (accueil) | `accueil` | `accueil123` | الطيور، الحجوزات |
| السائق (chauffeur) | `chauffeur` | `drive123` | التوصيل (ses missions uniquement) |
| عامل التغذية (soigneur) | `soigneur` | `feed123` | الطيور، المخزون |

La matrice des permissions est modifiable par l'administrateur (Personnel → مصفوفة الصلاحيات) ;
le menu et les pages s'adaptent immédiatement.

## Modules
- **Tableau de bord** : blocs filtrés selon le profil (capacité 342/500, santé, finances, stock, livraisons).
- **Oiseaux** : fiche 360° par bague (passeport, puce, CITES), compteur « jour X sur N », frise
  chronologique, traitements, parcours de vaccination, courbe de poids, compte financier.
  Filtres rapides : sous traitement, sain, à examiner, fin proche, vaccin dû, montant dû, traitement impayé.
- **Propriétaires** : compte cumulé (séjour + soins + livraison = total ; encaissé ; reste), badge VIP, archivage.
- **Réservations & réception** : réservation avec acompte → réception avec examen vétérinaire → séjour actif.
- **Santé** : traitements, vaccinations dues, contrôles ; règle du délai traitement → vaccin.
- **Nourriture & stock** : aliments, pattes de poulet, poussins, proies (achetées / utilisées / restantes),
  fournisseurs, achats (= dépenses automatiques), consommation, alertes de réapprovisionnement.
- **Livraison** : demandes, affectation du chauffeur, statut (faite / non faite), frais ajoutés au compte.
- **Finances** : revenus − dépenses = résultat par jour / mois / saison / année / période,
  paiements avec reçu numéroté, comptes impayés, graphiques.
- **Rapports** : tableaux triables, export Excel (CSV) et impression.
- **Paramètres** : saison, capacité, prix (3 500 QAR / 7 mois), acompte, frais de livraison,
  niveau d'obligation des 3 règles (إلزامي / تحذير / معطّل), programme de vaccination.

## Structure
```
index.html              page unique + thème Tailwind (@theme) et composants (@layer components)
assets/css/app.css      styles complémentaires (fond, animations, jauge)
assets/js/data.js       profils, permissions, génération des données de démo, stockage
assets/js/ui.js         composants UI : modal, toast, confirmation, badges, tableau paginé/triable, KPI…
assets/js/app.js        routeur, écrans, règles métier
assets/img/logo.png     logo (faucon) extrait de la présentation
```

> Prototype front-end : l'authentification est simulée côté navigateur. Pour la production,
> brancher ces écrans sur une API (REST, authentification, multi-tenant) comme prévu au slide « المعمارية التقنية ».
