#!/usr/bin/env python3
"""Banque de clips Lisa premium via Flow (9:16, personnage Lisa attaché). Modèle/ratio réglés (Veo Quality, 9:16)."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import time, os, json, base64
_cdp = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'cdp-lib.py')
if not _os.path.exists(_cdp): _cdp = '/tmp/cdp-lib.py'
exec(open(_cdp).read().split("if __name__")[0])
OUT=os.path.expanduser('~/Videos/personas/lisa-flow')
os.makedirs(OUT,exist_ok=True)
SUF=(" Elle a de longs cheveux bruns ondulés et une robe élégante. Photoréaliste, cinématographique, "
     "haute couture, éclairage flatteur, forte profondeur de champ, elle regarde la caméra avec un léger sourire, vertical 9:16.")
SCENES=[
 ('sc01',"Lisa marche vers la caméra sur le rooftop d'un bar la nuit, robe de cocktail noire, lumières de la ville derrière, glamour."),
 ('sc02',"Lisa sur le pont d'un yacht au coucher du soleil, robe d'été blanche légère, cheveux au vent, mer scintillante, luxe."),
 ('sc03',"Lisa dans une boutique de mode haut de gamme, elle effleure des vêtements, lumière douce, chic parisien."),
 ('sc04',"Lisa sur un balcon parisien au petit matin, peignoir de soie, une tasse de café à la main, toits de Paris dorés."),
 ('sc05',"Lisa dans une galerie d'art contemporain, tailleur élégant minimaliste, elle contemple une œuvre, raffinement."),
 ('sc06',"Lisa descend d'une berline de luxe le soir devant un palace, robe de soirée, ambiance red carpet floue, glamour."),
 ('sc07',"Lisa sur une terrasse de restaurant méditerranéen au crépuscule, robe estivale fluide, ambiance dolce vita."),
 ('sc08',"Lisa dans un penthouse moderne, loungewear chic beige, immense baie vitrée sur la skyline au soir."),
]
c=None
for _a in range(6):
    try:
        c=CDP(get_tab(('labs.google','flow'))); c.cmd('Runtime.enable'); c.cmd('Page.enable'); break
    except Exception as e: print(f'CDP retry {_a+1}: {str(e)[:40]}'); time.sleep(5)
if c is None: print('CDP KO'); raise SystemExit(1)
c.cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':os.path.expanduser('~/Downloads')})
def click(x,y,w=1.0):
    c.cmd('Input.dispatchMouseEvent',{'type':'mousePressed','x':x,'y':y,'button':'left','clickCount':1})
    c.cmd('Input.dispatchMouseEvent',{'type':'mouseReleased','x':x,'y':y,'button':'left','clickCount':1}); time.sleep(w)
def vids(): return json.loads(c.ev("JSON.stringify([...document.querySelectorAll('video')].map(v=>v.currentSrc||v.src).filter(Boolean))") or '[]')
def newest_matching(before, prompt):
    """Anti-décalage Veo : prend la vidéo la plus récente (1re du DOM) et vérifie
    que le prompt soumis apparaît dans le panneau (sinon on refuse le clip)."""
    cur = vids()
    fresh = [s for s in cur if s not in before]
    if not fresh: return None
    top = cur[0]                     # 1re du DOM = tuile la plus récente
    if top not in fresh: return None # la plus récente n'est pas nouvelle -> retard d'un ancien job
    frag = prompt[:38].replace("'", "’")
    seen = c.ev(f"document.body.innerText.includes({json.dumps(frag)})")
    return top if seen else None
def errc(): return c.ev("[...document.querySelectorAll('*')].filter(e=>/Une erreur s.est produite|Échec/i.test(e.innerText||'')&&(e.innerText||'').length<40).length") or 0
def fetch(src,out):
    r=c.cmd('Runtime.evaluate',{'expression':
        f"fetch({json.dumps(src)}).then(r=>r.arrayBuffer()).then(b=>{{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}})",
        'awaitPromise':True,'returnByValue':True}, to=180)
    b=(r or {}).get('result',{}).get('result',{}).get('value')
    if b: open(out,'wb').write(base64.b64decode(b)); return True
    return False
def attach_lisa():
    click(577,814,1.1)   # + (ouvrir picker)
    click(534,375,1.0)   # onglet Personnages
    click(724,234,1.0)   # sélectionner Lisa HD
    click(1038,700,1.2)  # Ajouter au prompt
done=0
for sid,prompt in SCENES:
    out=f'{OUT}/{sid}.mp4'
    if os.path.exists(out): print(f'{sid}: déjà',flush=True); done+=1; continue
    try:
        before=set(vids()); e0=errc()
        attach_lisa()
        click(700,772,0.6); c.cmd('Input.insertText',{'text':prompt+SUF}); time.sleep(1.2)
        click(1128,814,3)  # submit
        new=None; failed=False
        for _ in range(28):
            time.sleep(18)
            try:
                new=newest_matching(before, prompt)
                if new: break
                if errc()>e0: failed=True; break
            except Exception as e: print(f'  poll {str(e)[:25]}'); continue
        if new and fetch(new,out): print(f'{sid}: OK',flush=True); done+=1
        elif failed: print(f'{sid}: ECHEC Flow',flush=True)
        else: print(f'{sid}: timeout',flush=True)
    except Exception as e: print(f'{sid}: EXC {str(e)[:50]}',flush=True)
    time.sleep(2)
print('LISA-CLIPS-TERMINE',done,'/',len(SCENES),flush=True)
