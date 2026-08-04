#!/usr/bin/env python3
"""Consomme le quota Flow quotidien via le mode Agent.

Le driver s'attache exclusivement au Brave déjà ouvert sur CDP 9222. Il ne
pilote jamais HeyGen en parallèle, plafonne la dépense quotidienne, reprend les
tentatives interrompues et catalogue les captures sans supposer que leur ordre
correspond à celui des prompts.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
exec((SCRIPT_DIR / 'cdp-lib.py').read_text().split("if __name__")[0])

PROMPT_COST = 15
DEFAULT_QUEUE = Path('~/.codebuddy/media-video/flow-queue.md').expanduser()
DEFAULT_OUTPUT_ROOT = Path('~/.codebuddy/media-video/flow-daily').expanduser()
DEFAULT_STATE = Path('~/.codebuddy/media-video/flow-daily-state.json').expanduser()
DEFAULT_JOURNAL = Path('~/.codebuddy/media-video/flow-daily-journal.jsonl').expanduser()
LOCK_PATH = Path(f'/run/user/{os.getuid()}/codebuddy-flow-browser.lock')
POLL_SECONDS = 8
RESULT_TIMEOUT_SECONDS = 12 * 60
FAILURE_GRACE_SECONDS = 90

QUEUE_LINE = re.compile(
    r'^(?P<prefix>\s*-\s*\[)(?P<done>[ xX])(?P<suffix>\]\s*)(?P<body>.+?)\s*$'
)
RATIO = re.compile(r'^(?:16:9|9:16)$')


DEFAULT_BROLL: tuple[tuple[str, str, str], ...] = (
    (
        'default-city-paris-rain',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans texte ni logo : '
        'une rue parisienne contemporaine entièrement vide après une pluie '
        'd’été, reflets bleu et or, travelling avant très lent et stable, '
        'réalisme photographique, huit secondes, son ambiant discret.',
    ),
    (
        'default-tech-liquid-datacenter',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans texte ni logo : '
        'macro dans un datacenter futuriste crédible, tubes transparents de '
        'refroidissement liquide autour de processeurs en cuivre, lumière '
        'bleue subtile, lent mouvement orbital, huit secondes.',
    ),
    (
        'default-nature-atlantic-cliffs',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : falaises atlantiques françaises au lever du jour, brume '
        'légère et vagues longues, travelling aérien fluide et réaliste, '
        'huit secondes avec son naturel.',
    ),
    (
        'default-abstract-neural-glass',
        '16:9',
        'Crée un seul plan vidéo abstrait premium 16:9 sans texte ni logo : '
        'des nœuds de verre translucide forment progressivement un réseau '
        'neuronal bleu et ambre dans un volume noir, parallaxe lente, profondeur '
        'cinématographique, huit secondes.',
    ),
    (
        'default-city-marseille-dawn',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : architecture contemporaine de Marseille face à la '
        'Méditerranée à l’aube, air marin et longues ombres, travelling '
        'latéral stable, huit secondes.',
    ),
    (
        'default-tech-robotics-lab',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : bras robotiques précis assemblant des composants dans un '
        'laboratoire nocturne immaculé, macro vers plan large, mouvements '
        'mesurés, huit secondes.',
    ),
    (
        'default-nature-forest-mist',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : forêt ancienne au petit matin, brume entre les troncs, '
        'rayons de soleil doux et fines gouttes sur les fougères, lent '
        'travelling au ras du sol, huit secondes.',
    ),
    (
        'default-abstract-optical-fibers',
        '16:9',
        'Crée un seul plan vidéo abstrait premium 16:9 sans texte ni logo : '
        'fibres optiques transparentes traversées de lumière bleue et dorée '
        'comme une rivière de données, macro fluide, caustiques élégantes, '
        'huit secondes.',
    ),
    (
        'default-city-lyon-river',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : quais de Lyon à l’heure dorée, façades historiques reflétées '
        'dans une eau calme, dérive latérale très lente, huit secondes.',
    ),
    (
        'default-tech-silicon-wafer',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans texte ni logo : '
        'macro extrême d’une tranche de silicium sous une lumière de contrôle, '
        'circuits irisés nets et mouvement mécanique précis, réalisme '
        'industriel, huit secondes.',
    ),
    (
        'default-nature-alpine-lake',
        '16:9',
        'Crée un seul plan vidéo cinématographique 16:9 sans personne, texte '
        'ni logo : lac alpin parfaitement calme avant le lever du soleil, '
        'montagnes reflétées et nuages qui se dégagent lentement, approche '
        'aérienne douce, huit secondes.',
    ),
    (
        'default-abstract-metal-cubes',
        '16:9',
        'Crée un seul plan vidéo abstrait premium 16:9 sans texte ni logo : '
        'des milliers de microcubes métalliques s’assemblent en couches puis '
        'se dispersent en vague sur fond anthracite, lumière latérale douce, '
        'mouvement orbital lent, huit secondes.',
    ),
)


@dataclass(frozen=True)
class QueueItem:
    prompt_id: str
    ratio: str
    prompt: str
    source: str
    line_index: int | None = None


def strip_media_url_type(url: str) -> str:
    """Ramène une URL média Flow à sa forme téléchargeable (sans `mediaUrlType`).

    Les vignettes de la grille ajoutent `mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL`,
    qui renvoie une image : `download_sources` la rejetterait, ffprobe ne trouvant
    aucune durée. Sans le paramètre, la même ressource sert la vidéo.
    """
    if 'getMediaUrlRedirect' not in url:
        return url
    base, sep, query = url.partition('?')
    if not sep:
        return url
    kept = [p for p in query.split('&') if p and not p.startswith('mediaUrlType=')]
    return f'{base}?{"&".join(kept)}' if kept else base


def production_rules(ratio: str) -> str:
    """Contraintes ajoutées à CHAQUE prompt, file comprise.

    Un plan qui sort avec un défaut a coûté ses crédits pour rien : mieux vaut
    les dépenser en interdisant d'avance ce qu'on sait que le modèle produit
    spontanément. Les interdits ci-dessous visent des défauts constatés sur des
    rushes réels, pas des précautions théoriques.

    Le texte incrusté est le premier d'entre eux : le modèle ajoute volontiers
    des sous-titres ou des légendes inventées, illisibles et impossibles à
    retirer — et un rush qui en porte n'est réutilisable dans aucun montage.
    """
    return (
        f'Contraintes de production, à respecter strictement : un seul plan continu de huit '
        f'secondes au ratio {ratio}, sans aucune coupure ni changement de plan. '
        'Aucun texte à l’image : ni sous-titre, ni légende, ni carton, ni titre, ni générique, '
        'ni chiffre, ni écriture d’aucune sorte, y compris floue ou en arrière-plan. '
        'Aucun logo, aucune marque, aucun filigrane, aucun élément d’interface. '
        'Aucun visage humain reconnaissable ni main en gros plan si le sujet n’en demande pas. '
        'Caméra stable et mouvement lent et régulier, exposition constante, '
        'rendu photographique cohérent du début à la fin du plan.'
    )


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def today() -> str:
    return datetime.now().astimezone().date().isoformat()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temp, path)


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            'version': 1,
            'createdAt': now(),
            'days': {},
            'records': [],
            'defaultCursor': 0,
        }
    state = json.loads(path.read_text())
    if state.get('version') != 1:
        raise RuntimeError(f'Version d’état Flow inconnue : {state.get("version")!r}')
    state.setdefault('days', {})
    state.setdefault('records', [])
    state.setdefault('defaultCursor', 0)
    return state


def journal(path: Path, event: str, **values: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {'at': now(), 'event': event, **values}
    with path.open('a') as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + '\n')


def slug(value: str) -> str:
    normalized = re.sub(r'[^a-zA-Z0-9]+', '-', value).strip('-').lower()
    return normalized[:64] or 'prompt'


def parse_queue_text(text: str) -> list[QueueItem]:
    items: list[QueueItem] = []
    in_fence = False
    for index, line in enumerate(text.splitlines()):
        if line.strip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = QUEUE_LINE.match(line)
        if not match or match.group('done').lower() == 'x':
            continue
        body = match.group('body').strip()
        parts = [part.strip() for part in body.split('|', 2)]
        if len(parts) == 3 and RATIO.fullmatch(parts[1]):
            prompt_id = slug(parts[0].strip('`* '))
            ratio = parts[1]
            prompt = parts[2]
        else:
            ratio_match = re.search(r'\[(16:9|9:16)\]', body)
            ratio = ratio_match.group(1) if ratio_match else '16:9'
            prompt = re.sub(r'\s*\[(?:16:9|9:16)\]\s*', ' ', body).strip()
            digest = hashlib.sha256(prompt.encode()).hexdigest()[:12]
            prompt_id = f'queue-{digest}'
        if prompt:
            items.append(QueueItem(prompt_id, ratio, prompt, 'queue', index))
    return items


def load_queue(path: Path) -> tuple[str, list[QueueItem]]:
    if not path.exists():
        return '', []
    text = path.read_text()
    return text, parse_queue_text(text)


def mark_queue_item(path: Path, item: QueueItem) -> None:
    if item.source != 'queue' or item.line_index is None or not path.exists():
        return
    lines = path.read_text().splitlines()
    if item.line_index >= len(lines):
        return
    match = QUEUE_LINE.match(lines[item.line_index])
    if not match or match.group('done').lower() == 'x':
        return
    lines[item.line_index] = (
        f"{match.group('prefix')}x{match.group('suffix')}{match.group('body')}"
    )
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text('\n'.join(lines) + '\n')
    os.replace(temp, path)


def default_items(
    state: dict[str, Any],
    count: int,
    *,
    exclude: Iterable[str] = (),
) -> list[QueueItem]:
    excluded = set(exclude)
    result: list[QueueItem] = []
    cursor = int(state.get('defaultCursor', 0))
    checks = 0
    while len(result) < count and checks < len(DEFAULT_BROLL) * 2:
        prompt_id, ratio, prompt = DEFAULT_BROLL[cursor % len(DEFAULT_BROLL)]
        cursor += 1
        checks += 1
        dated_id = f'{prompt_id}-{today()}'
        if dated_id in excluded:
            continue
        result.append(QueueItem(dated_id, ratio, prompt, 'default'))
    state['defaultCursor'] = cursor % len(DEFAULT_BROLL)
    return result


def compute_plan_target(
    balance: int,
    daily_budget: int,
    reserve: int,
    prompt_cost: int = PROMPT_COST,
) -> int:
    spendable = min(daily_budget, max(0, balance - reserve))
    return spendable // prompt_cost


def compute_run_target(
    *,
    balance: int,
    successes_today: int,
    reserve: int,
    budget: int | None,
    max_plans: int | None,
    prompt_cost: int = PROMPT_COST,
) -> int:
    """Calcule une cible reprenable depuis le solde réellement disponible."""
    spendable = max(0, balance - reserve)
    if budget is not None:
        spendable = min(spendable, budget)
    target = successes_today + spendable // prompt_cost
    if max_plans is not None:
        target = min(target, max_plans)
    return target


def browser_batch_process() -> str | None:
    own_pid = os.getpid()
    own_script = Path(__file__).name
    guarded = {'heygen-batch.py', 'flow-veo-mission.py', own_script}
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == own_pid:
            continue
        try:
            args = [
                arg.decode(errors='ignore')
                for arg in (proc / 'cmdline').read_bytes().split(b'\0')
                if arg
            ]
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            continue
        if not args or not Path(args[0]).name.startswith('python'):
            continue
        script_names = {Path(arg).name for arg in args[1:]}
        conflict = guarded & script_names
        if conflict:
            return sorted(conflict)[0]
    return None


class BrowserLock:
    def __enter__(self) -> 'BrowserLock':
        LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.handle = LOCK_PATH.open('w')
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Un autre batch Flow détient déjà le verrou CDP.') from error
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return self

    def __exit__(self, *_args: object) -> None:
        fcntl.flock(self.handle, fcntl.LOCK_UN)
        self.handle.close()


class FlowAgent:
    def __init__(self, project_url: str | None = None) -> None:
        tab = get_tab(('labs.google', 'flow'))
        if not tab:
            raise RuntimeError('Aucun projet Flow ouvert dans Brave CDP 127.0.0.1:9222.')
        self.c = CDP(tab)
        self.c.cmd('Runtime.enable')
        self.c.cmd('Page.enable')
        if project_url:
            self.c.cmd('Page.navigate', {'url': project_url})
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if self.js("Boolean(document.querySelector('[data-slate-editor=true]'))"):
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Le projet Flow quotidien n’a pas fini de charger.')

    def js(self, expression: str) -> Any:
        return self.c.ev(expression)

    def click(self, x: float, y: float, wait: float = 0.5) -> None:
        for event_type in ('mousePressed', 'mouseReleased'):
            self.c.cmd(
                'Input.dispatchMouseEvent',
                {
                    'type': event_type,
                    'x': x,
                    'y': y,
                    'button': 'left',
                    'clickCount': 1,
                },
            )
        time.sleep(wait)

    def buttons(self) -> list[dict[str, Any]]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('button')]."
            "filter(e=>e.getBoundingClientRect().width>0).map(e=>{"
            "let r=e.getBoundingClientRect();return {"
            "text:(e.innerText||'').trim(),aria:e.getAttribute('aria-label'),"
            "x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}}))"
        )
        return json.loads(raw or '[]')

    def find_button(self, text: str, *, exact: bool = False) -> dict[str, Any] | None:
        for button in self.buttons():
            candidate = button['text']
            if (candidate == text if exact else text in candidate):
                return button
        return None

    def click_button(self, text: str, *, exact: bool = False, wait: float = 0.6) -> None:
        button = self.find_button(text, exact=exact)
        if not button:
            raise RuntimeError(f'Bouton Flow introuvable : {text}')
        self.click(button['x'], button['y'], wait)

    def dismiss_announcement(self) -> bool:
        """Ferme une annonce produit Flow (« Dernière mise à jour de Flow »).

        Ces modales n'ont pas le bouton `aria-label="Fermer cette fenêtre modale"`
        que cherche `close_profile` : elles ne se ferment que par leur bouton
        d'action. Sans cela elles restent ouvertes indéfiniment, captent le focus
        et font échouer `focus_editor()` — observé le 2026-08-04, où la passe
        quotidienne mourait sur « L'éditeur Flow refuse le focus » après avoir
        déjà payé la soumission.
        """
        return bool(
            self.js(
                "(()=>{for(const d of document.querySelectorAll('[role=dialog]')){"
                "for(const b of d.querySelectorAll('button')){"
                "const t=(b.innerText||'').trim().toLowerCase();"
                "if(t==='commencer'||t==='get started'){b.click();return true}}}"
                "return false})()"
            )
        )

    def close_profile(self) -> None:
        closed = self.js(
            "(()=>{let dialog=document.querySelector('[role=dialog][data-state=open]');"
            "if(!dialog)return false;"
            "let button=dialog.querySelector('[aria-label=\"Fermer cette fenêtre modale\"]');"
            "if(!button)return false;button.click();return true})()"
        )
        if not closed and self.dismiss_announcement():
            closed = True
        if closed:
            for _ in range(20):
                if not self.js(
                    "Boolean(document.querySelector('[role=dialog][data-state=open]'))"
                ):
                    break
                time.sleep(0.1)
        self.repair_pointer_events()

    def repair_pointer_events(self) -> None:
        """Répare le verrou Radix parfois laissé après fermeture du profil."""
        self.js(
            "(()=>{if(!document.querySelector('[role=dialog][data-state=open]'))"
            "document.body.style.pointerEvents='';return true})()"
        )

    def body(self) -> str:
        return self.js('document.body.innerText') or ''

    def credits(self) -> int:
        self.close_profile()
        ultra: dict[str, Any] | None = None
        for _ in range(30):
            ultra = self.find_button('ULTRA', exact=True)
            if ultra:
                break
            time.sleep(1)
        if not ultra:
            raise RuntimeError('Bouton Flow ULTRA introuvable après chargement.')
        opened = self.js(
            "(()=>{let b=[...document.querySelectorAll('button')].find(e=>"
            "(e.innerText||'').trim()==='ULTRA');if(!b)return false;"
            "b.click();return true})()"
        )
        if not opened:
            raise RuntimeError('Le menu Flow ULTRA ne s’est pas ouvert.')
        time.sleep(0.8)
        match: re.Match[str] | None = None
        for _ in range(24):
            match = re.search(r'([0-9 ]+)\s*Crédits Google', self.body())
            if match:
                break
            time.sleep(0.5)
        if not match:
            raise RuntimeError('Compteur de crédits Flow illisible.')
        value = int(match.group(1).replace(' ', ''))
        self.close_profile()
        return value

    def ensure_agent_mode(self) -> None:
        self.close_profile()
        if self.find_button('Instructions pour l’agent') or self.find_button(
            'Instructions pour l\'agent'
        ):
            return
        self.click_button('Agent', exact=True, wait=1.0)
        for _ in range(10):
            if self.find_button('arrow_forward\nCréer', exact=True):
                return
            time.sleep(0.3)
        raise RuntimeError('Le mode Agent Flow ne s’est pas activé.')

    def ensure_video_view(self) -> set[str]:
        self.close_profile()
        clicked = self.js(
            "(()=>{let b=[...document.querySelectorAll('button')].find(e=>"
            "(e.innerText||'').includes('Afficher les vidéos'));"
            "if(!b)return false;b.click();return true})()"
        )
        if not clicked:
            raise RuntimeError('Onglet Vidéos Flow introuvable.')
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            sources = self.videos()
            if sources:
                return self.settle_media()
            time.sleep(2)
        return self.settle_media()

    def focus_editor(self) -> None:
        focused = self.js(
            "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
            "if(!e)return false;e.focus();return document.activeElement===e})()"
        )
        if not focused:
            raise RuntimeError('L’éditeur Flow refuse le focus.')
        raw = self.js(
            "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
            "if(!e)return null;let r=e.getBoundingClientRect();"
            "return JSON.stringify([r.x+r.width/3,r.y+r.height/2])})()"
        )
        if not raw:
            raise RuntimeError('Éditeur de prompt Flow introuvable.')
        x, y = json.loads(raw)
        self.click(x, y, 0.2)
        self.js(
            "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
            "e.focus();return document.activeElement===e})()"
        )

    def fill_prompt(self, prompt: str) -> None:
        self.focus_editor()
        self.c.cmd(
            'Input.dispatchKeyEvent',
            {
                'type': 'keyDown',
                'key': 'a',
                'code': 'KeyA',
                'windowsVirtualKeyCode': 65,
                'nativeVirtualKeyCode': 65,
                'modifiers': 2,
            },
        )
        self.c.cmd(
            'Input.dispatchKeyEvent',
            {
                'type': 'keyUp',
                'key': 'a',
                'code': 'KeyA',
                'windowsVirtualKeyCode': 65,
                'nativeVirtualKeyCode': 65,
                'modifiers': 2,
            },
        )
        self.c.cmd(
            'Input.dispatchKeyEvent',
            {
                'type': 'keyDown',
                'key': 'Backspace',
                'code': 'Backspace',
                'windowsVirtualKeyCode': 8,
                'nativeVirtualKeyCode': 8,
            },
        )
        self.c.cmd(
            'Input.dispatchKeyEvent',
            {
                'type': 'keyUp',
                'key': 'Backspace',
                'code': 'Backspace',
                'windowsVirtualKeyCode': 8,
                'nativeVirtualKeyCode': 8,
            },
        )
        self.js(
            "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
            "e.focus();return document.activeElement===e})()"
        )
        self.c.cmd('Input.insertText', {'text': prompt})
        time.sleep(0.4)
        actual = self.js(
            "document.querySelector('[data-slate-editor=true]').innerText"
        ) or ''
        if actual.strip('\n\ufeff ') != prompt:
            raise RuntimeError(
                f'Prompt Flow divergent ({len(actual)} caractères au lieu de {len(prompt)}).'
            )

    def submit(self) -> None:
        self.ensure_agent_mode()
        self.approval_cursor = self.proposal_count()
        clicked = self.js(
            "(()=>{let buttons=[...document.querySelectorAll('button')].filter(e=>{"
            "let t=(e.innerText||'').trim();"
            "return t.includes('arrow_forward')&&t.includes('Créer')"
            "&&!t.includes('raisonnement')&&!e.disabled});"
            "let button=buttons.at(-1);if(!button)return false;"
            "button.click();return true})()"
        )
        if not clicked:
            raise RuntimeError('Flèche d’envoi Agent introuvable ou inactive.')
        time.sleep(1)

    def proposals(self) -> list[str]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('*')].filter(e=>{"
            "let t=(e.innerText||'').trim();"
            "return /^Voulez-vous que je lance[\\s\\S]*coûtera[\\s\\S]*crédits\\s*\\?$/i"
            ".test(t)}).filter(e=>![...e.children].some(c=>{"
            "let t=(c.innerText||'').trim();"
            "return /^Voulez-vous que je lance[\\s\\S]*coûtera[\\s\\S]*crédits\\s*\\?$/i"
            ".test(t)})).map(e=>(e.innerText||'').trim()))"
        )
        return json.loads(raw or '[]')

    def proposal_count(self) -> int:
        return len(self.proposals())

    def approve_if_needed(self) -> bool:
        proposals = self.proposals()
        cursor = getattr(self, 'approval_cursor', 0)
        if len(proposals) <= cursor:
            return False
        latest = proposals[-1]
        cost = re.search(r'\b(\d+)\s*crédits?\b', latest, re.IGNORECASE)
        if not cost or int(cost.group(1)) != PROMPT_COST:
            raise RuntimeError(
                f'Flow propose un coût inattendu : {latest!r}'
            )
        clicked = self.js(
            "(()=>{let labels=['Approuver et ne plus demander','Accepter'];"
            "let candidates=[...document.querySelectorAll('*')].filter(e=>"
            "labels.includes((e.innerText||'').trim()));"
            "let e=candidates.at(-1);if(!e)return false;"
            "let target=e.parentElement;let r=target.getBoundingClientRect();"
            "return JSON.stringify([r.x+r.width/2,r.y+r.height/2])})()"
        )
        if not clicked:
            raise RuntimeError('Bouton d’approbation Agent introuvable.')
        self.repair_pointer_events()
        x, y = json.loads(clicked)
        self.click(x, y, 0.8)
        self.approval_cursor = len(proposals)
        return True

    def videos(self) -> set[str]:
        """Médias présents dans le projet, sous la forme d'URL téléchargeables.

        Historiquement Flow montait un `<video>` par plan et il suffisait de lire
        son `src`. Depuis la refonte de juillet 2026, la grille n'affiche plus que
        des vignettes `<img>` : `document.querySelectorAll('video')` renvoie zéro,
        le driver ne voyait donc JAMAIS arriver le plan qu'il venait de payer, et
        concluait au timeout après l'avoir facturé.

        Une vignette porte la même ressource que la vidéo, au paramètre près :
            …getMediaUrlRedirect?name=<uuid>&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL  (image)
            …getMediaUrlRedirect?name=<uuid>                                        (vidéo)
        C'est exactement la forme des sources que le script téléchargeait déjà
        avec succès. On retire donc le paramètre pour revenir à la vidéo, et on
        garde le chemin `<video>` au cas où Flow le rétablirait.
        """
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('video')]"
            ".map(v=>v.currentSrc||v.src).filter(Boolean)"
            ".concat([...document.querySelectorAll('img')].map(i=>i.src)"
            ".filter(s=>s&&s.includes('getMediaUrlRedirect'))))"
        )
        found: set[str] = set()
        for url in json.loads(raw or '[]'):
            found.add(strip_media_url_type(url))
        return found

    def failure_count(self) -> int:
        return int(
            self.js(
                "[...document.querySelectorAll('*')].filter(e=>{"
                "let t=(e.innerText||'').trim();"
                "return t==='Échec'||t==='Un problème est survenu'}).length"
            )
            or 0
        )

    def pending_count(self) -> int:
        return int(
            self.js(
                "[...document.querySelectorAll('*')].filter(e=>{"
                "let t=(e.innerText||'').trim();"
                "let pending=/^(Création|Génération).*(cours|en attente)/i.test(t)"
                "||/^\\d{1,3}%$/.test(t);if(!pending)return false;"
                "let p=e;for(let i=0;i<12&&p;i++,p=p.parentElement)"
                "if(p.querySelector?.('video[src]'))return false;"
                "return true}).length"
            )
            or 0
        )

    def settle_media(self, timeout: int = 90) -> set[str]:
        deadline = time.monotonic() + timeout
        previous: set[str] | None = None
        stable = 0
        while time.monotonic() < deadline:
            current = self.videos()
            if current == previous and self.pending_count() == 0:
                stable += 1
                if stable >= 3:
                    return current
            else:
                stable = 0
            previous = current
            time.sleep(3)
        return self.videos()

    def wait_for_result(
        self,
        before_sources: set[str],
        before_failures: int,
        *,
        timeout: int,
    ) -> tuple[str, set[str]]:
        deadline = time.monotonic() + timeout
        failure_seen_at: float | None = None
        while time.monotonic() < deadline:
            time.sleep(POLL_SECONDS)
            self.approve_if_needed()
            new_sources = self.videos() - before_sources
            if new_sources:
                return 'success', new_sources
            if self.failure_count() > before_failures:
                failure_seen_at = failure_seen_at or time.monotonic()
                if time.monotonic() - failure_seen_at >= FAILURE_GRACE_SECONDS:
                    return 'failed', set()
        return 'timeout', set()

    def fetch_video(self, source: str, output: Path) -> None:
        expression = (
            f"fetch({json.dumps(source)}).then(async r=>{{"
            "if(!r.ok)throw new Error('HTTP '+r.status);let b=await r.arrayBuffer();"
            "let s='';let u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)"
            "s+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(s)})"
        )
        result = self.c.cmd(
            'Runtime.evaluate',
            {
                'expression': expression,
                'awaitPromise': True,
                'returnByValue': True,
            },
            to=240,
        )
        value = (result or {}).get('result', {}).get('result', {}).get('value')
        if not value:
            raise RuntimeError('Téléchargement CDP vide.')
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_suffix('.tmp')
        temp.write_bytes(base64.b64decode(value))
        if temp.stat().st_size < 100_000:
            temp.unlink(missing_ok=True)
            raise RuntimeError('Vidéo téléchargée anormalement petite.')
        os.replace(temp, output)


def video_duration(path: Path) -> float:
    result = subprocess.run(
        [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=nw=1:nk=1',
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return float(result.stdout.strip()) if result.returncode == 0 else 0.0
    except ValueError:
        return 0.0


def next_capture(day_dir: Path) -> Path:
    numbers: list[int] = []
    for path in day_dir.glob('capture-*.mp4'):
        match = re.fullmatch(r'capture-(\d+)\.mp4', path.name)
        if match:
            numbers.append(int(match.group(1)))
    return day_dir / f'capture-{max(numbers, default=0) + 1:03d}.mp4'


def download_sources(
    flow: FlowAgent,
    sources: Iterable[str],
    day_dir: Path,
) -> list[str]:
    outputs: list[str] = []
    for source in sorted(set(sources)):
        output = next_capture(day_dir)
        last_error: Exception | None = None
        for _ in range(3):
            try:
                flow.fetch_video(source, output)
                if video_duration(output) < 3.5:
                    raise RuntimeError('ffprobe n’a pas validé au moins 3,5 secondes.')
                outputs.append(str(output))
                last_error = None
                break
            except Exception as error:
                last_error = error
                output.unlink(missing_ok=True)
                time.sleep(3)
        if last_error:
            raise last_error
    return outputs


def build_contact_sheet(day_dir: Path, records: list[dict[str, Any]]) -> Path | None:
    videos = sorted(day_dir.glob('capture-*.mp4'))
    if not videos:
        return None
    contact_dir = day_dir / 'contact'
    contact_dir.mkdir(parents=True, exist_ok=True)
    strips: list[Path] = []
    for video in videos:
        strip = contact_dir / f'{video.stem}.jpg'
        result = subprocess.run(
            [
                'ffmpeg',
                '-y',
                '-v',
                'error',
                '-i',
                str(video),
                '-vf',
                (
                    'fps=1/2,'
                    'scale=320:180:force_original_aspect_ratio=decrease,'
                    'pad=320:180:(ow-iw)/2:(oh-ih)/2:black,'
                    'tile=4x1'
                ),
                '-frames:v',
                '1',
                str(strip),
            ],
            check=False,
        )
        if result.returncode == 0 and strip.exists():
            strips.append(strip)
    if not strips:
        return None
    sheet = day_dir / 'planche-contact.jpg'
    command = ['montage']
    for strip in strips:
        command.extend(['-label', strip.stem, str(strip)])
    command.extend(
        [
            '-tile',
            '1x',
            '-geometry',
            '+8+12',
            '-background',
            '#111111',
            '-fill',
            'white',
            str(sheet),
        ]
    )
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        return None
    catalog = {
        'date': today(),
        'warning': (
            'Le lien prompt↔capture est volontairement non vérifié : Flow rend '
            'en asynchrone. Valider visuellement cette planche-contact.'
        ),
        'captures': [
            {
                'file': output,
                'candidatePromptId': record.get('promptId'),
                'candidatePrompt': record.get('prompt'),
                'mappingConfidence': 'unverified',
            }
            for record in records
            if record.get('status') == 'success'
            for output in record.get('outputs', [])
        ],
    }
    atomic_json(day_dir / 'catalogue.json', catalog)
    return sheet


def records_for_day(state: dict[str, Any], date: str) -> list[dict[str, Any]]:
    return [record for record in state['records'] if record.get('date') == date]


def successful_prompt_ids(state: dict[str, Any], date: str) -> set[str]:
    return {
        str(record.get('promptId'))
        for record in records_for_day(state, date)
        if record.get('status') == 'success'
    }


def append_record(
    state: dict[str, Any],
    state_path: Path,
    record: dict[str, Any],
) -> None:
    state['records'].append(record)
    atomic_json(state_path, state)


def status_report(
    state: dict[str, Any],
    queue_path: Path,
    *,
    live_credits: int | None,
) -> dict[str, Any]:
    date = today()
    _, queue = load_queue(queue_path)
    day = state['days'].get(date, {})
    records = records_for_day(state, date)
    return {
        'date': date,
        'liveCredits': live_credits,
        'day': day,
        'pendingQueue': len(queue),
        'successesToday': sum(r.get('status') == 'success' for r in records),
        'attemptsToday': len(records),
        'lastRecords': records[-5:],
    }


def run(args: argparse.Namespace) -> int:
    state = load_state(args.state)
    if args.status:
        try:
            live = FlowAgent().credits()
        except Exception:
            live = None
        print(
            json.dumps(
                status_report(state, args.queue, live_credits=live),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    conflict = browser_batch_process()
    if conflict:
        raise RuntimeError(f'ARRÊT GARDE-FOU : {conflict} est actif.')

    with BrowserLock():
        flow = FlowAgent(args.project_url)
        date = today()
        day_dir = args.output_root / date
        day_dir.mkdir(parents=True, exist_ok=True)
        start_balance = flow.credits()
        records = records_for_day(state, date)
        successes_at_start = sum(
            record.get('status') == 'success' for record in records
        )
        run_budget = args.daily_budget
        effective_budget = (
            run_budget
            if run_budget is not None
            else max(0, start_balance - args.reserve)
        )
        day = state['days'].setdefault(
            date,
            {
                'startedAt': now(),
                'startCredits': start_balance,
                'promptCost': PROMPT_COST,
            },
        )
        day['budgetCredits'] = run_budget
        day['reserveCredits'] = args.reserve
        day['lastRunStartedAt'] = now()
        day['lastRunStartCredits'] = start_balance
        atomic_json(args.state, state)
        target = compute_run_target(
            balance=start_balance,
            successes_today=successes_at_start,
            reserve=args.reserve,
            budget=run_budget,
            max_plans=args.max_plans,
        )
        journal(
            args.journal,
            'run-start',
            date=date,
            creditsStart=start_balance,
            budget=run_budget,
            effectiveBudget=effective_budget,
            reserve=args.reserve,
            successesAtStart=successes_at_start,
            target=target,
            resume=args.resume,
        )

        queue_text, pending = load_queue(args.queue)
        del queue_text
        completed = successful_prompt_ids(state, date)
        for item in list(pending):
            if item.prompt_id in completed:
                mark_queue_item(args.queue, item)
        _, pending = load_queue(args.queue)

        successes = sum(
            record.get('status') == 'success'
            for record in records_for_day(state, date)
        )
        needed = max(0, target - successes)
        candidates = [
            item for item in pending if item.prompt_id not in completed
        ]
        candidates.extend(
            default_items(
                state,
                max(needed * 2, 4),
                exclude=completed | {item.prompt_id for item in candidates},
            )
        )
        atomic_json(args.state, state)

        # RÉCOLTE — avant toute sortie anticipée, car c'est justement quand il n'y a
        # rien à soumettre qu'il reste des plans à récupérer.
        #
        # Depuis juillet 2026, Flow met les demandes EN FILE D'ATTENTE (« la génération
        # a été programmée… elle sera prête ») : le plan est facturé immédiatement mais
        # n'apparaît qu'après la fin de la passe qui l'a demandé. L'ancien code fusionnait
        # alors le média dans `projectSources` sans jamais le télécharger — la vidéo était
        # payée, produite, puis abandonnée sur place. On rattrape donc, au début de chaque
        # passe, tout ce qui est apparu depuis la précédente.
        visible_sources = flow.ensure_video_view()
        previously_known = set(state.get('projectSources', []))
        harvested = sorted(visible_sources - previously_known)
        if harvested:
            try:
                outputs = download_sources(flow, harvested, day_dir)
                print(f'FLOW-DAILY récolte : {len(outputs)} plan(s) en attente récupéré(s)',
                      flush=True)
                journal(args.journal, 'harvest', date=date,
                        recovered=len(outputs), sources=harvested)
            except Exception as error:
                # Ne jamais faire échouer la passe sur la récolte : le média reste dans
                # Flow et sera retenté au prochain passage.
                print(f'FLOW-DAILY récolte incomplète : {error}', flush=True)

        if needed == 0:
            ending = flow.credits()
            day['lastCredits'] = ending
            day['lastRunSpentCredits'] = max(0, start_balance - ending)
            if args.max_plans is not None and successes >= args.max_plans:
                day['stopReason'] = 'limite --max-plans déjà atteinte'
            elif run_budget is not None and run_budget < PROMPT_COST:
                day['stopReason'] = 'budget explicite insuffisant pour un plan'
            else:
                day['stopReason'] = 'solde de crédits insuffisant'
            day['finishedAt'] = now()
            atomic_json(args.state, state)
            build_contact_sheet(day_dir, records_for_day(state, date))
            journal(
                args.journal,
                'run-noop',
                date=date,
                creditsStart=start_balance,
                creditsConsumed=day['lastRunSpentCredits'],
                creditsRemaining=ending,
                reason=day['stopReason'],
            )
            print(
                f'FLOW-DAILY arrêté : crédits départ={start_balance}, '
                f'consommés={day["lastRunSpentCredits"]}, restants={ending}, '
                f'raison={day["stopReason"]}',
                flush=True,
            )
            return 0

        known_sources = previously_known | visible_sources
        state['projectSources'] = sorted(known_sources)
        atomic_json(args.state, state)
        stop_reason = 'candidats épuisés avant la cible'
        for item in candidates:
            if successes >= target:
                stop_reason = (
                    'limite --max-plans atteinte'
                    if args.max_plans is not None and successes >= args.max_plans
                    else 'budget de cette passe consommé'
                )
                break
            if browser_batch_process():
                raise RuntimeError('Un batch navigateur concurrent vient de démarrer.')
            item_success = False
            for retry in range(1, args.attempts_per_prompt + 1):
                current_credits = flow.credits()
                spent = max(0, start_balance - current_credits)
                if current_credits - args.reserve < PROMPT_COST:
                    stop_reason = 'solde de crédits insuffisant'
                    break
                if run_budget is not None and spent + PROMPT_COST > run_budget:
                    stop_reason = 'budget explicite de cette passe atteint'
                    break

                flow.ensure_agent_mode()
                visible_sources = flow.settle_media()
                known_sources.update(visible_sources)
                before_sources = set(known_sources)
                before_failures = flow.failure_count()
                prompt = f'{item.prompt}\n\n{production_rules(item.ratio)}'
                flow.fill_prompt(prompt)
                record = {
                    'date': date,
                    'attempt': len(records_for_day(state, date)) + 1,
                    'retry': retry,
                    'promptId': item.prompt_id,
                    'prompt': item.prompt,
                    'sourceQueue': item.source,
                    'ratio': item.ratio,
                    'mode': 'Flow Agent',
                    'estimatedCredits': PROMPT_COST,
                    'creditsBefore': current_credits,
                    'sourcesBefore': sorted(before_sources),
                    'status': 'submitted',
                    'submittedAt': now(),
                }
                append_record(state, args.state, record)
                flow.submit()
                print(
                    f'FLOW-DAILY {item.prompt_id}: soumis '
                    f'(tentative {retry}, crédits={current_credits})',
                    flush=True,
                )
                result, sources = flow.wait_for_result(
                    before_sources,
                    before_failures,
                    timeout=args.result_timeout,
                )
                record['resolvedAt'] = now()
                record['sources'] = sorted(sources)
                if result == 'success':
                    try:
                        outputs = download_sources(flow, sources, day_dir)
                        record['outputs'] = outputs
                        record['status'] = 'success'
                        known_sources.update(sources)
                        state['projectSources'] = sorted(known_sources)
                        item_success = True
                    except Exception as error:
                        record['status'] = 'download-failed'
                        record['error'] = str(error)
                else:
                    record['status'] = result
                record['creditsAfter'] = flow.credits()
                atomic_json(args.state, state)
                journal(
                    args.journal,
                    'attempt-resolved',
                    date=date,
                    promptId=item.prompt_id,
                    status=record['status'],
                    creditsBefore=record['creditsBefore'],
                    creditsAfter=record['creditsAfter'],
                    outputs=record.get('outputs', []),
                )
                build_contact_sheet(day_dir, records_for_day(state, date))
                if item_success:
                    mark_queue_item(args.queue, item)
                    successes += 1
                    completed.add(item.prompt_id)
                    credits_after = int(record['creditsAfter'])
                    consumed_after = max(0, start_balance - credits_after)
                    remaining_budget = (
                        None
                        if run_budget is None
                        else max(0, run_budget - consumed_after)
                    )
                    target = max(
                        target,
                        compute_run_target(
                            balance=credits_after,
                            successes_today=successes,
                            reserve=args.reserve,
                            budget=remaining_budget,
                            max_plans=args.max_plans,
                        ),
                    )
                    print(
                        f'FLOW-DAILY {item.prompt_id}: OK '
                        f'({successes}/{target}) -> {record["outputs"]}',
                        flush=True,
                    )
                    break
                print(
                    f'FLOW-DAILY {item.prompt_id}: {record["status"]}',
                    flush=True,
                )
                time.sleep(5)

        ending = flow.credits()
        consumed = max(0, start_balance - ending)
        if ending - args.reserve < PROMPT_COST:
            stop_reason = 'solde de crédits insuffisant'
        elif args.max_plans is not None and successes >= args.max_plans:
            stop_reason = 'limite --max-plans atteinte'
        elif run_budget is not None and consumed + PROMPT_COST > run_budget:
            stop_reason = 'budget explicite de cette passe atteint'
        elif successes >= target:
            stop_reason = 'capacité de crédits de cette passe consommée'
        day['lastCredits'] = ending
        day['lastRunSpentCredits'] = consumed
        day['spentCredits'] = int(day.get('spentCredits', 0)) + consumed
        day['successes'] = successes
        day['target'] = target
        day['stopReason'] = stop_reason
        day['finishedAt'] = now()
        atomic_json(args.state, state)
        sheet = build_contact_sheet(day_dir, records_for_day(state, date))
        journal(
            args.journal,
            'run-finished',
            date=date,
            creditsStart=start_balance,
            creditsConsumed=consumed,
            creditsRemaining=ending,
            successes=successes,
            target=target,
            reason=stop_reason,
            contactSheet=str(sheet) if sheet else None,
        )
        print(
            f'FLOW-DAILY terminé : crédits départ={start_balance}, '
            f'consommés={consumed}, restants={ending}, '
            f'plans={successes}/{target}, raison={stop_reason}, planche={sheet}',
            flush=True,
        )
        return 0 if successes >= target else 75


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--queue', type=Path, default=DEFAULT_QUEUE)
    parser.add_argument('--output-root', type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--journal', type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument(
        '--project-url',
        help='Projet Flow à ouvrir avant de traiter la file',
    )
    parser.add_argument(
        '--daily-budget',
        type=int,
        help=(
            'Plafond de crédits pour cette passe. Sans cette option, la passe '
            'consomme le solde disponible jusqu’à la réserve.'
        ),
    )
    parser.add_argument('--reserve', type=int, default=0)
    parser.add_argument('--max-plans', type=int)
    parser.add_argument(
        '--resume',
        action='store_true',
        help=(
            'Reprend le jour courant depuis le solde réel. Ce comportement '
            'est aussi celui par défaut ; l’option explicite documente '
            'l’intention des unités automatisées.'
        ),
    )
    parser.add_argument('--attempts-per-prompt', type=int, default=4)
    parser.add_argument('--result-timeout', type=int, default=RESULT_TIMEOUT_SECONDS)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args(argv)
    for name in (
        'daily_budget',
        'reserve',
        'max_plans',
        'attempts_per_prompt',
        'result_timeout',
    ):
        value = getattr(args, name)
        if value is not None and value < 0:
            parser.error(f'--{name.replace("_", "-")} doit être positif')
    return args


def main() -> None:
    args = parse_args()
    try:
        raise SystemExit(run(args))
    except Exception as error:
        journal(args.journal, 'fatal', error=str(error))
        print(f'FLOW-DAILY FATAL: {error}', file=sys.stderr, flush=True)
        raise


if __name__ == '__main__':
    main()
