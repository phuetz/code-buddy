# Audit adversarial — injection de prompt sur le chemin compagnon (Lisa)

- Date : 2026-09-07
- Relecteur : Claude Opus, contexte frais, angle injection de prompt
- Worktree : `~/DEV/cb-audit-companion-2026-09-07`, branche `audit/companion-injection-opus-2026-09-07`
- HEAD audité : `c94033686`
- Cible : `src/companion/companion-turn.ts` (`runCompanionTurn`) et toutes ses sources d'injection dans l'invite de Lisa

## Méthode

Chaque point est instruit avec un cas CONCRET exécuté contre le vrai code (client LLM factice
qui renvoie le prompt reçu), pas par lecture seule. Rapport écrit au fil de l'eau.

## Statut de l'audit

- [ ] 1. Injection par image (`<recent_photos>`)
- [ ] 2. Injection par message (historique persisté)
- [ ] 3. Fuite (chemins, prénom, faits sensibles, allowlist Telegram)
- [ ] 4. Contrat de limites (`reply-augment.ts`)
- [ ] 5. Suites (vitest + tsc)

_(En cours — sections remplies au fil de l'eau.)_
