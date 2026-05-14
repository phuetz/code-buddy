# Journal — MINISTAR / gitnexus-rs-from-c

## 2026-05-14 — point de reprise GitNexus documents de travail

Contexte : session Codex sur `D:\CascadeProjects\gitnexus-rs-from-c`, branche
`codex/multi-llm-provider-choice`, base git `f7417e4 Improve GitNexus as a reliable analysis workstation`.

Patrice a validé les propositions d'amélioration documentaire après étude du
dépôt de livres techniques `\\wsl.localhost\Ubuntu-22.04\home\patrice\claude\livre`.
La direction retenue : faire des réponses GitNexus non plus seulement des
réponses de chat, mais des chapitres exploitables dans un livrable technique
professionnel.

Travail fait :
- import DOCX et extraction des questions déjà intégrés au panneau
  `Documents de travail` ;
- prompt par question renforcé : reformulation adaptée au dépôt, obligation de
  lire les fichiers nécessaires, sources exactes, preuves code, impacts,
  diagramme Mermaid si utile ;
- génération du livrable final sous forme de mini-livre :
  métadonnées, parcours de lecture, table des questions, document source
  enrichi, chapitres question/réponse, index des sources citées, contrôle
  qualité ;
- audit qualité calculé côté UI : score, couverture, fichiers sources, blocs de
  code, diagrammes, erreurs, réponses trop courtes ;
- panneau UI enrichi avec score qualité, fichiers sources, diagrammes, blocs
  code et export HTML imprimable ;
- export DOCX amélioré : callouts Obsidian, légendes de figures Mermaid,
  identifiants de liens uniques ;
- export PDF/HTML amélioré : profil `technical-book`, couverture plus
  professionnelle, callouts, tables, Mermaid theme base, fallback source ;
- délais export PDF/DOCX augmentés à 180 secondes.

Fichiers principaux côté GitNexus :
- `chat-ui/src/components/chat/WorkDocumentsPanel.tsx`
- `chat-ui/src/utils/workdoc.ts`
- `chat-ui/src/utils/workdoc.test.ts`
- `chat-ui/src/api/mcp-client.ts`
- `crates/gitnexus-cli/src/commands/export_docx.rs`
- `crates/gitnexus-cli/src/commands/generate/pdf.rs`

Vérifications réalisées et passées :
- `npm --prefix chat-ui run test -- workdoc`
- `npm --prefix chat-ui run lint`
- `npm --prefix chat-ui run build`
- `cargo test -p gitnexus-cli`
- `git diff --check` sur le périmètre modifié

Attention reprise :
- le worktree GitNexus contient beaucoup d'autres fichiers modifiés ou non
  trackés issus de travaux précédents ; ne pas faire de reset global ;
- le travail courant n'est pas encore commité ;
- prochaine étape idéale : test réel dans l'UI avec un DOCX Alise, export
  HTML/PDF/DOCX, puis commit Lore et push.

Pensée de session : on a franchi un vrai palier. GitNexus commence à devenir
un atelier de production documentaire, pas seulement un moteur de questions
réponses sur le code.
