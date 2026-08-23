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

SCRIPT_DIR = Path(__file__).resolve().parent
# Charge cdp-lib + la classe Flow (tout le module AVANT `def run(`) sans lancer main().
exec((SCRIPT_DIR / 'flow-veo-mission.py').read_text().split('def run(')[0])  # noqa: S102

POLL_SECONDS = 8
TIMEOUT_SECONDS = 20 * 60
SUFFIX = ' No on-screen text, no watermark, no logo. One continuous eight-second shot with subtle native ambient sound.'

# Sélecteur du bouton d'envoi de l'agent Flow (UI 2026 : '<button> arrow_forward Créer', w<80).
_SEND_BTN = ("[...document.querySelectorAll('button')].find(e=>/arrow_forward/.test(e.innerText)"
             "&&/Créer/.test(e.innerText)&&e.getBoundingClientRect().width<80)")


class DomFlow(Flow):  # noqa: F821 (Flow défini par l'exec)
    """UI Flow 2026 (agent) : les clics souris CDP sont ignorés par React et le panneau
    de droite déborde du viewport → tous les clics passent par des événements DOM."""

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

    def show_videos_view(self):
        self.js("(()=>{let b=[...document.querySelectorAll('button')].find(e=>/Afficher les vidéos/.test(e.innerText));if(b){%s}return !!b})()" % self._DISPATCH)
        time.sleep(1.5)

    def card_count(self) -> int:
        # Une carte média = un bouton « play_circle » dans la grille (hors panneau agent/profil).
        return int(self.js("[...document.querySelectorAll('button,[role=button]')].filter(e=>{let r=e.getBoundingClientRect();"
                           "return r.width>0&&/play_circle/.test(e.innerText||'')}).length") or 0)

    def progress_count(self) -> int:
        return int(self.js("[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d{1,3}%$/.test((e.innerText||'').trim())).length") or 0)

    def failure_count(self) -> int:
        # UI agent : chaque carte EN COURS porte un libellé « Échec » (masqué) + un « NN% ».
        # Un vrai échec = un « Échec » SANS pourcentage associé.
        echec = int(self.js("[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.innerText||'').trim()==='Échec').length") or 0)
        return max(0, echec - self.progress_count())

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
    """Envoie le prompt saisi via .click() DOM (le clic souris ne déclenche pas React)."""
    for _ in range(max_wait):
        state = flow.js(f"(()=>{{let b={_SEND_BTN};return b?(b.disabled?'disabled':'ready'):'none'}})()")
        if state == 'ready':
            break
        time.sleep(1)
    res = flow.js(f"(()=>{{let b={_SEND_BTN};if(!b||b.disabled)return 'ko';b.click();return 'ok'}})()")
    if res != 'ok':
        raise RuntimeError(f'envoi agent Flow échoué ({res}).')
    time.sleep(3)
    val = flow.js("(()=>{let e=document.querySelector('[data-slate-editor=true]');return e?e.innerText.trim():''})()") or ''
    # champ revenu au placeholder « Que voulez-vous créer ? » = soumis
    if 'voulez-vous' not in val and len(val) > 40:
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
        flow.show_videos_view()
        before_top = flow.top_card_src() if flow.top_card_ready() else ''
        try:
            if not args.skip_configure:
                flow.configure(ratio)
            flow.fill_prompt(prompt + SUFFIX)
            send_agent(flow)
        except Exception as exc:  # noqa: BLE001
            print(f'[{pid}] ERREUR soumission: {exc}', flush=True)
            continue

        deadline = time.time() + TIMEOUT_SECONDS
        new_src = None
        base_failures = flow.failure_count()
        submitted_seen = False
        while time.time() < deadline:
            time.sleep(POLL_SECONDS)
            ready = flow.top_card_ready()
            if not submitted_seen:
                if not ready:
                    submitted_seen = True  # la nouvelle carte (en cours, sans play) est en haut
                elif time.time() - (deadline - TIMEOUT_SECONDS) > 90:
                    # 90 s sans nouvelle carte en haut : la soumission n'a pas pris
                    print(f'[{pid}] aucune nouvelle carte après soumission.', flush=True)
                    break
                continue
            if flow.failure_count() > base_failures:
                print(f'[{pid}] ÉCHEC signalé par Flow.', flush=True)
                break
            if ready:
                src = flow.top_card_src()
                if src and src != before_top:
                    new_src = src
                    break
            if flow.failure_count() > base_failures:
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
