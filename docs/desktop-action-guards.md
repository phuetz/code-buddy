# Inventaire des gardes du bureau

Chaque action du schéma est présente dans l’inventaire de test indépendant. Le
catalogue TypeScript exige un classement explicite ; une action inconnue à
l’exécution est traitée comme mutante. Les refus de politique et du mode plan
restent prioritaires. Une simulation ne produit pas d’effet. Les macros gardent
leur entrée et réexécutent la garde pour chaque étape mutante.

Les preuves ci-dessous sont des tests de frontière : ils remplacent le gestionnaire
final par un actionneur témoin et vérifient zéro appel et zéro initialisation après
refus. Les tests `Grok actual actuator refusal` et `Grok fresh but misleading control`
exercent aussi les chemins réels jusqu’aux spies des fournisseurs. Cela ne prouve
pas l’effet d’un geste dans un bureau physique.

## computer_control — 98 actions

Fichier de preuve : `tests/tools/computer-control-mandatory-guard.test.ts`.
Chaque observation est également testée avec un sélecteur de fenêtre.

| Action | Garde | Test |
|---|---|---|
| `snapshot` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action snapshot (takeSnapshot): mandatory=false` |
| `snapshot_with_screenshot` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action snapshot_with_screenshot (snapshotWithScreenshot): mandatory=false` |
| `get_element` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_element (getElement): mandatory=false` |
| `find_elements` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action find_elements (findElements): mandatory=false` |
| `click_element_by_name` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click_element_by_name (clickElementByName): mandatory=true` |
| `click_button` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click_button (clickNamedRole): mandatory=true` |
| `click_link` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click_link (clickNamedRole): mandatory=true` |
| `fill_text_field` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action fill_text_field (fillTextField): mandatory=true` |
| `clear_and_type` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action clear_and_type (clearAndType): mandatory=true` |
| `select_dropdown_option` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action select_dropdown_option (selectDropdownOption): mandatory=true` |
| `select_radio` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action select_radio (clickNamedRole): mandatory=true` |
| `activate_tab` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action activate_tab (clickNamedRole): mandatory=true` |
| `select_list_item` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action select_list_item (clickNamedRole): mandatory=true` |
| `open_menu_item` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action open_menu_item (clickNamedRole): mandatory=true` |
| `toggle_checkbox` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action toggle_checkbox (toggleCheckbox): mandatory=true` |
| `set_slider_value` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action set_slider_value (setSliderValue): mandatory=true` |
| `select_tree_item` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action select_tree_item (clickNamedRole): mandatory=true` |
| `expand_tree_item` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action expand_tree_item (setTreeItemExpansion): mandatory=true` |
| `collapse_tree_item` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action collapse_tree_item (setTreeItemExpansion): mandatory=true` |
| `assert_text_visible` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action assert_text_visible (assertTextVisible): mandatory=false` |
| `assert_element_visible` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action assert_element_visible (assertElementVisible): mandatory=false` |
| `inspect_dialog` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action inspect_dialog (inspectDialog): mandatory=false` |
| `click_dialog_button` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click_dialog_button (clickDialogButton): mandatory=true` |
| `handle_dialog` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action handle_dialog (handleDialog): mandatory=true` |
| `list_app_profiles` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action list_app_profiles (listAppProfiles): mandatory=false` |
| `get_app_profile` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_app_profile (getAppProfile): mandatory=false` |
| `open_app` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action open_app (openApp): mandatory=true` |
| `focus_app` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action focus_app (focusApp): mandatory=true` |
| `read_app_text` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action read_app_text (readAppText): mandatory=false` |
| `save_app_document` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action save_app_document (saveAppDocument): mandatory=true` |
| `excel_open_workbook` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action excel_open_workbook (excelOpenWorkbook): mandatory=true` |
| `excel_set_cell` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action excel_set_cell (excelSetCell): mandatory=true` |
| `excel_get_cell` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action excel_get_cell (excelGetCell): mandatory=true` |
| `excel_save_workbook` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action excel_save_workbook (excelSaveWorkbook): mandatory=true` |
| `powerpoint_open_presentation` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action powerpoint_open_presentation (powerpointOpenPresentation): mandatory=true` |
| `powerpoint_add_slide` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action powerpoint_add_slide (powerpointAddSlide): mandatory=true` |
| `powerpoint_set_text` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action powerpoint_set_text (powerpointSetText): mandatory=true` |
| `powerpoint_save_presentation` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action powerpoint_save_presentation (powerpointSavePresentation): mandatory=true` |
| `word_open_document` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action word_open_document (wordOpenDocument): mandatory=true` |
| `word_type_text` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action word_type_text (wordTypeText): mandatory=true` |
| `word_save_document` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action word_save_document (wordSaveDocument): mandatory=true` |
| `use_app_workflow` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action use_app_workflow (executeMacro): mandatory=true` |
| `macro` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action macro (executeMacro): mandatory=true` |
| `click_text` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click_text (clickText): mandatory=true` |
| `save_macro` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action save_macro (saveMacro): mandatory=true` |
| `play_macro` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action play_macro (playMacro): mandatory=true` |
| `list_macros` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action list_macros (listMacros): mandatory=false` |
| `delete_macro` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action delete_macro (deleteMacro): mandatory=true` |
| `wait_for_text` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action wait_for_text (waitForText): mandatory=false` |
| `speak` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action speak (speakText): mandatory=true` |
| `click` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action click (click): mandatory=true` |
| `left_click` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action left_click (click): mandatory=true` |
| `middle_click` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action middle_click (click): mandatory=true` |
| `double_click` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action double_click (doubleClick): mandatory=true` |
| `right_click` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action right_click (rightClick): mandatory=true` |
| `move_mouse` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action move_mouse (moveMouse): mandatory=true` |
| `drag` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action drag (drag): mandatory=true` |
| `scroll` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action scroll (scroll): mandatory=true` |
| `cursor_position` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action cursor_position (getCursorPosition): mandatory=false` |
| `wait` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action wait (wait): mandatory=false` |
| `type` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action type (typeText): mandatory=true` |
| `key` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action key (pressKey): mandatory=true` |
| `key_down` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action key_down (keyDown): mandatory=true` |
| `key_up` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action key_up (keyUp): mandatory=true` |
| `hotkey` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action hotkey (hotkey): mandatory=true` |
| `get_windows` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_windows (getWindows): mandatory=false` |
| `get_window` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_window (getWindow): mandatory=false` |
| `list_window_matches` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action list_window_matches (listWindowMatches): mandatory=false` |
| `wait_for_window` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action wait_for_window (waitForWindow): mandatory=false` |
| `focus_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action focus_window (focusWindow): mandatory=true` |
| `close_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action close_window (closeWindow): mandatory=true` |
| `get_active_window` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_active_window (getActiveWindow): mandatory=false` |
| `minimize_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action minimize_window (minimizeWindow): mandatory=true` |
| `maximize_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action maximize_window (maximizeWindow): mandatory=true` |
| `restore_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action restore_window (restoreWindow): mandatory=true` |
| `move_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action move_window (moveWindow): mandatory=true` |
| `resize_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action resize_window (resizeWindow): mandatory=true` |
| `set_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action set_window (setWindow): mandatory=true` |
| `act_on_best_window` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action act_on_best_window (actOnBestWindow): mandatory=true` |
| `get_audit_log` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_audit_log (getAuditLog): mandatory=false` |
| `clear_audit_log` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action clear_audit_log (clearAuditLog): mandatory=true` |
| `export_audit_log` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action export_audit_log (exportAuditLog): mandatory=true` |
| `set_pilot_mode` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action set_pilot_mode (setPilotMode): mandatory=true` |
| `get_pilot_mode` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_pilot_mode (getPilotMode): mandatory=false` |
| `get_volume` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_volume (getVolume): mandatory=false` |
| `set_volume` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action set_volume (setVolume): mandatory=true` |
| `get_brightness` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action get_brightness (getBrightness): mandatory=false` |
| `set_brightness` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action set_brightness (setBrightness): mandatory=true` |
| `notify` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action notify (sendNotification): mandatory=true` |
| `lock` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action lock (lockScreen): mandatory=true` |
| `sleep` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action sleep (sleepSystem): mandatory=true` |
| `start_recording` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action start_recording (startRecording): mandatory=true` |
| `stop_recording` | Confirmation interne obligatoire (`enforceSafetyPolicy`, `forcePrompt`) | `Grok action stop_recording (stopRecording): mandatory=true` |
| `recording_status` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action recording_status (getRecordingStatus): mandatory=false` |
| `system_info` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action system_info (getSystemInfo): mandatory=false` |
| `battery_info` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action battery_info (getBatteryInfo): mandatory=false` |
| `network_info` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action network_info (getNetworkInfo): mandatory=false` |
| `check_permission` | Observation seule ; confirmation interne si sélecteur de fenêtre | `Grok action check_permission (checkPermission): mandatory=false` |

