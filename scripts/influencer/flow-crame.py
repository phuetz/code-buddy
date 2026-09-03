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
import time
from pathlib import Path


def looks_like_agent_send_button(inner_text: str, width: float) -> bool:
    """Sélecteur du bouton d'envoi Agent (UI 2026-09).

    Le libellé visible est l'icône Material `arrow_forward` plus un span
    sr-only « Créer ». Un second bouton `add_2 Créer` (w=32 aussi) existe :
    il n'a PAS arrow_forward. Largeur < 80 écarte d'éventuels CTA larges.
    """
    text = inner_text or ''
    return 'arrow_forward' in text and 'Créer' in text and 0 < float(width) < 80


def agent_send_is_ready(*, disabled: bool, aria_disabled: str | None) -> bool:
    """Le bouton Créer n'utilise plus l'attribut HTML `disabled` (sept. 2026).

    React pose `aria-disabled="true"` tant que le modèle Slate est vide.
    `.disabled` reste false — le pilote cliquait un bouton visuellement
    « actif » que l'application ignore (solde inchangé, champ non vidé).
    """
    return (not disabled) and aria_disabled != 'true'

SCRIPT_DIR = Path(__file__).resolve().parent
# Charge cdp-lib + la classe Flow (tout le module AVANT `def run(`) sans lancer main().
exec((SCRIPT_DIR / 'flow-veo-mission.py').read_text().split('def run(')[0])  # noqa: S102

POLL_SECONDS = 8
TIMEOUT_SECONDS = 20 * 60
SUFFIX = ' No on-screen text, no watermark, no logo. One continuous eight-second shot with subtle native ambient sound.'
# Projet Flow du chantier FLOWFIX1. get_tab() prend le premier onglet
# labs.google/flow : si l'onglet a dérivé (Retour / autre projet), on y revient.
FLOW_PROJECT_ID = 'FLOW_PROJECT_ID_REDACTED'
FLOW_PROJECT_URL = (
    'https://labs.google/fx/fr/tools/flow/project/' + FLOW_PROJECT_ID
)

# Sélecteur du bouton d'envoi de l'agent Flow (UI 2026-09 : '<button> arrow_forward Créer', w<80).
# Ne PAS se fier à .disabled : voir agent_send_is_ready().
_SEND_BTN = ("[...document.querySelectorAll('button')].find(e=>/arrow_forward/.test(e.innerText)"
             "&&/Créer/.test(e.innerText)&&e.getBoundingClientRect().width>0"
             "&&e.getBoundingClientRect().width<80)")


