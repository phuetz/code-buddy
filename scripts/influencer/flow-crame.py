#!/usr/bin/env python3
"""Crame les crédits Flow/Veo (solde limité, expire le 28) — pilote minimal.

Réutilise la classe Flow VALIDÉE de flow-veo-mission.py (soumission CDP +
configure Veo 3.1 Quality + fill_prompt + submit + fetch_video), SANS les
gardes budget de la campagne de juillet (calibrées 25 000 crédits).

Un prompt = une prise = 100 crédits. Soumet un par un, attend la résolution de
chaque clip avant le suivant (réduit la contamination Flow). Garder des prompts
HOMOGÈNES par session (thèmes très différents → sessions/projets séparés).

Usage :
  python3 flow-crame.py prompts-lisa-deuxmondes.json [--limit N] [--reserve 0]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def looks_like_agent_send_button(inner_text: str, width: float) -> bool:
    """Sélecteur du bouton d'envoi Agent (UI 2026-09).

    Le libellé visible est l'icône Material `arrow_forward` plus un span
    sr-only « Créer ». Un second bouton `add_2 Créer` (w=32 aussi) existe :
    il n'a PAS arrow_forward. Largeur < 80 écarte d'éventuels CTA larges.
    """
    text = inner_text or ''
    # flow.google.com (sept. 2026) : le span « Créer » a disparu, seule l'icône reste.
    return 'arrow_forward' in text and 0 < float(width) < 80


def agent_send_is_ready(*, disabled: bool, aria_disabled: str | None) -> bool:
    """Le bouton Créer n'utilise plus l'attribut HTML `disabled` (sept. 2026).

    React pose `aria-disabled="true"` tant que le modèle Slate est vide.
    `.disabled` reste false — le pilote cliquait un bouton visuellement
    « actif » que l'application ignore (solde inchangé, champ non vidé).
    """
    return (not disabled) and aria_disabled != 'true'


def composer_looks_empty(text: str) -> bool:
    """Le compositeur est revenu au placeholder après un envoi réussi."""
    value = (text or '').strip().lower()
    if not value or len(value) <= 40:
        return True
    return (
        'voulez-vous' in value
        or 'what do you want to create' in value
    )


def queued_in_body(text: str) -> bool:
    """L'agent a bien pris le prompt (FR historique ou EN 2026-09)."""
    body = (text or '').lower()
    return (
        "file d'attente" in body
        or 'programmée' in body
        or 'scheduled' in body
        or 'in the queue' in body
    )


def pick_720p_original_option(labels: list[str]) -> str | None:
    """Menu Télécharger : 720p Original only — jamais 4K (50 crédits) ni GIF."""
    normalised: list[tuple[str, str]] = []
    for raw in labels:
        compact = ' '.join((raw or '').split())
        normalised.append((raw, compact))
    for raw, compact in normalised:
        lower = compact.lower()
        if '4k' in lower or 'gif' in lower or '1080' in lower:
            continue
        if '720p' in compact and 'original' in lower:
            return raw
    for raw, compact in normalised:
        lower = compact.lower()
        if '720p' in compact and 'upscaled' not in lower and '4k' not in lower:
            return raw
    return None


def is_paid_upscale_option(label: str) -> bool:
    compact = ' '.join((label or '').split()).lower()
    return '4k' in compact or '50 credit' in compact


def flow_project_url(project_id: str) -> str:
    """Canonique 2026-09 : flow.google.com (labs.google redirige)."""
    return 'https://flow.google.com/project/' + project_id


