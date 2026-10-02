# cli-autonomous-code — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **a+b** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Un rapport bloqué sortait en code 0 ; l’absence de fournisseur était présentée comme un échec d’auto-amélioration.

Retourner 1 pour blocked, validation_failed et verification_failed ; traiter le fournisseur absent comme un blocage explicite sans vérification fictive.

[Protocole, validation et limites](README.md).

Fichiers du correctif : `src/commands/cli/autonomous-code-command.ts`, `src/agent/autonomous/verification-loop.ts`, `tests/commands/autonomous-code-command.test.ts`, `tests/agent/autonomous/verification-loop.test.ts`.

## Avant

### cli-autonomous-code-no-provider

```text
$ buddy autonomous-code --task-file task-external.json --run-verification --json
{
  "status": "blocked",
  "blockedReasons": [
    "Self-improvement execution failed with error: No LLM provider configuration found in environment."
  ],
  "verificationRequested": true,
  "verification": []
}
EXIT=0

```

## Après — paquet reconstruit et réinstallé

### cli-autonomous-code-no-provider

```text
$ buddy autonomous-code --task-file task-external.json --run-verification --json
{
  "status": "blocked",
  "blockedReasons": [
    "No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key."
  ],
  "verificationRequested": true,
  "verification": []
}
EXIT=1

```
