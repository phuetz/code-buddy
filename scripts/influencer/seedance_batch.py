#!/usr/bin/env python3
"""Pilote batch Dreamina / Seedance 2.5 via CDP (Brave port 9222).
Usage: python3 seedance_batch.py jobs.json
jobs.json = [{"name":"grece-santorin","prompt":"...","ratio":"9:16","duration":"5s"}, ...]
Sortie: ~/.codebuddy/personas/ambre/seedance/<name>.mp4  (+ .txt du prompt)
Robuste: cible les éléments par TEXTE via le DOM, gère la modale de consentement,
filtre l'animation de chargement, attend la vraie sortie CDN, télécharge, sonde ffprobe.
"""
import json, urllib.request, os, sys, time, subprocess

sys.path.insert(0, os.path.expanduser('~/code-buddy/scripts/influencer'))
cdp = __import__('cdp-lib')

OUT = os.path.expanduser("~/.codebuddy/personas/ambre/seedance")
os.makedirs(OUT, exist_ok=True)
BAD = ('capcutstatic', 'loading', 'animation', 'static/media')  # placeholders à ignorer
GEN_BTN = (2123, 1186)      # bouton ↑ générer (device px, viewport large ~3438)
PROMPT_FIELD = (1799, 1072) # champ contenteditable

def conn():
    tabs = json.load(urllib.request.urlopen('http://localhost:9222/json'))
    tab = next(t for t in tabs if t.get('type') == 'page' and 'dreamina' in t.get('url', '').lower())
    c = cdp.CDP(tab); c.cmd('Page.enable'); c.cmd('Runtime.enable')
    return c

def click(c, x, y):
    for t in ('mousePressed', 'mouseReleased'):
        c.cmd('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}); time.sleep(0.07)
    time.sleep(0.15)

def find_text(c, txt, ymin=0, ymax=99999):
    """Coords du centre d'un élément feuille dont le texte == txt (dans une bande y)."""
    js = r"""(()=>{const T=%s,YM=%d,YX=%d;
      for(const e of document.querySelectorAll('*')){
        if(e.children.length)continue;
        if((e.textContent||'').trim()!==T)continue;
        const r=e.getBoundingClientRect(); if(r.width<3)continue;
        if(r.y<YM||r.y>YX)continue;
        return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
      } return 'null';})()""" % (json.dumps(txt), ymin, ymax)
    r = c.ev(js)
    return None if r in (None, 'null') else json.loads(r)

def esc(c):
    for t in ('keyDown', 'keyUp'):
        c.cmd('Input.dispatchKeyEvent', {'type': t, 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27})

def real_vids(c):
    js = r"""(()=>{const v=[...document.querySelectorAll('video')].map(x=>x.currentSrc||x.src).filter(s=>s&&s.startsWith('http')&&!s.includes('blob'));return JSON.stringify([...new Set(v)]);})()"""
    return [u for u in json.loads(c.ev(js)) if not any(b in u for b in BAD)]

def set_ratio(c, ratio):
    """Change le ratio si nécessaire (16:9 <-> 9:16 ...)."""
    # état courant affiché dans la barre du bas
    cur = c.ev(r"""(()=>{const m=document.body.innerText.match(/\b(16:9|9:16|1:1|4:3|3:4|21:9)\b/);return m?m[1]:'';})()""")
    if cur == ratio:
        return True
    # ouvrir le sélecteur ratio (puce en bas de barre, y>1100)
    chip = find_text(c, cur or '16:9', ymin=1100)
    if not chip:
        return False
    click(c, chip['x'], chip['y']); time.sleep(1.0)
    opt = find_text(c, ratio)  # option dans le menu déroulé
    if not opt:
        esc(c); return False
    click(c, opt['x'], opt['y']); time.sleep(0.6)
    esc(c)
    return True

def set_prompt(c, prompt):
    click(c, *PROMPT_FIELD); time.sleep(0.3)
    # select-all + delete
    for k, code, vk in (('a', 'KeyA', 65),):
        c.cmd('Input.dispatchKeyEvent', {'type': 'keyDown', 'modifiers': 2, 'key': k, 'code': code, 'windowsVirtualKeyCode': vk})
        c.cmd('Input.dispatchKeyEvent', {'type': 'keyUp', 'modifiers': 2, 'key': k, 'code': code, 'windowsVirtualKeyCode': vk})
    time.sleep(0.15)
    for t in ('keyDown', 'keyUp'):
        c.cmd('Input.dispatchKeyEvent', {'type': t, 'key': 'Delete', 'code': 'Delete', 'windowsVirtualKeyCode': 46})
    time.sleep(0.15)
    c.cmd('Input.insertText', {'text': prompt}); time.sleep(0.8)

def find_generate_button(c):
    """Bouton ↑ = élément cliquable le plus à droite de la barre du bas (se déplace si une réf est attachée)."""
    js = r"""(()=>{let best=null;
      for(const e of document.querySelectorAll('button,[role=button],div[class*=button],svg')){
        const r=e.getBoundingClientRect();
        if(r.y>1150&&r.y<1220&&r.width>=24&&r.width<=64&&r.height>=24&&r.height<=64&&r.x>1500){
          if(!best||r.x>best.x) best={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
        }
      } return best?JSON.stringify(best):'null';})()"""
    r = c.ev(js)
    return None if r == 'null' else json.loads(r)

def set_reference(c, image_path):
    """Attache une image de référence (image-to-video) via setFileInputFiles sur l'input caché."""
    c.cmd('DOM.enable')
    root = c.cmd('DOM.getDocument', {'depth': -1})['result']['root']['nodeId']
    nid = c.cmd('DOM.querySelector', {'nodeId': root, 'selector': 'input[type=file]'})['result']['nodeId']
    if not nid:
        return False
    c.cmd('DOM.setFileInputFiles', {'files': [image_path], 'nodeId': nid}); time.sleep(6)
    return True

def clear_references(c):
    """Retire toutes les miniatures de référence attachées (bouton × au survol, ou icônes de suppression)."""
    for _ in range(6):
        js = r"""(()=>{
          for(const e of document.querySelectorAll('[class*=close],[class*=delete],[class*=remove],svg')){
            const r=e.getBoundingClientRect();
            if(r.y>1020&&r.y<1180&&r.x<1000&&r.width>6&&r.width<28){return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});}
          } return 'null';})()"""
        r = c.ev(js)
        if r == 'null':
            break
        d = json.loads(r); click(c, d['x'], d['y']); time.sleep(0.4)

def generate_and_confirm(c):
    btn = find_generate_button(c) or {'x': GEN_BTN[0], 'y': GEN_BTN[1]}
    click(c, btn['x'], btn['y']); time.sleep(3)
    # modale de consentement "Before you continue" -> Confirm
    conf = find_text(c, 'Confirm')
    if conf:
        click(c, conf['x'], conf['y']); time.sleep(3)

def wait_download(c, name, timeout_s=420):
    baseline = set(real_vids(c))
    t0 = time.time(); url = None
    while time.time() - t0 < timeout_s:
        time.sleep(9)
        fresh = [u for u in real_vids(c) if u not in baseline]
        prog = c.ev(r"""(()=>{const m=document.body.innerText.match(/(failed|error|\d{1,3}%)/i);return m?m[0]:'';})()""")
        print(f"    [{name}] fresh={len(fresh)} prog='{prog}'", flush=True)
        if 'fail' in prog.lower() or 'error' in prog.lower():
            return None
        if fresh:
            url = fresh[0]; break
    if not url:
        return None
    dest = os.path.join(OUT, f"{name}.mp4")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://dreamina.capcut.com/"})
    open(dest, "wb").write(urllib.request.urlopen(req, timeout=180).read())
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height,codec_type",
                           "-show_entries", "format=duration", "-of", "default=nw=1", dest],
                          capture_output=True, text=True).stdout.replace("\n", " ")
    print(f"    -> {dest} ({os.path.getsize(dest)//1024} Ko) {info.strip()}", flush=True)
    return dest

