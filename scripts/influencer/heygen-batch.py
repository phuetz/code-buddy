#!/usr/bin/env python3
"""Batch HeyGen Avatar Shots (mode Presenter) via CDP — procédure prouvée vague-2.

Pré-requis :
- Brave/Chrome avec --remote-debugging-port=9222, session HeyGen connectée
  (VÉRIFIER la connexion d'abord ; ne JAMAIS tenter de login automatique).
- Le look presenter voulu (casual Lisa) déjà sélectionné dans l'interface —
  sinon : clic portrait presenter -> Choose Avatar -> tuile Lisa -> tuile look
  (les vignettes 3:4 mettent ~30 s à apparaître).
- cdp-lib.py accessible (repo code-buddy scripts/influencer/).

Usage:
  python3 heygen-batch.py submit <audio.mp3> [nom]   # soumet 1 génération
  python3 heygen-batch.py collect <dossier_sortie>   # collecte les <video> de Recent Creations
  python3 heygen-batch.py status                     # texte de la page (is generating…)

⚠️ PIÈGE MAJEUR prouvé : l'ordre de FIN de génération ≠ ordre de soumission.
Après collect, TOUJOURS contrôler par transcription (faster-whisper small/int8
sur les ~8 premières secondes) et matcher aux scripts par mots-clés avant de
renommer. Ne jamais se fier à l'ordre des tuiles.

Étapes submit (coordonnées vérifiées 2026-07-24, re-screenshotter si doute) :
1. Page.navigate https://app.heygen.com/avatar/avatar-shots (l'URL
   avatar-shots?mode=presenter renvoie un 404 — l'onglet Presenter est le défaut)
2. clic lien « upload/record » (~765,233 dans la zone VIDEO SCRIPT)
3. DOM.setFileInputFiles sur l'input[type=file] caché avec le mp3
4. clic « Add audio » (coordonnée lue en live dans le dialogue)
5. submit = bouton « Generate » OU la flèche ↑ ronde (après la 1re soumission,
   le bouton texte disparaît) — fallback par position x>1260, y≈370-415
6. attendre que « is generating » apparaisse dans le body
"""
import sys, os, time, base64, json, re, shutil

sys.path.insert(0, os.path.expanduser('~/code-buddy/scripts/influencer'))
cdp = __import__('cdp-lib')

WORK = os.path.expanduser('~/.codebuddy/influencer-work')
os.makedirs(WORK, exist_ok=True)
PAGE = 'https://app.heygen.com/avatar/avatar-shots'


def connect():
    tab = cdp.get_tab(match=('heygen',))
    if not tab:
        sys.exit("Pas d'onglet HeyGen ouvert dans le Brave CDP (9222).")
    c = cdp.CDP(tab)
    c.cmd('Runtime.enable'); c.cmd('Page.enable'); c.cmd('DOM.enable')
    return c


def click(c, x, y, wait=2.0):
    for t in ('mousePressed', 'mouseReleased'):
        c.cmd('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y,
                                           'button': 'left', 'clickCount': 1})
    time.sleep(wait)


def shot(c, name):
    r = c.cmd('Page.captureScreenshot', {'format': 'jpeg', 'quality': 60}, to=30)
    p = f'{WORK}/{name}.jpg'
    open(p, 'wb').write(base64.b64decode(r['result']['data']))
    return p


def find_button(c, pattern):
    """Retourne (x, y, texte) du 1er bouton/lien visible dont le texte matche."""
    js = f"""(()=>{{
      const re = new RegExp({json.dumps(pattern)}, 'i');
      const els=[...document.querySelectorAll('button,[role=button],a,span')];
      for (const e of els) {{
        const t=(e.innerText||e.getAttribute('aria-label')||'');
        const r=e.getBoundingClientRect();
        if (re.test(t) && r.width>4 && r.height>4 && r.y>=0)
          return JSON.stringify({{x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), t:t.slice(0,60)}});
      }}
      return null;
    }})()"""
    v = c.ev(js)
    return json.loads(v) if v else None


def body_text(c):
    return c.ev('document.body.innerText') or ''