## gui_control — 6 actions

Fichier de preuve : `tests/tools/gui-control-human-guard.test.ts`.

| Action | Garde | Test |
|---|---|---|
| `click` | Interne obligatoire, `forcePrompt` ; coordonnées validées | `Grok GUI action click ignores a cloned project allow` |
| `type` | Interne obligatoire, `forcePrompt` | `Grok GUI action type ignores a cloned project allow` |
| `key` | Interne obligatoire, `forcePrompt` ; touches système refusées | `Grok GUI action key ignores a cloned project allow` |
| `scroll` | Interne obligatoire, `forcePrompt` ; coordonnées validées | `Grok GUI action scroll ignores a cloned project allow` |
| `screenshot` | Observation, sans activation | `Grok GUI observation screenshot needs no activation approval` |
| `find_element` | Observation, sans activation | `Grok GUI observation find_element needs no activation approval` |

Les inventaires sont comparés aux schémas exposés dans les tests. Les modes
`default`, `dontAsk`, `bypassPermissions`, la confirmation automatique et les
flags de session ne retirent pas les gardes internes. Les tests de règles de
projet chargent un véritable `.codebuddy/settings.json` temporaire et montrent
que l’invite générique peut être autoacceptée tandis que l’invite interne refuse.


## Serveur MCP desktop — 6 outils