def pex_download(query, orientation='landscape'):
    """Télécharge une photo Pexels HD pour la requête, renvoie le chemin local (ou None)."""
    key = os.environ.get('PEXELS_API_KEY', '')
    if not key:
        return None
    ua = 'Mozilla/5.0 (AmbreBot)'
    u = 'https://api.pexels.com/v1/search?' + urllib.parse.urlencode(
        {'query': query, 'per_page': 10, 'orientation': orientation})
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'Authorization': key, 'User-Agent': ua}), timeout=30))
        p = d['photos'][0]
        src = p['src'].get('large2x') or p['src'].get('original')
        path = os.path.join(OUT, '_ref_' + ''.join(ch if ch.isalnum() else '-' for ch in query.lower())[:40] + '.jpg')
        open(path, 'wb').write(urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': ua}), timeout=60).read())
        return path
    except Exception as e:
        print('  pexels err', e); return None

def main():
    jobs = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
    c = conn(); esc(c); done = []
    for j in jobs:
        name = j['name']; dest = os.path.join(OUT, f"{name}.mp4")
        if os.path.exists(dest) and os.path.getsize(dest) > 100000:
            print(f"[{name}] déjà fait, skip", flush=True); done.append(dest); continue
        print(f"[{name}] ratio={j.get('ratio','16:9')} ref={j.get('ref') or j.get('ref_pexels') or '-'} ...", flush=True)
        if j.get('ratio'):
            set_ratio(c, j['ratio'])
        # référence image (image-to-video) : chemin direct ou requête Pexels
        clear_references(c)
        ref = j.get('ref')
        if not ref and j.get('ref_pexels'):
            ref = pex_download(j['ref_pexels'], 'portrait' if j.get('ratio') == '9:16' else 'landscape')
        if ref and os.path.exists(ref):
            set_reference(c, ref)
        set_prompt(c, j['prompt'])
        generate_and_confirm(c)
        r = wait_download(c, name)
        if r:
            open(os.path.join(OUT, f"{name}.txt"), "w").write(j['prompt'])
            done.append(r)
        else:
            print(f"[{name}] ÉCHEC / timeout", flush=True)
        time.sleep(2)
    print(f"\n=== TERMINÉ : {len(done)}/{len(jobs)} clips ===")
    for d in done:
        print(" ", d)

if __name__ == '__main__':
    main()
