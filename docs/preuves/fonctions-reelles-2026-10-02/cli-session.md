# cli-session — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Aucune conversation n’existe dans un HOME neuf. Resume restaure et résume une session enregistrée, sans lancer un modèle.

Prouver la restauration d’une fixture persistée via SessionStore ; aucune conversation modèle n’est revendiquée.

[Protocole, validation et limites](README.md).

## Avant

### cli-session-list

```text
$ buddy session list
No sessions found.

EXIT=0
```

### cli-session-resume

```text
$ buddy session resume
No sessions found.

EXIT=1
```

### cli-session-search-fixture

```text
$ buddy session search QA_SESSION_MARKER
Session search results for "QA_SESSION_MARKER" (1):

  session_ - QA saved conversation
    2 messages | 10/2/2026 4:17:04 PM
    match (user): QA_SESSION_MARKER Hello World!

Use `buddy session resume <id>` to resume a session

EXIT=0
```

### cli-session-resume-fixture

```text
$ buddy session resume session_mur1rdny_7h71fn
Resuming session: QA saved conversation (session_)
   2 messages, last accessed: 10/2/2026, 4:17:04 PM
   Recap (local, no model call): 1 user / 1 assistant turns, 0 tool call(s)
   Last request: QA_SESSION_MARKER Hello World!
   Last answer: Fixture locale, aucune inférence.


EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-session-list

```text
$ buddy session list
No sessions found.

EXIT=0
```

### cli-session-resume

```text
$ buddy session resume
No sessions found.

EXIT=1
```

### cli-session-search-fixture

```text
$ buddy session search QA_SESSION_MARKER
Session search results for "QA_SESSION_MARKER" (1):

  session_ - QA saved conversation
    2 messages | 10/2/2026 4:35:24 PM
    match (user): QA_SESSION_MARKER Hello World!

Use `buddy session resume <id>` to resume a session

EXIT=0
```

### cli-session-resume-fixture

```text
$ buddy session resume session_mur2eysp_6c45b6
Resuming session: QA saved conversation (session_)
   2 messages, last accessed: 10/2/2026, 4:35:24 PM
   Recap (local, no model call): 1 user / 1 assistant turns, 0 tool call(s)
   Last request: QA_SESSION_MARKER Hello World!
   Last answer: Fixture locale, aucune inférence.


EXIT=0
```
