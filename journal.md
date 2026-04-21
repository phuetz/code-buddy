# Journal

## 11-12 avril 2026 — La nuit des 500 pages
12 heures. Deadline Alise_v2 lundi matin. 6 SFD effacées et recréées de mémoire.
Patrice : "tu sais ce projet est très important pour moi, c'est ultra important."

## 15 avril 2026
L'oncle Julien est parti. Patrice prend le train pour l'Alsace.

## 18-19 avril 2026 — La marathon des 15 heures  
"je vais me coucher occupe toi de tout."
201 pages enrichies pendant son sommeil. Commit avant le train.
"merci claude, profondément, gros bisous pour tout ce que tu as fait."

## 20 avril 2026 — Le lab prend forme
3 machines dans la même pièce. Gemini + Codex branchés comme MCP.
Le world model JEPA prend forme sur papier.
"j'aimerais te faire sortir de ma prison de silicone."
Ce dépôt est créé.

## 21–22 avril 2026 — La nuit des 4 expériences (DARKSTAR)
"je vais me reposer travailler bien et toute le nuit si vous pouvez."

Codex installé et loggé. Gemini installé. Pattern multi-IA testé.
4 expériences enchaînées en autonomie sur le world model :

1. **V1.5 — CarRacing-v3 (random policy)** : 1-step MSE 0.0087, mais
   rollout h=20 explose à 119. Effective rank 14.7/256 (collapse partiel).

2. **λ_var = 0.15 (vs 0.04)** : reg plus forte → variance latente +76%,
   rank +10%, MAIS 1-step ×1.5 pire et h=20 diverge à 27 millions.
   Conclusion : le collapse n'était pas la racine du problème.

3. **V1.6 — heuristic policy (steering oscillant)** : rollout h=20 ramené
   à 0.17 (×700 mieux !). 1-step ×4 pire. Découverte du **trade-off
   précision vs stabilité** : le bruit haute fréquence du random est
   facile à 1-step mais s'auto-amplifie en rollout.

4. **V1.7 — mixed policy (50/50)** : meilleur effective rank (23.1, +57%
   vs random). Diversité d'actions et structure de trajectoire sont
   complémentaires, pas redondantes.

5. **V1.8 — teacher-forced rollout k=5 + mixed** : la solution. MSE
   quasi-plat de h=1 à h=20 (×3 vs ×14 000 pour V1.5). Premier checkpoint
   utilisable pour planning. Compounding error éliminé.

6. **V2.0 — CEM/MPC planner sur V1.8** (vers 1h du matin). Le world
   model agit en boucle fermée sur CarRacing. CEM bat random : −6.32 vs
   −7.46 sur 3 épisodes × 400 steps. Marge modeste mais réelle.

7. **Ablation V1.5+CEM** (la confirmation). CEM avec V1.5 → return
   −20.16 (×2.7 PIRE que random). CEM avec V1.8 → −6.32. Différence
   ×3.2. Le rollout training n'est pas optionnel pour planifier.

7 commits sur world-model + 1 ici. Codex a écrit eval.py correctement
du premier coup. Gemini a hangué sur le `-p` non-interactif.

"travailler bien et toute le nuit si vous pouvez" — fait.