def select_resolution(c, target='1080p'):
    """Sélectionne explicitement la résolution avant chaque soumission."""
    js_current = """(()=>{
      const values=new Set(['720p','1080p','4K']);
      const els=[...document.querySelectorAll('div')];
      for (const e of els) {
        const t=(e.innerText||'').trim();
        const r=e.getBoundingClientRect();
        if (values.has(t) && r.width>4 && r.height>4
            && e.className.includes('cursor-pointer'))
          return JSON.stringify({x:Math.round(r.x+r.width/2),
                                 y:Math.round(r.y+r.height/2),t});
      }
      return null;})()"""
    value = c.ev(js_current)
    current = json.loads(value) if value else None
    if current and current['t'] == target:
        print(f'résolution -> {target} (déjà active)')
        return
    if not current:
        sys.exit('sélecteur de résolution HeyGen introuvable')
    click(c, current['x'], current['y'], 1)
    js_target = f"""(()=>{{
      const els=[...document.querySelectorAll('div,span')];
      const matches=els.map(e=>{{
        const r=e.getBoundingClientRect();
        return {{e,t:(e.innerText||'').trim(),x:Math.round(r.x+r.width/2),
                 y:Math.round(r.y+r.height/2),w:r.width,h:r.height}};
      }}).filter(v=>v.t==={json.dumps(target)} && v.w>4 && v.h>4);
      matches.sort((a,b)=>(a.w*a.h)-(b.w*b.h));
      const v=matches[0];
      return v ? JSON.stringify({{x:v.x,y:v.y,t:v.t}}) : null;
    }})()"""
    value = c.ev(js_target)
    choice = json.loads(value) if value else None
    if not choice:
        sys.exit(f'option de résolution {target} introuvable')
    click(c, choice['x'], choice['y'], 1)
    print(f'résolution -> {target}')


def submit(audio_path, name='job'):
    audio_path = os.path.abspath(os.path.expanduser(audio_path))
    assert os.path.exists(audio_path), audio_path
    c = connect()
    if c.ev('location.href') != PAGE or 'upload/record' not in body_text(c):
        c.cmd('Page.navigate', {'url': PAGE})
        time.sleep(12)
    # navigation soft sur la même URL = la position de scroll est conservée
    c.ev('window.scrollTo(0,0)'); time.sleep(1.5)
    shot(c, f'hg-{name}-0-page')
    select_resolution(c, '1080p')

    # 2. upload/record
    b = find_button(c, 'upload/record|upload / record')
    if not b:
        b = {'x': 765, 'y': 233, 't': 'fallback upload/record'}
    print('upload/record ->', b)
    click(c, b['x'], b['y'], 3)
    shot(c, f'hg-{name}-1-upload')

    # Le dialogue 2026 ouvre désormais l'onglet Record Audio par défaut.
    # Basculer explicitement vers Upload Audio avant d'affecter le fichier.
    upload_tab = c.ev("""(()=>{
      const element=[...document.querySelectorAll('[role="dialog"] [role="tab"]')]
        .find(e=>(e.innerText||'').trim()==='Upload Audio');
      if(!element)return false;
      element.click();
      return true;
    })()""")
    if not upload_tab:
        shot(c, f'hg-{name}-ERR-no-upload-tab')
        sys.exit('onglet Upload Audio introuvable')
    time.sleep(2)

    # 3. input file caché. Un nom unique permet de reconnaître sans ambiguïté
    # le nouvel asset dans la liste, puis de le sélectionner.
    extension = os.path.splitext(audio_path)[1] or '.mp3'
    upload_path = os.path.join(WORK, f'{name}{extension}')
    shutil.copyfile(audio_path, upload_path)
    upload_label = os.path.basename(upload_path)
    # HeyGen normalise les tirets du nom d'asset en underscores.
    heygen_label = re.sub(r'[^A-Za-z0-9_.]+', '_', upload_label)
    selected = bool(c.ev(f"""(()=>{{
      const element=[...document.querySelectorAll(
        '[role="dialog"] [role="button"][aria-label]'
      )].find(e=>e.getAttribute('aria-label')==={json.dumps(heygen_label)});
      if(!element)return false;
      element.click();
      return true;
    }})()"""))
    if selected:
        print(f'audio HeyGen en cache -> {heygen_label}')
    for upload_attempt in range(1, 5):
        if selected:
            break
        doc = c.cmd('DOM.getDocument', {'depth': -1})
        root = doc['result']['root']['nodeId']
        q = c.cmd(
            'DOM.querySelectorAll',
            {
                'nodeId': root,
                'selector': '[role="dialog"] input[type=file]',
            },
        )
        nodes = q['result']['nodeIds']
        if not nodes:
            shot(c, f'hg-{name}-ERR-noinput')
            sys.exit('input[type=file] introuvable — voir screenshot')
        c.cmd(
            'DOM.setFileInputFiles',
            {'files': [], 'nodeId': nodes[-1]},
        )
        c.cmd(
            'DOM.setFileInputFiles',
            {'files': [upload_path], 'nodeId': nodes[-1]},
        )
        c.ev(
            """(()=>{
              const input=document.querySelector(
                '[role="dialog"] input[type=file]'
              );
              if(!input)return false;
              input.dispatchEvent(new Event('input',{bubbles:true}));
              input.dispatchEvent(new Event('change',{bubbles:true}));
              return true;
            })()"""
        )
        print(f'upload audio -> tentative {upload_attempt}/4 : {upload_label}')
        attempt_started = time.monotonic()
        attempt_deadline = time.monotonic() + 65
        time.sleep(1)
        while time.monotonic() < attempt_deadline:
            confirm_text = c.ev(
                "document.querySelector('[role=\"dialog\"]')?.innerText"
            ) or ''
            if (
                'Confirm Audio' in confirm_text
                and 'Add audio' in confirm_text
                and heygen_label in confirm_text
            ):
                selected = True
                break
            selected = bool(c.ev(f"""(()=>{{
              const element=[...document.querySelectorAll(
                '[role="dialog"] [role="button"][aria-label]'
              )].find(e=>e.getAttribute('aria-label')==={json.dumps(heygen_label)});
              if(!element)return false;
              element.click();
              return true;
            }})()"""))
            if selected:
                break
            dialog_text = c.ev(
                "document.querySelector('[role=\"dialog\"]')?.innerText"
            ) or ''
            if (
                'Uploading...' not in dialog_text
                and time.monotonic() - attempt_started > 8
            ):
                time.sleep(2)
                break
            time.sleep(2)
        if selected:
            break
        time.sleep(3)
    if not selected:
        shot(c, f'hg-{name}-ERR-upload')
        sys.exit(f'upload audio HeyGen échoué après 4 tentatives : {heygen_label}')
    time.sleep(3)
    shot(c, f'hg-{name}-2-file')

    # 4. L'interface historique utilisait un bouton Add audio. Le flux 2026
    # ferme le dialogue dès que la ligne de l'asset est choisie.
    b = find_button(c, r'^\s*Add audio\s*$')
    if b:
        print('Add audio ->', b)
        click(c, b['x'], b['y'], 4)
    shot(c, f'hg-{name}-3-added')

    # 5. Generate OU flèche ↑ ronde
    b = find_button(c, r'^\s*Generate\s*$')
    if not b:
        js = """(()=>{
          const els=[...document.querySelectorAll('button,[role=button]')];
          for (const e of els) {
            const r=e.getBoundingClientRect();
            if (r.x+r.width/2>1260 && r.y+r.height/2>360 && r.y+r.height/2<420
                && r.width<70 && r.height<70)
              return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),t:'fleche-up'});
          }
          return null;})()"""
        v = c.ev(js)
        b = json.loads(v) if v else {'x': 1301, 'y': 391, 't': 'fleche-up hardcoded'}
    print('submit ->', b)
    click(c, b['x'], b['y'], 6)
    shot(c, f'hg-{name}-4-submitted')

    # 6. attendre "is generating"
    for attempt in range(20):
        txt = body_text(c)
        if re.search(r'is generating|generating', txt, re.I):
            print(f'OK {name}: génération lancée')
            shot(c, f'hg-{name}-5-generating')
            return True
        time.sleep(3)
    shot(c, f'hg-{name}-ERR-notgen')
    print(f'ATTENTION {name}: "is generating" pas vu — vérifier le screenshot')
    return False