def ffprobe_summary(path: Path) -> str:
    try:
        raw = subprocess.check_output(
            [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration,size',
                '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames',
                '-of', 'json', str(path),
            ],
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return f'ffprobe KO ({exc})'
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return 'ffprobe JSON illisible'
    streams = data.get('streams') or []
    video = next((s for s in streams if s.get('width')), {})
    fmt = data.get('format') or {}
    return (
        f"{video.get('codec_name', '?')} {video.get('width')}x{video.get('height')} "
        f"{video.get('avg_frame_rate')} {fmt.get('duration')}s "
        f"{fmt.get('size')}o frames={video.get('nb_frames')}"
    )


SCRIPT_DIR = Path(__file__).resolve().parent
# Charge cdp-lib + la classe Flow (tout le module AVANT `def run(`) sans lancer main().
exec((SCRIPT_DIR / 'flow-veo-mission.py').read_text().split('def run(')[0])  # noqa: S102

POLL_SECONDS = 8
TIMEOUT_SECONDS = 20 * 60
# L'agent ignore le défaut « Video generation default » s'il n'est pas nommé
# dans le prompt (mesuré 09/09 : Quality persisté dans tune, prises Omni Flash −12 cr).
QUALITY_PREFIX = (
    'Use Veo 3.1 Quality only — not Omni Flash, not Lite, not Fast. '
    'Eight-second 16:9 video. '
)
SUFFIX = ' No on-screen text, no watermark, no logo. One continuous eight-second shot with subtle native ambient sound.'
AGENT_INSTRUCTION = (
    'Always generate video with Veo 3.1 Quality only, 8 seconds, 16:9. '
    'Never use Omni Flash, Lite, Fast, or any cheaper model.'
)
# Projet Flow visé, lu dans l'environnement — JAMAIS en dur dans le dépôt public.
# get_tab() prend le premier onglet labs.google/flow : si l'onglet a dérivé
# (Retour / autre projet), on y revient.
FLOW_PROJECT_ID = os.environ.get('FLOW_PROJECT_ID', '').strip()
if not FLOW_PROJECT_ID:
    raise SystemExit(
        "FLOW_PROJECT_ID est obligatoire : exportez l'identifiant du projet Flow "
        "avant de lancer ce script, par exemple\n"
        "    export FLOW_PROJECT_ID=<identifiant-du-projet>\n"
        "Il se lit dans l'URL du projet ouverte dans le navigateur "
        "(https://flow.google.com/project/<identifiant-du-projet>)."
    )
FLOW_PROJECT_URL = flow_project_url(FLOW_PROJECT_ID)
CREDITS_PER_SHOT = 100
VIEWPORT_WIDTH = 4600

# Sélecteur du bouton d'envoi de l'agent Flow (UI 2026-09 : '<button> arrow_forward Créer', w<80).
# Ne PAS se fier à .disabled : voir agent_send_is_ready().
_SEND_BTN = ("[...document.querySelectorAll('button')].find(e=>/arrow_forward/.test(e.innerText)"
             "&&e.getBoundingClientRect().width>0"
             "&&e.getBoundingClientRect().width<80)")


class DomFlow(Flow):  # noqa: F821 (Flow défini par l'exec)
    """UI Flow 2026-09 (agent) sur flow.google.com.

    Les clics DOM synthétiques restent utiles pour ULTRA / fermer une boîte
    (hors compositeur). L'envoi du prompt, lui, exige un clic TRUSTED et un
    modèle Slate committé (`aria-disabled=false`) — voir send_agent().
    """

    def __init__(self) -> None:
        tab = get_tab((  # noqa: F821
            'flow.google.com/project/' + FLOW_PROJECT_ID,
            'flow.google.com',
        ))
        if not tab:
            raise RuntimeError('Aucun projet Flow ouvert dans Brave CDP 9222.')
        self.c = CDP(tab)  # noqa: F821
        self.c.cmd('Runtime.enable')
        self.c.cmd('Page.enable')

    _DISPATCH = ("for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){"
                 "b.dispatchEvent(t.startsWith('pointer')?new PointerEvent(t,{bubbles:true,pointerType:'mouse',button:0})"
                 ":new MouseEvent(t,{bubbles:true,button:0}));}")

    def click_button(self, text, *, exact=False, role=None, wait=0.6):
        cond = ("e.innerText.trim()===%s" % json.dumps(text)) if exact else ("e.innerText.includes(%s)" % json.dumps(text))
        if role:
            cond += "&&e.getAttribute('role')===%s" % json.dumps(role)
        res = self.js("(()=>{let b=[...document.querySelectorAll('button,[role=button],[role=tab]')]"
                      ".filter(e=>e.getBoundingClientRect().width>0).find(e=>%s);if(!b)return null;%s"
                      "let r=b.getBoundingClientRect();return JSON.stringify({text:b.innerText.trim(),x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height})})()"
                      % (cond, self._DISPATCH))
        if not res:
            raise RuntimeError(f'Bouton Flow introuvable : {text}')
        time.sleep(wait)
        return json.loads(res)

    def close_profile(self):
        # Boîte ULTRA / Agent settings : Close (EN) ou Fermer (FR).
        self.js("(()=>{let d=[...document.querySelectorAll('[role=dialog],[aria-modal=true]')].pop();"
                "let labels=/^(close|fermer)/i;"
                "let b=d?[...d.querySelectorAll('button')].find(e=>labels.test(e.innerText.trim())"
                "||labels.test(e.getAttribute('aria-label')||'')"
                "||e.getAttribute('aria-label')==='Fermer cette fenêtre modale'"
                "||e.getAttribute('aria-label')==='Close'):null;"
                "if(!b){b=[...document.querySelectorAll('button')].find(e=>"
                "e.getAttribute('aria-label')==='Fermer cette fenêtre modale'"
                "||e.getAttribute('aria-label')==='Close this dialog'"
                "||e.getAttribute('aria-label')==='Close');}"
                "if(b){%s}return !!b})()" % self._DISPATCH)
        time.sleep(0.5)

    def recover_project_view(self):
        if any(b['text'] == 'ULTRA' for b in self.buttons()):
            return
        super().recover_project_view()

    def credits(self) -> int:
        # La boîte ULTRA met parfois quelques secondes à afficher la ligne du compteur
        # (mesuré le 04/09 sur un onglet qui venait de changer de projet) : 4 essais.
        last: Exception | None = None
        for _ in range(4):
            try:
                return int(super().credits())
            except RuntimeError as exc:  # « Compteur de crédits Flow illisible »
                last = exc
                time.sleep(3)
        raise last  # type: ignore[misc]

    def widen_viewport(self) -> None:
        # 04/09 : compositeur à x≈3470 → 4000 px. 09/09 : panneau agent +
        # Paramètres à x≈4031-4575 → 4600 px, sinon tune / Créer hors hit-test.
        w = int(self.js('window.innerWidth') or 0)
        h = int(self.js('window.innerHeight') or 0)
        if 0 < w < VIEWPORT_WIDTH:
            self.c.cmd('Emulation.setDeviceMetricsOverride', {
                'width': VIEWPORT_WIDTH,
                'height': max(h, 1200),
                'deviceScaleFactor': 1,
                'mobile': False,
            })
            time.sleep(1.5)

    def ensure_project(self) -> None:
        self.widen_viewport()
        url = str(self.js('location.href') or '')
        on_project = FLOW_PROJECT_ID in url and 'flow.google.com' in url
        in_editor = '/edit/' in url
        if on_project and not in_editor:
            return
        if on_project and in_editor:
            print('WARN: vue éditeur — retour à la grille projet.', flush=True)
            self._click_aria('Back button to go to previous page', fallback_text='arrow_back')
            time.sleep(2)
            url = str(self.js('location.href') or '')
            if FLOW_PROJECT_ID in url and '/edit/' not in url:
                return
        print(f'WARN: onglet Flow hors projet ({url}) — retour au projet configuré.', flush=True)
        self.c.cmd('Page.navigate', {'url': FLOW_PROJECT_URL})
        # L'application est une SPA : 8 s fixes ne suffisent pas toujours (mesuré le 04/09 :
        # « Éditeur de prompt Flow introuvable »). On attend l'éditeur Slate jusqu'à 45 s.
        for _ in range(45):
            time.sleep(1)
            if self.js("!!document.querySelector('[data-slate-editor=true], .ProseMirror[contenteditable=true]')"):
                time.sleep(2)
                return
        etat = self.js("JSON.stringify({title:document.title,url:location.href,boutons:document.querySelectorAll('button').length,"
                       "texte:(document.body&&document.body.innerText||'').slice(0,300)})")
        print(f'WARN: éditeur toujours absent après 45 s : {etat}', flush=True)

    def _click_aria(self, aria: str, *, fallback_text: str | None = None) -> bool:
        raw = self.js(
            "(()=>{let b=[...document.querySelectorAll('button,[role=button]')]"
            ".find(e=>e.getBoundingClientRect().width>0&&"
            f"(e.getAttribute('aria-label')==={json.dumps(aria)}"
            + (f"||(e.innerText||'').trim()==={json.dumps(fallback_text)}" if fallback_text else "")
            + "));if(!b)return null;let r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if not raw:
            return False
        pos = json.loads(raw)
        self.click(float(pos['x']), float(pos['y']), 0.8)
        return True

    def show_videos_view(self):
        self.ensure_project()
        self.js(
            "(()=>{let b=[...document.querySelectorAll('button,[role=button]')].find(e=>{"
            "let t=e.innerText||'';"
            "return e.getBoundingClientRect().width>0&&/videocam/.test(t)"
            "&&/(Videos|Vidéos|Afficher les vidéos)/.test(t);});"
            "if(b){%s}return !!b})()" % self._DISPATCH
        )
        time.sleep(1.0)

    def card_count(self) -> int:
        # 09/09 : les cartes sont des <flow-video-tile> (play_circle n'est plus un bouton).
        return int(self.js("document.querySelectorAll('flow-video-tile').length") or 0)

    def progress_count(self) -> int:
        return int(self.js("[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d{1,3}%$/.test((e.innerText||'').trim())).length") or 0)

    def failure_count(self) -> int:
        # UI 2026-09 : une carte EN COURS affiche un libellé « Échec » VISIBLE
        # à côté du pourcentage (plus masqué). L'agent écrit aussi
        # « warning Échec » dans le chat latéral. Un vrai échec = « Échec »
        # sur la grille (hors chat) SANS % voisin — sinon le pilote abortait
        # à 8 s alors que Veo était à 53 % (FLOWFIX1).
        return int(self.js(
            "(()=>{const vw=window.innerWidth;"
            "const eches=[...document.querySelectorAll('*')].filter(e=>{"
            "const t=(e.innerText||'').trim();"
            "return e.children.length===0&&(t==='Échec'||t==='Failed'||t==='Failure');});"
            "const pcts=[...document.querySelectorAll('*')].filter(e=>"
            "e.children.length===0&&/^\\\\d{1,3}%$/.test((e.innerText||'').trim()));"
            "let n=0;for(const e of eches){const r=e.getBoundingClientRect();"
            "if(r.width<=0||r.x>vw*0.7)continue;"
            "const near=pcts.some(p=>{const q=p.getBoundingClientRect();"
            "return Math.abs(q.y-r.y)<80&&Math.abs(q.x-r.x)<400});"
            "if(!near)n++;}return n})()"
        ) or 0)

    def top_card_ready(self) -> bool:
        # 09/09 : play_circle de la grille est un mat-icon, PAS un bouton.
        # Une carte prête = flow-video-tile visible avec vignette, sans %.
        info = self.top_tile_info()
        return bool(info.get('src')) and not info.get('progress')

    def top_tile_info(self) -> dict:
        raw = self.js(
            "(()=>{const tiles=[...document.querySelectorAll('flow-video-tile')]"
            ".map(t=>{const r=t.getBoundingClientRect();"
            "const img=t.querySelector('img.thumbnail, img');"
            "const grid=t.closest('flow-grid-tile-container');"
            "const pct=[...t.querySelectorAll('*')].some(e=>e.children.length===0"
            "&&/^\\\\d{1,3}%$/.test((e.innerText||'').trim()));"
            "const bar=!!t.querySelector('mat-progress-bar,[role=progressbar]');"
            "return {y:r.y,h:r.height,w:r.width,x:r.x,"
            "src:img?(img.currentSrc||img.src||''):'',"
            "aria:grid?grid.getAttribute('aria-label'):'',"
            "progress:pct||bar, vis:r.width>40&&r.height>40&&r.y>-20&&r.y<800};})"
            ".filter(t=>t.vis).sort((a,b)=>a.y-b.y);"
            "return JSON.stringify(tiles[0]||{});})()"
        )
        try:
            return json.loads(raw or '{}') or {}
        except json.JSONDecodeError:
            return {}

    def tile_thumbnails(self) -> set[str]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('flow-video-tile img')]"
            ".map(i=>i.currentSrc||i.src).filter(Boolean))"
        )
        return set(json.loads(raw or '[]'))

    def top_card_src(self) -> str:
        return str(self.top_tile_info().get('src') or '')

    def open_top_tile(self) -> bool:
        info = self.top_tile_info()
        if not info.get('w'):
            return False
        x = float(info['x']) + float(info['w']) / 2
        y = float(info['y']) + float(info['h']) / 2
        self.click(x, y, 1.5)
        for _ in range(20):
            href = str(self.js('location.href') or '')
            if '/edit/' in href:
                return True
            time.sleep(0.4)
        return '/edit/' in str(self.js('location.href') or '')

    def _visible_menu_labels(self) -> list[str]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('[role=menuitem],button')]"
            ".filter(e=>e.getBoundingClientRect().width>0)"
            ".map(e=>(e.innerText||'').trim()).filter(Boolean))"
        )
        return json.loads(raw or '[]')

    def _click_menu_label(self, label: str) -> bool:
        raw = self.js(
            "(()=>{const want=%s;"
            "const b=[...document.querySelectorAll('[role=menuitem],button')].find(e=>{"
            "const t=(e.innerText||'').trim();"
            "return e.getBoundingClientRect().width>0&&(t===want||t.replace(/\\s+/g,' ')===want.replace(/\\s+/g,' '));});"
            "if(!b)return null;let r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
            % json.dumps(label)
        )
        if not raw:
            return False
        pos = json.loads(raw)
        self.click(float(pos['x']), float(pos['y']), 1.0)
        return True

    def download_open_clip_720p(self, dest: Path) -> None:
        """Depuis /edit/… : Download media → 720p Original size (jamais 4K)."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        before = {p.name for p in dest.parent.iterdir()}
        home_before = {p.name for p in Path.home().joinpath('Downloads').glob('*')}
        try:
            self.c.cmd('Browser.setDownloadBehavior', {
                'behavior': 'allow',
                'downloadPath': str(dest.parent.resolve()),
                'eventsEnabled': True,
            })
        except Exception as exc:  # noqa: BLE001
            print(f'WARN: setDownloadBehavior ({exc})', flush=True)
        if not self._click_aria('Download media', fallback_text='download'):
            if not self._click_aria('Download'):
                raise RuntimeError('Bouton Download media introuvable.')
        time.sleep(1.0)
        labels = self._visible_menu_labels()
        paid = [lab for lab in labels if is_paid_upscale_option(lab)]
        if paid:
            print(f'INFO: options payantes ignorées : {paid}', flush=True)
        chosen = pick_720p_original_option(labels)
        if not chosen:
            raise RuntimeError(f'Menu 720p Original absent ({labels[:12]!r}).')
        if is_paid_upscale_option(chosen):
            raise RuntimeError(f'Refus de télécharger une option payante : {chosen!r}')
        if not self._click_menu_label(chosen):
            raise RuntimeError(f'Clic 720p raté : {chosen!r}')
        new_file: Path | None = None
        for _ in range(40):
            time.sleep(0.5)
            for folder, seen in (
                (dest.parent, before),
                (Path.home() / 'Downloads', home_before),
            ):
                for path in folder.iterdir():
                    if path.name in seen or path.name.startswith('.'):
                        continue
                    if path.suffix.lower() not in {'.mp4', '.webm', '.mov'}:
                        continue
                    if path.stat().st_size > 100_000:
                        new_file = path
                        break
                if new_file:
                    break
            if new_file:
                break
        if not new_file:
            raise RuntimeError('Téléchargement 720p introuvable (timeout).')
        if new_file.resolve() != dest.resolve():
            shutil.move(str(new_file), str(dest))
        if dest.stat().st_size < 100_000:
            dest.unlink(missing_ok=True)
            raise RuntimeError('Fichier téléchargé anormalement petit.')

    def leave_editor(self) -> None:
        href = str(self.js('location.href') or '')
        if '/edit/' not in href:
            return
        if not self._click_aria('Back button to go to previous page', fallback_text='arrow_back'):
            self.c.cmd('Page.navigate', {'url': FLOW_PROJECT_URL})
        for _ in range(20):
            time.sleep(0.4)
            if '/edit/' not in str(self.js('location.href') or ''):
                self.widen_viewport()
                return
        self.c.cmd('Page.navigate', {'url': FLOW_PROJECT_URL})
        time.sleep(3)
        self.widen_viewport()

    def configure_agent_defaults(self) -> None:
        """tune → Agent settings : Never + 16:9 + x1 + Veo 3.1 Quality + Save."""
        self.ensure_project()
        self.widen_viewport()
        if 'Agent settings' not in (self.js('document.body.innerText') or ''):
            if not self._click_aria('Settings', fallback_text='tune'):
                raise RuntimeError('Bouton Settings (tune) introuvable.')
            time.sleep(1.2)
        body = self.js('document.body.innerText') or ''
        if 'Agent settings' not in body:
            raise RuntimeError('Panneau Agent settings absent.')
        # Never (déjà coché sur le projet mesuré ; reclic idempotent).
        never = self.js(
            "(()=>{const b=[...document.querySelectorAll('mat-radio-button,button')].find(e=>"
            "/^Never/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>0);"
            "if(!b)return null;const r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,"
            "on:/checked/i.test(b.className||'')});})()"
        )
        if never:
            pos = json.loads(never)
            if not pos.get('on'):
                self.click(float(pos['x']), float(pos['y']), 0.6)
        model_btn = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "e.getAttribute('aria-label')==='Video generation default model'"
            "&&e.getBoundingClientRect().width>0);"
            "if(!b)return null;const r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,text:(b.innerText||'').trim()});})()"
        )
        if not model_btn:
            raise RuntimeError('Liste modèle vidéo introuvable.')
        model = json.loads(model_btn)
        # 16:9 et x1 du bloc *vidéo* = radios juste au-dessus du bouton modèle.
        ratio = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "e.getAttribute('aria-label')==='Video generation default model');"
            "if(!b)return null;const mr=b.getBoundingClientRect();"
            "const radios=[...document.querySelectorAll('[role=radio]')].filter(e=>{"
            "const r=e.getBoundingClientRect();"
            "return r.width>0&&r.y<mr.y&&r.y>mr.y-140&&/16:9/.test(e.innerText||'');});"
            "const t=radios.at(-1);if(!t)return null;const r=t.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if ratio:
            pos = json.loads(ratio)
            self.click(float(pos['x']), float(pos['y']), 0.5)
        oneshot = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "e.getAttribute('aria-label')==='Video generation default model');"
            "if(!b)return null;const mr=b.getBoundingClientRect();"
            "const radios=[...document.querySelectorAll('[role=radio]')].filter(e=>{"
            "const r=e.getBoundingClientRect();"
            "return r.width>0&&r.y<mr.y&&r.y>mr.y-90&&(e.innerText||'').trim()==='x1';});"
            "const t=radios.at(-1);if(!t)return null;const r=t.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if oneshot:
            pos = json.loads(oneshot)
            self.click(float(pos['x']), float(pos['y']), 0.5)
        if 'Veo 3.1 - Quality' not in (model.get('text') or ''):
            self.click(float(model['x']), float(model['y']), 1.0)
            if not self._click_menu_label('Veo 3.1 - Quality'):
                raise RuntimeError('Entrée Veo 3.1 - Quality absente du menu.')
            time.sleep(0.4)
        save = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "(e.innerText||'').trim()==='Save'&&e.getBoundingClientRect().width>0);"
            "if(!b)return null;const r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if not save:
            raise RuntimeError('Bouton Save des Agent settings introuvable.')
        pos = json.loads(save)
        self.click(float(pos['x']), float(pos['y']), 1.5)
        # Vérifier la persistance.
        time.sleep(0.6)
        if 'Agent settings' not in (self.js('document.body.innerText') or ''):
            if not self._click_aria('Settings', fallback_text='tune'):
                return
            time.sleep(1.0)
        check = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "e.getAttribute('aria-label')==='Video generation default model');"
            "return b?(b.innerText||'').trim():'';})()"
        ) or ''
        if 'Veo 3.1 - Quality' not in check:
            raise RuntimeError(f'Modèle vidéo non persisté : {check!r}')
        print(f'CONFIG: {check.replace(chr(10), " ")}', flush=True)
        if not self._click_aria('Back', fallback_text='arrow_back'):
            self._click_aria('Close', fallback_text='close')
        time.sleep(0.6)
        self.ensure_agent_instruction()

    def ensure_agent_instruction(self) -> None:
        """Consigne persistante : Veo 3.1 Quality (le défaut tune ne suffit pas)."""
        self.ensure_project()
        if not self._click_aria('Agent instructions', fallback_text='article_spark'):
            print('WARN: bouton Agent instructions introuvable.', flush=True)
            return
        time.sleep(1.0)
        body = self.js('document.body.innerText') or ''
        if 'Veo 3.1 Quality' in body and 'Omni Flash' in body:
            print('CONFIG: consigne agent déjà présente.', flush=True)
            if not self._click_aria('Back', fallback_text='arrow_back'):
                done = self.js(
                    "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
                    "(e.innerText||'').trim()==='Done'&&e.getBoundingClientRect().width>0);"
                    "if(!b)return null;const r=b.getBoundingClientRect();"
                    "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
                )
                if done:
                    pos = json.loads(done)
                    self.click(float(pos['x']), float(pos['y']), 0.8)
            return
        add = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "/Add instruction/i.test(e.innerText||'')&&e.getBoundingClientRect().width>0);"
            "if(!b)return null;const r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if not add:
            print('WARN: Add instruction introuvable.', flush=True)
            return
        pos = json.loads(add)
        self.click(float(pos['x']), float(pos['y']), 0.8)
        editor = self.js(
            "(()=>{const e=[...document.querySelectorAll('[contenteditable=true],textarea')]"
            ".find(el=>el.getBoundingClientRect().width>80);"
            "if(!e)return null;const r=e.getBoundingClientRect();e.focus();"
            "return JSON.stringify({x:r.x+20,y:r.y+12});})()"
        )
        if not editor:
            print('WARN: éditeur de consigne introuvable.', flush=True)
            return
        pos = json.loads(editor)
        self.click(float(pos['x']), float(pos['y']), 0.3)
        for char in AGENT_INSTRUCTION:
            self.c.cmd('Input.dispatchKeyEvent', {
                'type': 'char', 'text': char, 'unmodifiedText': char,
            })
        time.sleep(0.4)
        done = self.js(
            "(()=>{const b=[...document.querySelectorAll('button')].find(e=>"
            "(e.innerText||'').trim()==='Done'&&e.getBoundingClientRect().width>0);"
            "if(!b)return null;const r=b.getBoundingClientRect();"
            "return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()"
        )
        if done:
            pos = json.loads(done)
            self.click(float(pos['x']), float(pos['y']), 1.0)
        print('CONFIG: consigne agent Veo 3.1 Quality enregistrée.', flush=True)

    def configure(self, ratio: str) -> None:
        # Plus de puce « Vidéo · 8s » : les réglages vivent dans Agent settings.
        if ratio and ratio != '16:9':
            print(f'WARN: ratio demandé {ratio} — Agent settings forcé 16:9 Quality.', flush=True)
        self.configure_agent_defaults()

    def card_video_srcs(self) -> set:
        return self.tile_thumbnails()


def send_agent(flow, max_wait: int = 20) -> None:
    """Envoie le prompt via clic TRUSTED une fois le modèle Slate committé.

    UI 2026-09 : `b.disabled` est toujours false. L'état réel est
    `aria-disabled`. Un `b.click()` JS (isTrusted=false) ou un clic tant que
    aria-disabled=true est un no-op : le champ reste rempli, solde inchangé.
    """
    state = None
    for _ in range(max_wait):
        state = flow._send_button_state()  # noqa: SLF001 — helper Flow
        if agent_send_is_ready(
            disabled=bool(state.get('disabled')),
            aria_disabled=state.get('ariaDisabled'),
        ) and state.get('state') == 'ready':
            break
        time.sleep(1)
    else:
        raise RuntimeError(
            f'envoi agent Flow : bouton pas prêt ({state}). '
            'Le modèle Slate n’est probablement pas committé.'
        )
    flow.submit()
    val = ''
    for _ in range(12):
        time.sleep(1)
        val = flow.js("(()=>{let e=document.querySelector('[data-slate-editor=true], .ProseMirror[contenteditable=true]');return e?e.innerText.trim():''})()") or ''
        # placeholder FR « Que voulez-vous créer ? » / EN « What do you want to create? »
        if composer_looks_empty(val):
            return
    raise RuntimeError('champ non vidé après envoi (soumission incertaine).')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('prompts_json', type=Path, help='JSON: [{"id","prompt","ratio"}...]')
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--reserve', type=int, default=0, help='crédits à garder (0 = tout cramer)')
    ap.add_argument('--skip-configure', action='store_true', help="ne pas régler modèle/ratio (UI changée) — utiliser les réglages actuels du projet")
    ap.add_argument('--outdir', type=Path, default=Path('~/.codebuddy/media-video/flow-crame').expanduser())
    args = ap.parse_args()

    items = json.loads(args.prompts_json.read_text(encoding='utf-8'))
    if args.limit is not None:
        items = items[: args.limit]
    args.outdir.mkdir(parents=True, exist_ok=True)

    if other_browser_batch_active():  # noqa: F821 (défini par l'exec)
        raise RuntimeError('ARRÊT GARDE-FOU : un autre batch navigateur est actif.')

    flow = DomFlow()
    flow.ensure_project()  # revenir au projet configuré AVANT de lire le compteur
    if not args.skip_configure:
        flow.configure_agent_defaults()
        flow.ensure_project()
    start = flow.credits()
    print(f'CREDITS-DEPART {start}', flush=True)

    done = 0
    for spec in items:
        pid, prompt, ratio = spec['id'], spec['prompt'], spec.get('ratio', '16:9')
        credits = flow.credits()
        if credits - CREDITS_PER_SHOT < args.reserve:
            print(
                f'STOP: solde {credits} entamerait la réserve {args.reserve} '
                f'(prise={CREDITS_PER_SHOT}).',
                flush=True,
            )
            break
        out = args.outdir / f'{pid}.mp4'
        if out.exists() and out.stat().st_size > 100_000:
            print(f'[{pid}] déjà téléchargé, saut.', flush=True)
            continue
        print(f'[{pid}] credits={credits} ratio={ratio} — soumission...', flush=True)
        flow.ensure_project()
        flow.show_videos_view()
        before_thumbs = flow.tile_thumbnails()
        before_top = flow.top_card_src()
        needle = ' '.join((prompt or '').split()[:8])
        try:
            flow.ensure_project()
            flow.fill_prompt(QUALITY_PREFIX + prompt + SUFFIX)
            send_agent(flow)
        except Exception as exc:  # noqa: BLE001
            print(f'[{pid}] ERREUR soumission: {exc}', flush=True)
            continue

        deadline = time.time() + TIMEOUT_SECONDS
        new_src = None
        base_failures = flow.failure_count()
        submitted_seen = False
        retried_error = False
        while time.time() < deadline:
            time.sleep(POLL_SECONDS)
            href = str(flow.js('location.href') or '')
            if FLOW_PROJECT_ID not in href:
                print(f'[{pid}] onglet a quitté le projet — abandon de cette prise.', flush=True)
                break
            if '/edit/' in href:
                flow.leave_editor()
                continue
            ready = flow.top_card_ready()
            top = flow.top_tile_info()
            plays = flow.card_count()
            progress = flow.progress_count()
            body = flow.js('document.body.innerText') or ''
            queued = queued_in_body(body)
            elapsed = int(TIMEOUT_SECONDS - (deadline - time.time()))
            print(
                f'[{pid}] t={elapsed}s plays={plays} progress={progress} '
                f'ready={int(ready)} thumbs={len(flow.tile_thumbnails())} '
                f'top={str(top.get("aria") or "")[:40]!r} queued={int(queued)}',
                flush=True,
            )
            if queued or progress > 0 or (top.get('src') and top.get('src') not in before_thumbs):
                submitted_seen = True
            retry_labels = ('Réessayer', 'Try again', 'Retry')
            if (
                not retried_error
                and any(label in body for label in retry_labels)
                and progress == 0
                and not queued
            ):
                retry = next(
                    (
                        b for b in flow.buttons()
                        if any(label in (b.get('text') or '') for label in retry_labels)
                    ),
                    None,
                )
                if retry and retry.get('width', 0) > 0:
                    print(f'[{pid}] Flow a demandé un nouvel essai — second clic TRUSTED.', flush=True)
                    flow.unlock_ui()
                    flow.click(float(retry['x']), float(retry['y']), 1.5)
                    retried_error = True
                    submitted_seen = True
                    continue
            if not submitted_seen:
                if elapsed > 90:
                    print(f'[{pid}] aucune nouvelle carte après soumission.', flush=True)
                    break
                continue
            if flow.failure_count() > base_failures and progress == 0 and not top.get('src'):
                print(f'[{pid}] ÉCHEC signalé par Flow.', flush=True)
                break
            src = str(top.get('src') or '')
            if ready and src and src not in before_thumbs and src != before_top:
                # Titre auto (« Developer desk… ») ≠ 8 premiers mots du prompt :
                # on logge, mais une vignette ABSENTE de before_thumbs est la carte neuve.
                card_text = (top.get('aria') or '') + '\n' + body
                if needle and needle[:40].lower() not in card_text.lower():
                    print(
                        f'[{pid}] vignette nouvelle titre={top.get("aria")!r} '
                        '(prompt non relu dans le titre — on prend la carte du haut).',
                        flush=True,
                    )
                new_src = src
                break
            if progress > 0 or top.get('progress'):
                continue

        if not new_src:
            print(f'[{pid}] pas de vidéo (timeout/échec).', flush=True)
            continue
        try:
            if not flow.open_top_tile():
                raise RuntimeError('ouverture éditeur de la carte du haut impossible.')
            flow.download_open_clip_720p(out)
            flow.leave_editor()
            after = flow.credits()
            spent = credits - after
            print(
                f'[{pid}] OK -> {out} | {ffprobe_summary(out)} | delta={spent}',
                flush=True,
            )
            if spent < 50:
                print(
                    f'[{pid}] WARN: {spent} crédits seulement '
                    '(attendu ~100 pour Veo 3.1 Quality — Omni Flash ?).',
                    flush=True,
                )
            done += 1
        except Exception as exc:  # noqa: BLE001
            print(f'[{pid}] vidéo générée, download KO ({exc}) — récup manuelle via ⬇.', flush=True)
            try:
                flow.leave_editor()
            except Exception:
                pass

    print(f'CREDITS-FIN {flow.credits()} | clips {done}/{len(items)}', flush=True)


if __name__ == '__main__':
    main()
