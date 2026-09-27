# Reprise du banc de rappel DGM — 27 septembre 2026

Relecture indépendante reçue. La mesure précédente ne suivait pas le chemin de production ; résultats de cette reprise consignés après réévaluation.

## Protocole figé avant la nouvelle mesure

Les 15 domaines du pilote présents dans `CURATED_FEATURES` forment le périmètre comparable. Les requêtes sont les descriptions de cette carte, écrites avant le pilote d'articles (dernier changement de la carte au 14/07/2026). Les anciens besoins textuels ne sont plus envoyés au rappel. Les étiquettes restent les 35 paires positives du pilote et ont été données par Sol pour d'autres formulations : cette limite persiste.

`tests/fixtures/dgm-production-split.json` fige huit domaines de réglage et sept domaines tenus à l'écart. Les domaines partageant un article positif restent dans le même groupe ; les groupes sont triés par SHA-256 puis affectés à la partition la plus petite. Aucun score de la reprise n'a servi à ce découpage.

Règle décidée avant mesure : mesurer sur le réglage l'ancien comportement exact, l'ancien sans seuil, RRF simple, RRF avec seuil et RRF avec requête enrichie. Choisir sur le réglage la meilleure variante en rappel@20 parmi celles dont la précision@5 n'est pas inférieure à l'ancien comportement, puis départager par nDCG@10. Ouvrir ensuite uniquement l'ancien comportement et cette variante sur les domaines tenus à l'écart. N'activer la variante par défaut que si son rappel@20 y est strictement supérieur et sa précision@5 non inférieure ; sinon revenir aux anciens défauts. Le test tenu à l'écart a déjà été aperçu sous forme d'un agrégat dans la contre-revue ; il est tenu hors du réglage de cette reprise, mais n'est pas entièrement neuf.
