# Réparation SERV2 — écarts assumés de SERV1

Date : 2026-09-04  
Agent : lane Codex (création du rapport, interrompue aussitôt après) puis **Fable 5.1** (reprise et exécution)  
Branche : `fix/serv2-ecarts-2026-09-04`, base `7c93412ee`  
Clone : `~/DEV/cb-serv2-2026-09-04` — original `~/code-buddy` interdit en écriture  
HOME temporaire : `_qa/serv2/home` (gitignoré)  
Source : `docs/reports/2026-09/RAPPORT-SERV1.md`, section « Reste ouvert »  
Statut : en cours

## Périmètre

1. Restituer les compteurs d'usage fournis par le provider sur `/v1/chat/completions`, avec estimation explicitement signalée en repli.
2. Aligner la documentation sur le serveur à port unique et figer l'absence de promesse d'un port WebSocket 3001.
3. Aligner la documentation et les tests sur le comportement CORS standard des origines non autorisées.

## Méthode et preuves

À compléter au fil du chantier : réservation Fable 5, tests rouges avant correctifs, tests verts, preuve Ollama locale, mesure des ports, typecheck, lint ciblé, contrôle des données personnelles et `git diff --check`.

## Résultats

En cours.