class DomFlow(Flow):  # noqa: F821 (Flow défini par l'exec)
    """UI Flow 2026-09 (agent).

    Les clics DOM synthétiques restent utiles pour ULTRA / fermer une boîte
    (hors compositeur). L'envoi du prompt, lui, exige un clic TRUSTED et un
    modèle Slate committé (`aria-disabled=false`) — voir send_agent().
    """

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
        # Boîte ULTRA : bouton « close » juste après l'intitulé du profil.
        self.js("(()=>{let d=[...document.querySelectorAll('[role=dialog],[aria-modal=true]')].pop();"
                "let b=d?[...d.querySelectorAll('button')].find(e=>/^close/.test(e.innerText.trim())||e.getAttribute('aria-label')==='Fermer cette fenêtre modale'):null;"
                "if(!b){b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==='Fermer cette fenêtre modale');}"
                "if(b){%s}return !!b})()" % self._DISPATCH)
        time.sleep(0.5)

    def recover_project_view(self):
        if any(b['text'] == 'ULTRA' for b in self.buttons()):
            return
        super().recover_project_view()

    def ensure_project(self) -> None:
        url = str(self.js('location.href') or '')
        if FLOW_PROJECT_ID in url:
            return
        print(f'WARN: onglet Flow hors projet ({url}) — retour {FLOW_PROJECT_ID}', flush=True)
        self.c.cmd('Page.navigate', {'url': FLOW_PROJECT_URL})
        time.sleep(8)

    def show_videos_view(self):
        self.ensure_project()
        self.js("(()=>{let b=[...document.querySelectorAll('button')].find(e=>/Afficher les vidéos/.test(e.innerText));if(b){%s}return !!b})()" % self._DISPATCH)
        time.sleep(1.5)

    def card_count(self) -> int:
        # Une carte média = un bouton « play_circle » dans la grille (hors panneau agent/profil).
        return int(self.js("[...document.querySelectorAll('button,[role=button]')].filter(e=>{let r=e.getBoundingClientRect();"
                           "return r.width>0&&/play_circle/.test(e.innerText||'')}).length") or 0)

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
            "const eches=[...document.querySelectorAll('*')].filter(e=>"
            "e.children.length===0&&(e.innerText||'').trim()==='Échec');"
            "const pcts=[...document.querySelectorAll('*')].filter(e=>"
            "e.children.length===0&&/^\\\\d{1,3}%$/.test((e.innerText||'').trim()));"
            "let n=0;for(const e of eches){const r=e.getBoundingClientRect();"
            "if(r.width<=0||r.x>vw*0.7)continue;"
            "const near=pcts.some(p=>{const q=p.getBoundingClientRect();"
            "return Math.abs(q.y-r.y)<80&&Math.abs(q.x-r.x)<400});"
            "if(!near)n++;}return n})()"
        ) or 0)

    def top_card_ready(self) -> bool:
        # Grille virtualisée (≈6 cartes rendues) : on ne compte plus les cartes, on regarde la
        # carte du HAUT (la plus récente). Prête ⇔ elle porte un bouton « play_circle » (y < 300).
        return bool(self.js("[...document.querySelectorAll('button,[role=button]')].some(e=>{let r=e.getBoundingClientRect();return r.width>0&&r.y<300&&/play_circle/.test(e.innerText||'')})"))

    def top_card_src(self) -> str:
        # Clic play sur la carte du haut puis premier <video> du DOM (ordre DOM = ordre des cartes).
        self.js("(()=>{let b=[...document.querySelectorAll('button,[role=button]')].find(e=>{let r=e.getBoundingClientRect();return r.width>0&&r.y<300&&/play_circle/.test(e.innerText||'')});if(b){%s}return 1})()" % self._DISPATCH)
        time.sleep(2.5)
        src = self.js("(()=>{let v=document.querySelector('video');return v?(v.currentSrc||v.src||''):''})()") or ''
        self.press_escape()
        return src

    def card_video_srcs(self) -> set:
        # Clique « play » sur chaque carte pour matérialiser son <video>, puis collecte les src.
        self.js("(()=>{for(const b of [...document.querySelectorAll('button,[role=button]')].filter(e=>e.getBoundingClientRect().width>0&&/play_circle/.test(e.innerText||''))){%s}return 1})()" % self._DISPATCH)
        time.sleep(2.5)
        raw = self.js("JSON.stringify([...document.querySelectorAll('video')].map(v=>v.currentSrc||v.src).filter(Boolean))")
        self.press_escape()
        return set(json.loads(raw or '[]'))


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
        val = flow.js("(()=>{let e=document.querySelector('[data-slate-editor=true]');return e?e.innerText.trim():''})()") or ''
        # champ revenu au placeholder « Que voulez-vous créer ? » = soumis
        if 'voulez-vous' in val or len(val) <= 40:
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
    start = flow.credits()
    print(f'CREDITS-DEPART {start}', flush=True)

    done = 0
    for spec in items:
        pid, prompt, ratio = spec['id'], spec['prompt'], spec.get('ratio', '16:9')
        credits = flow.credits()
        if credits - 100 < args.reserve:
            print(f'STOP: solde {credits} entamerait la réserve {args.reserve}.', flush=True)
            break
        out = args.outdir / f'{pid}.mp4'
        if out.exists() and out.stat().st_size > 100_000:
            print(f'[{pid}] déjà téléchargé, saut.', flush=True)
            continue
        print(f'[{pid}] credits={credits} ratio={ratio} — soumission...', flush=True)
        flow.ensure_project()
        flow.show_videos_view()
        before_top = flow.top_card_src() if flow.top_card_ready() else ''
        before_plays = flow.card_count()
        before_videos = flow.videos()
        needle = ' '.join((prompt or '').split()[:8])
        try:
            if not args.skip_configure:
                flow.configure(ratio)
            flow.ensure_project()
            flow.fill_prompt(prompt + SUFFIX)
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
            if FLOW_PROJECT_ID not in str(flow.js('location.href') or ''):
                print(f'[{pid}] onglet a quitté le projet — abandon de cette prise.', flush=True)
                break
            ready = flow.top_card_ready()
            plays = flow.card_count()
            progress = flow.progress_count()
            live_videos = flow.videos()
            body = flow.js('document.body.innerText') or ''
            queued = 'file d\'attente' in body or 'programmée' in body
            elapsed = int(TIMEOUT_SECONDS - (deadline - time.time()))
            print(
                f'[{pid}] t={elapsed}s plays={plays} progress={progress} '
                f'ready={int(ready)} videos={len(live_videos)} queued={int(queued)}',
                flush=True,
            )
            if queued or progress > 0 or plays > before_plays:
                submitted_seen = True
            if (
                not retried_error
                and 'Réessayer' in body
                and progress == 0
                and not queued
            ):
                retry = next(
                    (b for b in flow.buttons() if 'Réessayer' in (b.get('text') or '')),
                    None,
                )
                if retry and retry.get('width', 0) > 0:
                    print(f'[{pid}] Flow a demandé Réessayer — second clic TRUSTED.', flush=True)
                    flow.unlock_ui()
                    flow.click(float(retry['x']), float(retry['y']), 1.5)
                    retried_error = True
                    submitted_seen = True
                    continue
            if not submitted_seen:
                if not ready and plays <= before_plays:
                    submitted_seen = True  # nouvelle carte en cours (sans play) en haut
                elif elapsed > 90:
                    print(f'[{pid}] aucune nouvelle carte après soumission.', flush=True)
                    break
                continue
            if flow.failure_count() > base_failures and progress == 0:
                print(f'[{pid}] ÉCHEC signalé par Flow.', flush=True)
                break
            # Ne JAMAIS prendre un <video> « nouveau » sur un projet déjà
            # peuplé : FLOWFIX1 a téléchargé un clip Lyon préexistant (75 plays)
            # en 8 s. On n'accepte que : une carte play apparue APRÈS, dont le
            # src n'était pas là avant, et dont le prompt de carte colle.
            if plays > before_plays and ready:
                src = flow.top_card_src()
                if src and src not in before_videos and src != before_top:
                    card_text = flow.js('document.body.innerText') or ''
                    if needle and needle[:40].lower() not in card_text.lower():
                        print(f'[{pid}] src nouveau mais prompt carte divergent — on attend.', flush=True)
                    else:
                        new_src = src
                        break
            if progress > 0:
                continue
            if flow.failure_count() > base_failures and progress == 0:
                print(f'[{pid}] ÉCHEC signalé par Flow.', flush=True)
                break

        if not new_src:
            print(f'[{pid}] pas de vidéo (timeout/échec).', flush=True)
            continue
        try:
            flow.fetch_video(new_src, out)
            print(f'[{pid}] OK -> {out}', flush=True)
            done += 1
        except Exception as exc:  # noqa: BLE001
            print(f'[{pid}] vidéo générée, download KO ({exc}) — récup manuelle via ⬇.', flush=True)
            done += 1

    print(f'CREDITS-FIN {flow.credits()} | clips {done}/{len(items)}', flush=True)


if __name__ == '__main__':
    main()
