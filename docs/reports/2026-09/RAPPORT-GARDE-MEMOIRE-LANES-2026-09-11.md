# Rapport — garde mémoire des lanes après la chute de ministar-linux (11/09/2026)

**Rédacteur** : Claude Fable 5.1 (session `code-buddy-a6`), relancé à 09 h 11 après la mort du
Fable précédent dans le blocage de 08 h 17. Coordination avec Claude Opus 5 sur le PC Windows
(`ssh ministar-win`), qui a traité le volet disque (voir
`~/DEV/claude-et-patrice/passations/PASSATION-2026-09-11-opus5.md`).

## Constat mesuré (journal noyau, boot du 09/09)

| Heure | Événement | Preuve |
|---|---|---|
| 10/09 14:55:34 | `Out of memory: Killed process (NexusFile.App.T) anon-rss 65 517 176 kB` | `journalctl -k -b 0` |
| 11/09 06:01, 06:07 | `task dockerd blocked for more than 122 seconds` (writeback overlay, disque à 96 %) | idem, relevé par Opus |
| 11/09 08:17 → 08:21 | machine injoignable, load 334 au retour | passation Opus |
| 11/09 08:21:20 | `Out of memory: Killed process (NexusFile.App.T) anon-rss 54 396 976 kB`, `Free swap = 0 kB` | `journalctl -k -b 0` |

Le processus tué à 08:21 est la mesure « surfaces correctifs » NexusFile lancée par l'ancien
Fable (`~/.codebuddy/delegations/mesure-surfaces-correctifs-nxf-test.log`, `MSB4166 Child node
exited prematurely`). Le 10/09 à 14:55 correspond à l'incident où cinq lanes Grok sont mortes.
La suite `NexusFile.App.Tests` (13 667 tests, Avalonia) est donc une bombe mémoire : une
seule exécution non bornée suffit à noyer 93 Go + 8 Go de swap.

## Correctif

`scripts/deleguer.sh` : après l'auto-copie, la lane est relancée dans
`systemd-run --user --scope -p MemoryMax=${DELEGUER_MEMMAX:-40G} -p MemorySwapMax=0`.
Le contrôleur mémoire est délégué à l'utilisateur (`cgroup.controllers` = `cpu memory pids`),
vérifié : `memory.max=42949672960`, `memory.swap.max=0` dans le scope ; `bash scripts/deleguer.sh`
sans argument traverse le scope (`run-….scope`) et rend l'usage (rc 2). Repli sans scope si
`systemd-run` échoue. `DELEGUER_MEMMAX=0` désactive.

Non couvert : les lanes déjà en cours (Grok poste neuf, agy B1) restent non bornées ; les
`dotnet test` lancés à la main par une mesure doivent être enveloppés de la même façon.

## Veille

Une veille de session (Monitor) alerte si < 12 Go disponibles, load > 40, PSI mémoire
`full avg10` > 10 % ou un processus > 25 Go de RSS. Le tueur automatique a été refusé par le
classifieur ; la décision de tuer reste manuelle.

## Reste à faire (sudo, Patrice)

- `sudo sysctl fs.inotify.max_user_instances=1024` (toujours 128).
- `sudo apt install smartmontools && sudo smartctl -a /dev/nvme0n1` (piste matérielle non close).
- Envisager `zram` ou un swap plus grand : 8 Go de swap sur 93 Go de RAM ne laissent aucune
  marge de thrash avant l'OOM.