def collect(outdir, n=6):
    """Fetch les <video> de Recent Creations en base64 via le contexte page."""
    outdir = os.path.abspath(os.path.expanduser(outdir))
    os.makedirs(outdir, exist_ok=True)
    c = connect()
    c.s.settimeout(200)
    c.cmd('Page.navigate', {'url': PAGE})
    time.sleep(12)
    srcs = c.ev("JSON.stringify([...document.querySelectorAll('video')]"
                ".map(v=>v.currentSrc||v.src).filter(Boolean))") or '[]'
    srcs = json.loads(srcs)
    print(f'{len(srcs)} <video> trouvées')
    got = []
    for i, src in enumerate(srcs[:n]):
        js = f"""(async()=>{{
          const r = await fetch({json.dumps(src)});
          const b = await r.arrayBuffer();
          let s=''; const u=new Uint8Array(b);
          for (let i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
          return btoa(s);
        }})()"""
        r = c.cmd('Runtime.evaluate', {'expression': js, 'awaitPromise': True,
                                       'returnByValue': True}, to=180)
        data = (r or {}).get('result', {}).get('result', {}).get('value')
        if not data:
            print(f'  clip {i}: fetch KO'); continue
        p = f'{outdir}/collected-{i:02d}.mp4'
        open(p, 'wb').write(base64.b64decode(data))
        print(f'  clip {i}: {os.path.getsize(p)} octets -> {p}')
        got.append(p)
    return got


if __name__ == '__main__':
    cmdname = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmdname == 'submit':
        submit(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'job')
    elif cmdname == 'collect':
        collect(sys.argv[2] if len(sys.argv) > 2 else WORK + '/collected',
                int(sys.argv[3]) if len(sys.argv) > 3 else 6)
    elif cmdname == 'status':
        c = connect()
        print(body_text(c)[:1500])