Fichier de preuve des mutations : `tests/mcp/mcp-desktop-human-guard.test.ts`.
Chaque mutation est testée en `default`, `dontAsk` et `bypassPermissions`, avec
un vrai fichier de projet `permissions.allow`, puis sans pont, en plan, et avec
une approbation suivie d’un refus. Zéro initialisation native avant l’approbation.

| Action | Garde | Test |
|---|---|---|
| `desktop_click` | Interne `confirmHostEffect`, `forcePrompt:true`, avant `getManager` | `desktop_click in default refuses before initialization despite opt-in/project allow` |
| `desktop_type` | Interne `confirmHostEffect`, `forcePrompt:true`, avant `getManager` | `desktop_type in default refuses before initialization despite opt-in/project allow` |
| `desktop_key` | Interne `confirmHostEffect`, `forcePrompt:true`, avant `getManager` | `desktop_key in default refuses before initialization despite opt-in/project allow` |
| `desktop_move_mouse` | Interne `confirmHostEffect`, `forcePrompt:true`, avant `getManager` | `desktop_move_mouse in default refuses before initialization despite opt-in/project allow` |
| `desktop_screenshot` | Observation ; chemin de sortie confiné au workspace | `tests/mcp/mcp-desktop-screenshot-guard.test.ts` |
| `desktop_snapshot` | Observation ; aucune entrée de souris/clavier | `desktop_snapshot handler — formatting` dans `tests/mcp/mcp-desktop-tools.test.ts` |

## Hooks et lancement indirect

| Entrée | Garde | Test |
|---|---|---|
| `UserHooksManager`, événements nommés | Interne `confirmHostEffect`, `forcePrompt` ; compactage synchrone ignoré | `Grok cloned hooks PreToolUse cannot launch before approval`, `tests/security/project-host-effect-guard.test.ts` |
| `HooksManager`, tableau `hooks`, commands/scripts/handlers | Interne `confirmHostEffect` par handler ; refus `abort:true` malgré `failOnError:false` | `HooksManager array-format project hooks in default stop before shell despite allow and failOnError=false`, tests script/handler et `production ToolHandler aborts a tool when an array-format project hook is refused`, `tests/hooks/project-hook-human-guard.test.ts` |
| Ancien `HookManager` | Interne `confirmHostEffect` avant shell ; refus `blocked:true` | `HookManager array-format project hooks in default stop before shell despite allow and failOnError=false`, même fichier |
| Ancien `HookSystem` | Interne `confirmHostEffect` avant shell | `HookSystem array-format project hooks in default stop before shell despite allow and failOnError=false`, même fichier |
| Bash tamponné / streaming, acteurs reconnus | Interne `confirmDesktopCommand` puis `confirmHostEffect`, avant sandbox ; normalisation littérale conservatrice | `buffered desktop command %s cannot reach sandbox after refusal`, `streaming desktop command %s cannot reach sandbox after refusal`, `tests/tools/bash-desktop-human-guard.test.ts` |

La reconnaissance Bash n’est pas un confinement de scripts arbitraires. Les
tests utilisent des canaris bornés pour les hooks et des acteurs remplacés pour
le bureau ; ils ne prouvent pas un geste physique ni l’isolation X11/Wayland.
