#!/usr/bin/env python3
"""Pilote idempotent des campagnes Flow/Veo.

Pilote le projet Flow actuellement ouvert dans Brave CDP 9222. Le script :
- refuse de soumettre si un processus HeyGen ou un autre batch Flow est actif ;
- vérifie Veo 3.1 Quality, 8 s, 100 crédits et le ratio demandé ;
- protège un plafond de dépense et une réserve dure depuis le compteur live ;
- télécharge chaque réussite immédiatement ;
- journalise les soumissions avant d'attendre leur résolution ;
- écrit les sidecars Cowork et les planches-contact.

Les identifiants de prompt servent uniquement au journal. Le catalogue final doit
être établi visuellement depuis les planches-contact, pas depuis leur ordre.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any

from flow_veo_campaign_2026_07_28 import CAMPAIGN_QUEUES


SCRIPT_DIR = Path(__file__).resolve().parent
exec((SCRIPT_DIR / 'cdp-lib.py').read_text().split("if __name__")[0])

MISSION = Path('~/.codebuddy/media-video/flow-mission-2026-07-28.json').expanduser()
MAX_ATTEMPTS = 240
EXPECTED_STARTING_CREDITS = 25_000
MAX_CREDITS_TO_SPEND = 20_000
RESERVE_CREDITS = 5_000
CREDITS_PER_ATTEMPT = 100
POLL_SECONDS = 8
TIMEOUT_SECONDS = 12 * 60
FAILURE_GRACE_SECONDS = 105

COMMON_169 = (
    ' Photorealistic cinematic footage, premium natural lighting, subtle film grain, '
    'slow and fluid camera movement, strong depth, no identifiable person, no face, '
    'no brand, no logo, no watermark, no readable text, 16:9, one continuous '
    'eight-second shot with subtle native ambient sound.'
)
COMMON_916_EMPTY = (
    ' Absolutely empty location: no person, no human silhouette, no animal, no vehicle '
    'occupant. Photorealistic premium cinematic footage, elegant natural lighting, '
    'slow and perfectly stable camera movement, no brand, no logo, no watermark, '
    'no readable text, vertical 9:16, one continuous eight-second shot with subtle '
    'native ambient sound.'
)


BROLL: list[tuple[str, str]] = [
    # IA / datacenters / robots / GPU — ai01 was the manually validated retry (b063).
    ('ai02', 'Macro glide across a futuristic GPU compute board, copper heat pipes and tiny blue status lights, shallow depth of field, clean laboratory realism.' + COMMON_169),
    ('ai03', 'A cavernous liquid-cooled supercomputer hall, transparent coolant tubes glowing faintly, symmetrical racks disappearing into mist, slow crane move.' + COMMON_169),
    ('ai04', 'Industrial robotic arms assembling precision microchips in a pristine automated factory at night, sparks reflected on brushed metal, no workers present.' + COMMON_169),
    ('ai05', 'Autonomous warehouse robots moving coordinated shelves through a vast dark logistics center, overhead geometric choreography, machines only.' + COMMON_169),
    ('ai06', 'Extreme macro of a silicon wafer under scanning light, iridescent circuit patterns flowing across its surface, precise semiconductor fabrication mood.' + COMMON_169),
    ('ai07', 'Underwater fiber-optic cables landing in a secure coastal data facility, blue light pulses traveling through transparent strands, documentary realism.' + COMMON_169),
    ('ai08', 'A silent humanoid robot torso without a face behind frosted glass in a robotics laboratory, diagnostic lights waking gradually, restrained and plausible.' + COMMON_169),
    ('ai09', 'Rows of compact edge-computing modules inside a smart-city control cabinet, rack focus between processors and cooling fans, subtle rain outside.' + COMMON_169),
    # Finance / trading / bourse.
    ('fin01', 'Empty institutional trading desk before market open, multiple abstract charts moving across dark monitors, dawn light entering a glass office, no readable figures.' + COMMON_169),
    ('fin02', 'Macro tracking shot over stacks of unbranded metal coins and precision balance scales, cool reflections turning warm as market light shifts.' + COMMON_169),
    ('fin03', 'Aerial night view of a global financial district in rain, glass towers pulsing with abstract data reflections, slow orbit above empty streets.' + COMMON_169),
    ('fin04', 'Mechanical stock exchange ticker machinery represented as elegant rotating metal number drums with all symbols abstract and unreadable, dramatic macro.' + COMMON_169),
    ('fin05', 'Secure bank vault corridor opening toward rows of matte metal safe-deposit boxes, warm low-key light and slow centered push-in, empty.' + COMMON_169),
    ('fin06', 'Abstract red and green market waves reflected in a black glass table, camera skimming the surface like a landscape, no readable chart labels.' + COMMON_169),
    ('fin07', 'High-frequency trading servers in a colocation cage, amber and blue network lights racing in patterns, macro-to-wide rack focus, no humans.' + COMMON_169),
    ('fin08', 'Premium empty boardroom overlooking a European business district at blue hour, translucent financial curves reflected in windows, restrained realism.' + COMMON_169),
    ('fin09', 'Close-up of a fountain pen beside unsigned financial documents and a closed calculator, morning sunlight sweeping across textured paper, no readable words.' + COMMON_169),
    # Santé / labo / hôpital.
    ('health01', 'Pristine empty biomedical laboratory with glassware, microscopes and cold blue daylight, motorized camera slider passing sterile workstations.' + COMMON_169),
    ('health02', 'Macro of cultured cells dividing under a research microscope, organic translucent membranes and gentle bioluminescent color, scientifically plausible.' + COMMON_169),
    ('health03', 'Empty modern hospital corridor at sunrise, soft pools of clean light, automatic doors opening in the distance, calm and reassuring atmosphere.' + COMMON_169),
    ('health04', 'Robotic surgical instruments performing a calibration routine over an empty training platform, precise controlled motion, no patient or staff.' + COMMON_169),
    ('health05', 'Automated pharmacy storage system moving anonymous medicine trays through glass cabinets, clean white architecture, no labels readable.' + COMMON_169),
    ('health06', 'MRI scanner suite prepared and completely empty, cool practical lighting gradually blending with warm daylight, slow symmetrical dolly.' + COMMON_169),
    ('health07', 'DNA strands visualized as physically plausible molecular structures floating in dark fluid, elegant macro cinematography and slow rotation.' + COMMON_169),
    ('health08', 'Glass vials moving through an automated vaccine quality-control line, condensation and laser inspection lights, no branding or legible labels.' + COMMON_169),
    ('health09', 'Premium telemedicine control room with empty ergonomic stations and softly glowing diagnostic interfaces, all data abstract and unreadable.' + COMMON_169),
    # Villes françaises / Paris / bureaux tech.
    ('city01', 'Paris skyline before sunrise seen from a quiet rooftop, zinc roofs catching first gold light, distant Eiffel Tower softened by atmospheric haze, no people.' + COMMON_169),
    ('city02', 'Slow tracking shot through an empty rain-washed Parisian business street at blue hour, Haussmann stone reflected in glass façades, no signage readable.' + COMMON_169),
    ('city03', 'La Défense architecture at dawn, monumental modern towers and geometric plaza completely empty, low mist, slow wide crane movement.' + COMMON_169),
    ('city04', 'Empty premium technology office in Paris with modular desks, plants and panoramic city windows, soft morning light moving across polished concrete.' + COMMON_169),
    ('city05', 'A quiet Lyon riverside at golden hour, historic façades reflected in calm water, slow lateral camera drift, no people or readable signs.' + COMMON_169),
    ('city06', 'Empty cobblestone lane in Strasbourg after summer rain, warm windows and subtle mist, slow stabilized walk-through, no shop names visible.' + COMMON_169),
    ('city07', 'Marseille innovation district facing the Mediterranean at dawn, contemporary offices, sea haze and long shadows, streets completely empty.' + COMMON_169),
    ('city08', 'Interior of an empty French startup meeting room at night, whiteboards deliberately blank, city bokeh outside, elegant restrained dolly.' + COMMON_169),
    ('city09', 'High-speed train gliding through the French countryside viewed from a distant aerial angle, sunrise over fields, no branding visible.' + COMMON_169),
    # Abstrait tech — one slot was reassigned to the successful ai01 retry.
    ('abs01', 'Thousands of luminous particles self-organizing into a neural network in a deep black volume, camera flying gently between connected nodes.' + COMMON_169),
    ('abs02', 'Blue and gold data streams flowing through transparent fiber strands like a digital river, extreme macro with elegant optical caustics.' + COMMON_169),
    ('abs03', 'Abstract software architecture represented by floating glass layers and precise light paths, slow parallax, sophisticated dark studio aesthetic.' + COMMON_169),
    ('abs04', 'A cloud of microscopic metallic cubes assembling and dissolving in synchronized waves, charcoal background, dramatic soft side light.' + COMMON_169),
    ('abs05', 'Quantum interference patterns rippling across a dark reflective surface, controlled rainbow diffraction, scientific and minimal.' + COMMON_169),
    ('abs06', 'A vast three-dimensional network map pulsing through fog, nodes communicating in measured waves, deep blue space and slow orbital camera.' + COMMON_169),
    ('abs07', 'Clean abstract code-like glyphs transformed into physical beams of light inside a glass prism, every symbol intentionally illegible.' + COMMON_169),
    ('abs08', 'Macro journey through a processor architecture imagined as a miniature metallic city, electrical pulses traveling along etched pathways.' + COMMON_169),
]


PLATES: list[tuple[str, str]] = [
    ('plate01', 'Luxury rooftop terrace above Paris at sunset, pale stone, sculptural furniture, warm practical lights, uninterrupted open center space.' + COMMON_916_EMPTY),
    ('plate02', 'Minimal rooftop above a Mediterranean city at blue hour, infinity edge, linen curtains moving softly, clear central performance area.' + COMMON_916_EMPTY),
    ('plate03', 'Secluded Atlantic beach at golden hour, smooth wet sand, gentle waves, dune grass moving in the breeze, clean horizon.' + COMMON_916_EMPTY),
    ('plate04', 'Quiet Côte d’Azur cove just after sunrise, turquoise water and warm limestone, pristine shore with generous foreground space.' + COMMON_916_EMPTY),
    ('plate05', 'Elegant Parisian café interior before opening, marble tables, bentwood chairs, soft window light, wide clear aisle.' + COMMON_916_EMPTY),
    ('plate06', 'Contemporary Scandinavian café with pale oak and plants during a rainy morning, empty counter and uncluttered center frame.' + COMMON_916_EMPTY),
    ('plate07', 'Narrow European old-town lane at dawn, warm stucco, cobblestones and subtle mist, symmetrical empty depth.' + COMMON_916_EMPTY),
    ('plate08', 'Quiet Lisbon-inspired tiled alley in late-afternoon light, balconies and soft shadows, no signs, unobstructed center.' + COMMON_916_EMPTY),
    ('plate09', 'Premium contemporary living room with travertine, cream boucle furniture and large garden windows, ample empty standing space.' + COMMON_916_EMPTY),
    ('plate10', 'High-end loft interior with warm brick, steel windows and soft sunset light, minimal furniture pushed to the edges.' + COMMON_916_EMPTY),
    ('plate11', 'Architect-designed kitchen in warm walnut and pale stone, early morning side light, immaculate surfaces and clear floor area.' + COMMON_916_EMPTY),
    ('plate12', 'Boutique hotel lobby with sculptural staircase, muted earth palette and indirect lighting, completely clear central axis.' + COMMON_916_EMPTY),
    ('plate13', 'Private rooftop garden in a European capital at sunrise, grasses moving gently, stone path and distant skyline bokeh.' + COMMON_916_EMPTY),
    ('plate14', 'Beach club terrace after closing at golden hour, neutral umbrellas folded, ocean beyond, premium quiet atmosphere.' + COMMON_916_EMPTY),
    ('plate15', 'French countryside courtyard with pale stone walls and olive trees at dusk, warm lanterns and empty open center.' + COMMON_916_EMPTY),
    ('plate16', 'Minimal art gallery with curved white walls and one abstract stone sculpture, soft skylight, clean vertical depth.' + COMMON_916_EMPTY),
    ('plate17', 'Elegant home office overlooking a rainy European skyline, walnut desk to one side and open foreground, moody premium light.' + COMMON_916_EMPTY),
    ('plate18', 'Modern greenhouse lounge with lush plants and glass ceiling after rain, light mist and clear tiled center path.' + COMMON_916_EMPTY),
    ('plate19', 'Quiet luxury spa corridor in limestone and warm indirect light, shallow reflecting pool, perfectly empty and symmetrical.' + COMMON_916_EMPTY),
    ('plate20', 'Penthouse dining room at twilight, sculptural pendant lights, panoramic city view, refined neutral materials and open foreground.' + COMMON_916_EMPTY),
]


HERO_BABEL: list[tuple[str, str]] = [
    ('babel01', 'A transatlantic undersea fiber-optic cable seen in a dark ocean trench, pulses of cold blue light racing toward the horizon as the camera descends beside it, ominous global scale.' + COMMON_169),
    ('babel02', 'Extreme macro inside a crystalline photonic processor, coherent light splitting through microscopic channels and suddenly synchronizing into one powerful signal, credible near-future technology.' + COMMON_169),
    ('babel03', 'A silent empty world network operations room during a cascading anomaly, hundreds of abstract screens dimming in a wave from foreground to background, tense slow push-in.' + COMMON_169),
    ('babel04', 'A city at night viewed through rain-streaked glass as every window light subtly pulses in the same rhythm, unsettling coordination, deep cyan and amber palette.' + COMMON_169),
    ('babel05', 'An enormous spherical data archive suspended in a black research chamber, fine luminous threads converging on its surface until it appears to awaken, restrained techno-thriller realism.' + COMMON_169),
]


HERO_KEPLER: list[tuple[str, str]] = [
    ('kepler01', 'A tidal-locked exoplanet from low orbit, permanent sunset dividing frozen night from incandescent desert day, immense atmospheric storms along the terminator.' + COMMON_169),
    ('kepler02', 'A deep-space probe slingshotting past a blue gas giant, camera holding close as rings and lightning fill the background, physically grounded scale and motion.' + COMMON_169),
    ('kepler03', 'Interior of an empty orbital observatory, a segmented telescope aperture slowly opens to reveal a gravitationally lensed star field, dark bronze and violet palette.' + COMMON_169),
    ('kepler04', 'A colossal alien megastructure partially eclipsing a distant star, thin geometric panels unfolding with glacial precision, no familiar architecture, awe and dread.' + COMMON_169),
    ('kepler05', 'A rotating black hole accretion disk bending starlight into a complete luminous ring while a tiny unmanned spacecraft crosses the foreground, scientifically inspired cinematic realism.' + COMMON_169),
]

HERO_PATIENT_ZERO: list[tuple[str, str]] = [
    (
        'patient01',
        'Inside a cramped sealed negative-pressure biocontainment laboratory deep underground, '
        'dense stainless-steel benches, translucent containment curtains and dormant robotic '
        'instruments press in around a single red warning beacon; cold cyan practical light, '
        'faint condensation, a slow claustrophobic dolly through the narrow central aisle.'
        + COMMON_169,
    ),
    (
        'patient02',
        'Extreme macro of one unlabelled cryogenic glass vial held upright in a dark sterile '
        'sample rack, viscous crimson fluid stirring as a delicate red DNA double helix appears '
        'only through optical refraction inside the liquid; frost crystals, laser-thin rim light, '
        'slow controlled orbit, scientifically grounded medical-thriller tension.'
        + COMMON_169,
    ),
    (
        'patient03',
        'A completely deserted European hospital isolation corridor after midnight, empty beds '
        'and sealed plastic airlock doors receding into deep perspective, one red emergency light '
        'pulsing at the far end while cold fluorescent fixtures extinguish sequentially toward '
        'the camera; perfectly centered slow reverse dolly, no person or human silhouette.'
        + COMMON_169,
    ),
    (
        'patient04',
        'Top-down cinematic view of a large physical world map table in a dark epidemiology '
        'operations room, coastlines recognizable but every label absent; a single crimson point '
        'blooms in Europe, then branching red transmission paths and hundreds of dim infection '
        'clusters propagate organically across continents, subtle glass reflections, slow descent.'
        + COMMON_169,
    ),
    (
        'patient05',
        'Moonlit interior of an abandoned Victorian glasshouse known as Le Jardin, ornate iron '
        'ribs, wet panes, overgrown medicinal plants and drifting mist; at the distant end stands '
        'one anonymous human silhouette in a long dark coat, seen only from behind with the face '
        'fully hidden, motionless as red light slowly glows beneath the leaves; elegant slow push-in.'
        + COMMON_169,
    ),
]

RETRY_BROLL: list[tuple[str, str]] = [
    ('rb01', 'A dense wall of next-generation AI accelerator modules being cooled by transparent microfluidic channels, blue liquid moving through copper and glass, slow macro orbit.' + COMMON_169),
    ('rb02', 'Empty Paris financial district at dawn after rain, abstract market light reflected across glass towers and wet pavement, restrained aerial push forward.' + COMMON_169),
    ('rb03', 'Automated medical diagnostics laboratory with robotic sample trays moving through soft white light, pristine and entirely unoccupied.' + COMMON_169),
    ('rb04', 'A vast abstract cloud-computing topology made of translucent glass nodes and gold-blue optical links emerging from darkness, slow cinematic parallax.' + COMMON_169),
    ('rb05', 'Empty French technology campus courtyard at blue hour, timber and glass architecture, subtle server-light reflections, gentle stabilized camera drift.' + COMMON_169),
    ('rb06', 'Macro of an unbranded secure hardware wallet chip and encrypted light pulses crossing microscopic traces, premium dark studio cinematography.' + COMMON_169),
]

RETRY_PLATES: list[tuple[str, str]] = [
    ('rp01', 'Empty premium rooftop lounge above the Mediterranean at sunrise, pale stone, folded linen shades and a wide clean foreground.' + COMMON_916_EMPTY),
    ('rp02', 'Empty European café courtyard after rain, warm plaster walls, olive trees and soft morning reflections, unobstructed center frame.' + COMMON_916_EMPTY),
    ('rp03', 'Empty contemporary penthouse salon with curved cream walls, sculptural furniture at the edges and city twilight beyond.' + COMMON_916_EMPTY),
    ('rp04', 'Empty secluded beach terrace at golden hour, neutral stone, dune grass and a clear ocean horizon, generous central performance space.' + COMMON_916_EMPTY),
    ('rp05', 'Empty old-town European passage at dawn, pale cobblestones, subtle fog and warm window glow, no signs or street furniture in the center.' + COMMON_916_EMPTY),
    ('rp06', 'Empty design hotel suite in warm walnut and limestone, sheer curtains moving in soft afternoon light, clear vertical depth.' + COMMON_916_EMPTY),
]


QUEUES = {
    'broll': (BROLL, '16:9', Path('~/.codebuddy/media-video/broll').expanduser(), 'b', 3),
    'plates': (PLATES, '9:16', Path('~/.codebuddy/media-video/plates-916').expanduser(), 'p', 2),
    'hero-babel': (HERO_BABEL, '16:9', Path('~/Videos/babel-trailer/hero-v2').expanduser(), 'hero-', 2),
    'hero-kepler': (HERO_KEPLER, '16:9', Path('~/Videos/kepler-trailer/hero-v2').expanduser(), 'hero-', 2),
    'hero-patient-zero': (
        HERO_PATIENT_ZERO,
        '16:9',
        Path('~/Videos/patient-zero-trailer/hero-v2').expanduser(),
        'hero-',
        2,
    ),
    'broll-retry': (RETRY_BROLL, '16:9', Path('~/.codebuddy/media-video/broll').expanduser(), 'b', 3),
    'plates-retry': (RETRY_PLATES, '9:16', Path('~/.codebuddy/media-video/plates-916').expanduser(), 'p', 2),
}
QUEUES.update(CAMPAIGN_QUEUES)

MICRO_RESERVES = {
    'hero-patient-zero': 34,
}


def now() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S%z')


def bootstrap_state() -> dict[str, Any]:
    return {
        'mission': 'Flow/Veo Lisa + Ambre 2026-07-28',
        'startingCredits': EXPECTED_STARTING_CREDITS,
        'expectedStartingCredits': EXPECTED_STARTING_CREDITS,
        'maxCreditsToSpend': MAX_CREDITS_TO_SPEND,
        'hardReserveCredits': RESERVE_CREDITS,
        'createdAt': now(),
        'records': [],
    }


def load_state() -> dict[str, Any]:
    if MISSION.exists():
        return json.loads(MISSION.read_text())
    state = bootstrap_state()
    save_state(state)
    return state


def save_state(state: dict[str, Any]) -> None:
    MISSION.parent.mkdir(parents=True, exist_ok=True)
    temp = MISSION.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    temp.replace(MISSION)


def other_browser_batch_active() -> bool:
    own_pid = os.getpid()
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
        if {'heygen-batch.py', 'flow-veo-mission.py'} & script_names:
            return True
    return False


class Flow:
    def __init__(self) -> None:
        tab = get_tab(('labs.google', 'flow'))
        if not tab:
            raise RuntimeError('Aucun projet Flow ouvert dans Brave CDP 9222.')
        self.c = CDP(tab)
        self.c.cmd('Runtime.enable')
        self.c.cmd('Page.enable')

    def js(self, expression: str) -> Any:
        return self.c.ev(expression)

    def click(self, x: float, y: float, wait: float = 0.5) -> None:
        for event_type in ('mousePressed', 'mouseReleased'):
            self.c.cmd('Input.dispatchMouseEvent', {
                'type': event_type,
                'x': x,
                'y': y,
                'button': 'left',
                'clickCount': 1,
            })
        time.sleep(wait)

    def buttons(self) -> list[dict[str, Any]]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('button')]."
            "filter(e=>e.getBoundingClientRect().width>0).map(e=>{"
            "let r=e.getBoundingClientRect();return {"
            "text:(e.innerText||'').trim(),aria:e.getAttribute('aria-label'),"
            "role:e.getAttribute('role'),x:r.x+r.width/2,y:r.y+r.height/2,"
            "width:r.width,height:r.height}}))"
        )
        return json.loads(raw or '[]')

    def click_button(
        self,
        text: str,
        *,
        exact: bool = False,
        role: str | None = None,
        wait: float = 0.6,
    ) -> dict[str, Any]:
        for index, button in enumerate(self.buttons()):
            matches = button['text'] == text if exact else text in button['text']
            if matches and (role is None or button['role'] == role):
                inner_width = float(self.js('window.innerWidth') or 0)
                inner_height = float(self.js('window.innerHeight') or 0)
                in_viewport = (
                    0 <= button['x'] <= inner_width
                    and 0 <= button['y'] <= inner_height
                )
                if in_viewport:
                    self.click(button['x'], button['y'], wait)
                else:
                    # Barre d'en-tête parfois déportée hors du viewport (y<0) :
                    # un clic souris CDP partirait dans le vide et toucherait
                    # un autre élément. Clic DOM direct sur le même index.
                    self.js(
                        "[...document.querySelectorAll('button')]"
                        ".filter(e=>e.getBoundingClientRect().width>0)"
                        f"[{index}].click()"
                    )
                    time.sleep(wait)
                return button
        raise RuntimeError(f'Bouton Flow introuvable : {text}')

    def close_profile(self) -> None:
        for button in self.buttons():
            if button['aria'] == 'Fermer cette fenêtre modale':
                self.click(button['x'], button['y'])
                return

    def press_escape(self) -> None:
        for event_type in ('rawKeyDown', 'keyUp'):
            self.c.cmd('Input.dispatchKeyEvent', {
                'type': event_type,
                'key': 'Escape',
                'code': 'Escape',
                'windowsVirtualKeyCode': 27,
            })
        time.sleep(1.5)

    def recover_project_view(self) -> None:
        # La vue plein écran d'un clip masque la barre d'abonnement (bouton
        # ULTRA) et les contrôles de génération. Échap ramène à la vue projet ;
        # en dernier recours on renavigue vers l'URL racine du projet.
        if any(button['text'] == 'ULTRA' for button in self.buttons()):
            return
        self.press_escape()
        if any(button['text'] == 'ULTRA' for button in self.buttons()):
            return
        url = str(self.js('location.href') or '')
        match = re.match(r'(https://labs\.google/fx/.+?/project/[0-9a-f-]+)', url)
        if match:
            self.c.cmd('Page.navigate', {'url': match.group(1)})
            time.sleep(12)

    def credits(self) -> int:
        # D'autres panneaux Flow peuvent afficher un coût contenant « crédits ».
        # Toujours ouvrir la boîte d'abonnement et cibler sa ligne complète.
        last_error: Exception | None = None
        for round_index in range(3):
            if round_index:
                time.sleep(3 * round_index)
            try:
                self.close_profile()
                self.recover_project_view()
                self.click_button('ULTRA', exact=True, wait=1.0)
            except RuntimeError as error:
                last_error = error
                continue
            for _ in range(6):
                body = self.js('document.body.innerText') or ''
                match = re.search(
                    r'^\s*([0-9][0-9 ]*)\s+Crédits Google\s*Flow\s*$',
                    body,
                    flags=re.MULTILINE,
                )
                if match:
                    value = int(match.group(1).replace(' ', ''))
                    self.close_profile()
                    return value
                time.sleep(0.5)
            last_error = RuntimeError('ligne du compteur absente de la boîte ULTRA')
        raise RuntimeError(f'Compteur de crédits Flow illisible. ({last_error})')

    def ensure_video_controls(self) -> None:
        self.close_profile()
        self.recover_project_view()
        if any(button['text'].startswith('Vidéo ·') for button in self.buttons()):
            return
        # Flow peut rouvrir le compositeur « Agent » sans les contrôles directs
        # de génération. Fermer son panneau latéral puis réactiver son bouton
        # expose le réglage vidéo, sans soumettre de contenu.
        right_edge = float(self.js('window.innerWidth') or 0) * 0.75
        for button in self.buttons():
            if button['text'] == 'arrow_back\nRetour' and button['x'] > right_edge:
                self.click(button['x'], button['y'])
                break
        if not any(button['text'].startswith('Vidéo ·') for button in self.buttons()):
            self.click_button('Agent', exact=True)
        if not any(button['text'].startswith('Vidéo ·') for button in self.buttons()):
            raise RuntimeError('Contrôles de génération vidéo Flow introuvables.')

    def configure(self, ratio: str) -> None:
        self.ensure_video_controls()
        body = self.js('document.body.innerText') or ''
        if 'Veo 3.1 - Quality' not in body or '100\xa0crédits' not in body:
            self.click_button('Vidéo · 8s')
            body = self.js('document.body.innerText') or ''
        if 'Veo 3.1 - Quality' not in body or '100\xa0crédits' not in body:
            raise RuntimeError('Le réglage actif n’est pas Veo 3.1 Quality à 100 crédits.')
        label = 'crop_16_9\n16:9' if ratio == '16:9' else 'crop_9_16\n9:16'
        self.click_button(label, exact=True, role='tab')
        self.click_button('8s', exact=True, role='tab')
        # First click outside dismisses the settings popover; second focuses Slate.
        self.focus_editor()
        self.focus_editor()
        chip = next((b['text'] for b in self.buttons() if b['text'].startswith('Vidéo · 8s')), '')
        expected = 'crop_16_9' if ratio == '16:9' else 'crop_9_16'
        if expected not in chip:
            raise RuntimeError(f'Ratio Flow non confirmé : {chip!r}')

    def focus_editor(self) -> None:
        raw = self.js(
            "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
            "if(!e)return null;let r=e.getBoundingClientRect();"
            "return JSON.stringify([r.x+r.width/3,r.y+r.height/2])})()"
        )
        if not raw:
            raise RuntimeError('Éditeur de prompt Flow introuvable.')
        x, y = json.loads(raw)
        self.click(x, y, 0.25)

    def fill_prompt(self, prompt: str) -> None:
        # Le focus peut être volé entre la sélection et l'insertion (popover,
        # rafraîchissement React) : re-tenter la saisie complète avant d'échouer.
        actual = ''
        for attempt in range(3):
            if attempt:
                time.sleep(2 * attempt)
                self.recover_project_view()
            self.focus_editor()
            self.focus_editor()
            self.c.cmd('Runtime.evaluate', {
                'expression': (
                    "(()=>{let e=document.querySelector('[data-slate-editor=true]');"
                    "e.focus();let r=document.createRange();r.selectNodeContents(e);"
                    "let s=getSelection();s.removeAllRanges();s.addRange(r);return true})()"
                ),
                'returnByValue': True,
            })
            self.c.cmd('Input.insertText', {'text': prompt})
            time.sleep(0.5)
            actual = self.js("document.querySelector('[data-slate-editor=true]').innerText") or ''
            if actual == prompt:
                return
        raise RuntimeError(
            f'Prompt Slate divergent ({len(actual)} caractères au lieu de {len(prompt)}).'
        )

    def videos(self) -> set[str]:
        raw = self.js(
            "JSON.stringify([...document.querySelectorAll('video')]."
            "map(v=>v.currentSrc||v.src).filter(Boolean))"
        )
        return set(json.loads(raw or '[]'))

    def failure_count(self) -> int:
        return int(self.js(
            "[...document.querySelectorAll('*')].filter(e=>"
            "(e.innerText||'').trim()==='Échec').length"
        ) or 0)

    def submit(self) -> None:
        button = self.click_button('arrow_forward\nCréer', exact=True, wait=1.5)
        if button.get('width', 0) <= 0:
            raise RuntimeError('Bouton Créer non visible.')

    def fetch_video(self, source: str, output: Path) -> None:
        expression = (
            f"fetch({json.dumps(source)}).then(async r=>{{"
            "if(!r.ok)throw new Error('HTTP '+r.status);let b=await r.arrayBuffer();"
            "let s='';let u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)"
            "s+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(s)})"
        )
        result = self.c.cmd('Runtime.evaluate', {
            'expression': expression,
            'awaitPromise': True,
            'returnByValue': True,
        }, to=240)
        value = (result or {}).get('result', {}).get('result', {}).get('value')
        if not value:
            raise RuntimeError('Téléchargement CDP vide.')
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_suffix('.tmp')
        temp.write_bytes(base64.b64decode(value))
        if temp.stat().st_size < 100_000:
            temp.unlink(missing_ok=True)
            raise RuntimeError('Vidéo téléchargée anormalement petite.')
        temp.replace(output)


def next_output(directory: Path, prefix: str, width: int) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    numbers = []
    for path in directory.glob(f'{prefix}*.mp4'):
        match = re.fullmatch(rf'{re.escape(prefix)}(\d+)\.mp4', path.name)
        if match:
            numbers.append(int(match.group(1)))
    number = max(numbers, default=0) + 1
    return directory / f'{prefix}{number:0{width}d}.mp4'


def valid_video(path: Path) -> bool:
    result = subprocess.run(
        [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=nw=1:nk=1', str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return result.returncode == 0 and float(result.stdout.strip()) >= 7.5
    except ValueError:
        return False


def write_sidecar(
    output: Path,
    *,
    prompt: str,
    ratio: str,
    category: str,
    prompt_id: str,
    generated_at: str,
) -> Path:
    sidecar = Path(f'{output}.meta.json')
    payload = {
        'prompt': prompt,
        'format': ratio,
        'date': generated_at,
        'model': 'Veo 3.1 - Quality',
        'provider': 'Google Flow',
        'category': category,
        'promptId': prompt_id,
    }
    temp = sidecar.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    temp.replace(sidecar)
    return sidecar


def refresh_budget_state(state: dict[str, Any], live_credits: int) -> None:
    gross = sum(
        int(record.get('estimatedCredits', 0))
        for record in state['records']
        if record.get('status') != 'not-submitted'
    )
    starting = int(state['startingCredits'])
    actual = max(0, starting - live_credits)
    state['submittedCreditsGross'] = gross
    state['actualCreditsSpent'] = actual
    state['refundedCreditsEstimated'] = max(0, gross - actual)
    state['finalCredits'] = live_credits
    state['lastCreditsReadAt'] = now()


def verify_live_budget(state: dict[str, Any], live_credits: int) -> None:
    gross = int(state.get('submittedCreditsGross', 0))
    actual = int(state.get('actualCreditsSpent', 0))
    starting = int(state['startingCredits'])
    expected_floor = starting - gross
    if live_credits < expected_floor:
        raise RuntimeError(
            'ARRÊT BUDGET : solde live inférieur au solde attendu '
            f'({live_credits} < {expected_floor}).'
        )
    if actual + CREDITS_PER_ATTEMPT > MAX_CREDITS_TO_SPEND:
        raise RuntimeError('ARRÊT BUDGET : plafond de 20 000 crédits atteint.')
    if live_credits - CREDITS_PER_ATTEMPT < RESERVE_CREDITS:
        raise RuntimeError(
            'ARRÊT BUDGET : la prochaine génération entamerait la réserve de 5 000 crédits.'
        )


def build_contact_sheet(
    category: str,
    output_dir: Path,
    state: dict[str, Any],
) -> Path | None:
    records = [
        record
        for record in state['records']
        if record.get('category') == category
        and record.get('status') == 'success'
        and record.get('output')
    ]
    if not records:
        return None
    contact_dir = output_dir / '.contact'
    contact_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Path] = []
    for record in records:
        video = Path(record['output'])
        if not video.exists():
            continue
        frame = contact_dir / f'{video.stem}.jpg'
        result = subprocess.run(
            [
                'ffmpeg', '-y', '-v', 'error', '-ss', '0', '-i', str(video),
                '-vf',
                (
                    'scale=320:180:force_original_aspect_ratio=decrease,'
                    'pad=320:180:(ow-iw)/2:(oh-ih)/2:#111111'
                ),
                '-frames:v', '1', str(frame),
            ],
            check=False,
        )
        if result.returncode == 0 and frame.exists():
            frames.append(frame)
    if not frames:
        return None
    sheet = output_dir / f'planche-contact-{category}.jpg'
    command = ['montage']
    for frame in frames:
        command.extend(['-label', frame.stem, str(frame)])
    command.extend([
        '-tile', '8x',
        '-geometry', '320x180+8+24',
        '-background', '#111111',
        '-fill', 'white',
        str(sheet),
    ])
    result = subprocess.run(command, check=False)
    return sheet if result.returncode == 0 and sheet.exists() else None


def run(category: str, limit: int | None) -> None:
    raw_prompts, default_ratio, output_dir, prefix, width = QUEUES[category]
    prompts = [
        (
            prompt_spec[0],
            prompt_spec[1],
            prompt_spec[2] if len(prompt_spec) == 3 else default_ratio,
        )
        for prompt_spec in raw_prompts
    ]
    if limit is not None:
        prompts = prompts[:limit]
    state = load_state()
    completed_ids = {
        record.get('promptId')
        for record in state['records']
        if record.get('category') == category
    }
    prompts = [
        (prompt_id, prompt, ratio)
        for prompt_id, prompt, ratio in prompts
        if prompt_id not in completed_ids
    ]
    flow = Flow()
    live_credits = flow.credits()
    if not state['records'] and not state.get('observedStartingCredits'):
        state['observedStartingCredits'] = live_credits
        if live_credits < EXPECTED_STARTING_CREDITS:
            state['stopReason'] = (
                f'solde initial inférieur à l’attendu: '
                f'{live_credits} < {EXPECTED_STARTING_CREDITS}'
            )
            save_state(state)
            raise RuntimeError(
                'ARRÊT BUDGET : solde Flow initial inférieur aux 25 000 crédits attendus '
                f'({live_credits}).'
            )
        state['startingCredits'] = live_credits
    refresh_budget_state(state, live_credits)
    save_state(state)
    print(f'CREDITS-DEPART {live_credits}', flush=True)
    current_ratio: str | None = None

    for prompt_id, prompt, ratio in prompts:
        if other_browser_batch_active():
            raise RuntimeError('ARRÊT GARDE-FOU : un autre batch navigateur est actif.')
        attempt = len(state['records']) + 1
        if attempt > MAX_ATTEMPTS:
            print('BUDGET-STOP: plafond de sécurité des soumissions atteint.', flush=True)
            break
        live_credits = flow.credits()
        refresh_budget_state(state, live_credits)
        save_state(state)
        try:
            verify_live_budget(state, live_credits)
        except RuntimeError as error:
            state['stopReason'] = str(error)
            save_state(state)
            print(f'BUDGET-STOP: {error}', flush=True)
            break
        print(f'CREDITS-AVANT-{attempt} {live_credits}', flush=True)
        if current_ratio != ratio:
            flow.configure(ratio)
            current_ratio = ratio

        before_videos = flow.videos()
        before_failures = flow.failure_count()
        flow.fill_prompt(prompt)
        flow.submit()
        record = {
            'attempt': attempt,
            'category': category,
            'promptId': prompt_id,
            'status': 'submitted',
            'estimatedCredits': CREDITS_PER_ATTEMPT,
            'submittedAt': now(),
            'ratio': ratio,
            'model': 'Veo 3.1 - Quality',
            'prompt': prompt,
        }
        state['records'].append(record)
        refresh_budget_state(state, live_credits)
        save_state(state)
        print(f'{category}/{prompt_id}: SOUMIS tentative={attempt}', flush=True)

        deadline = time.monotonic() + TIMEOUT_SECONDS
        source: str | None = None
        while time.monotonic() < deadline:
            time.sleep(POLL_SECONDS)
            new_videos = flow.videos() - before_videos
            if new_videos:
                source = sorted(new_videos)[0]
                break
            if flow.failure_count() > before_failures:
                # Flow exposes a transient "Échec" before some successful media
                # land asynchronously. Keep the attempt cold for a full grace
                # window instead of misclassifying and immediately hammering retry.
                failure_seen_at = time.monotonic()
                while time.monotonic() - failure_seen_at < FAILURE_GRACE_SECONDS:
                    time.sleep(POLL_SECONDS)
                    new_videos = flow.videos() - before_videos
                    if new_videos:
                        source = sorted(new_videos)[0]
                        break
                break

        if source:
            output = next_output(output_dir, prefix, width)
            try:
                flow.fetch_video(source, output)
                if not valid_video(output):
                    raise RuntimeError('ffprobe n’a pas validé une durée de huit secondes.')
                resolved_at = now()
                sidecar = write_sidecar(
                    output,
                    prompt=prompt,
                    ratio=ratio,
                    category=category,
                    prompt_id=prompt_id,
                    generated_at=resolved_at,
                )
                record['status'] = 'success'
                record['source'] = source
                record['output'] = str(output)
                record['sidecar'] = str(sidecar)
                record['resolvedAt'] = resolved_at
                print(f'{category}/{prompt_id}: OK -> {output}', flush=True)
            except Exception as error:
                record['status'] = 'download-failed'
                record['error'] = str(error)
                print(f'{category}/{prompt_id}: DOWNLOAD-FAIL {error}', flush=True)
        elif flow.failure_count() > before_failures:
            record['status'] = 'failed'
            print(f'{category}/{prompt_id}: ECHEC-FLOW', flush=True)
        else:
            record['status'] = 'timeout'
            print(f'{category}/{prompt_id}: TIMEOUT', flush=True)
        record.setdefault('resolvedAt', now())
        save_state(state)

        live_credits = flow.credits()
        refresh_budget_state(state, live_credits)
        record['creditsAfter'] = live_credits
        save_state(state)
        print(f'CREDITS-APRES-{attempt} {live_credits}', flush=True)
        time.sleep(3)

    sheet = build_contact_sheet(category, output_dir, state)
    if sheet:
        state.setdefault('contactSheets', {})[category] = str(sheet)
    live_credits = flow.credits()
    refresh_budget_state(state, live_credits)
    save_state(state)
    successes = sum(
        record.get('status') == 'success'
        for record in state['records']
        if record.get('category') == category
    )
    attempts = sum(
        record.get('category') == category
        for record in state['records']
    )
    print(
        f'LOT-TERMINE {category}: {successes} succès / {attempts} soumissions, '
        f'crédits={live_credits}, planche={sheet}',
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('category', choices=QUEUES)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    run(args.category, args.limit)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FATAL: {error}', file=sys.stderr, flush=True)
        raise
