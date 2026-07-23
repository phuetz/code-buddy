#!/usr/bin/env python3
"""Director's cut : régénère des plans hero atmosphériques en Veo 3.1 Quality (écrase les IDs cibles).
Le modèle Flow doit être sur Veo Quality (fait). Sauvegarde les Omni Flash en .omni.mp4 avant d'écraser."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import time, os, json, base64, shutil
_cdp = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'cdp-lib.py')
if not _os.path.exists(_cdp): _cdp = '/tmp/cdp-lib.py'
exec(open(_cdp).read().split("if __name__")[0])
SP=WORKDIR
Q=(" Cinématographique, photoréaliste, éclairage soigné, forte profondeur de champ, "
   "grain cinéma, mouvement de caméra lent, aucun texte, 16:9.")
# (dossier_shots, id, prompt)
HERO=[
 # BABEL — techno-thriller, bleu/data
 ('babel-shots','03',"Une cascade de code lumineux vert et bleu qui défile à l'infini dans l'obscurité, données vertigineuses, profondeur de champ."+Q),
 ('babel-shots','20',"Un œil numérique géant fait de code et de lumière qui s'ouvre lentement dans le noir, une intelligence artificielle qui observe, glaçant, bleu électrique."+Q),
 ('babel-shots','04',"Un vaste réseau de nœuds lumineux interconnectés au-dessus d'un planisphère sombre, flux de données mondiales qui pulsent, bleu profond, échelle planétaire."+Q),
 # SŒURS — saga criminelle féminine, noir/or/rouge sang, luxe glacial
 ('soeurs-shots','16',"Une rose rouge sang posée sur un fauteuil de cuir noir dans une pièce obscure et luxueuse, une seule goutte de couleur, minimalisme glacial."+Q),
 ('soeurs-shots','11',"La baie de Naples la nuit vue d'un penthouse, lumières de la ville qui scintillent, la silhouette de dos d'une femme élégante, empire et pouvoir."+Q),
 ('soeurs-shots','10',"Des mains féminines manucurées chargent un pistolet nickelé dans la pénombre, éclat métallique froid, palette rouge sang, tension extrême, macro."+Q),
 # EMPEREURS — saga mafieuse mondiale, doré/sombre
 ('empereurs-shots','03',"Une carte du monde ancienne sur laquelle des points lumineux s'allument un à un et se relient à travers les continents, un empire criminel mondial, ambiance dorée et sombre."+Q),
 ('empereurs-shots','06',"Des lingots d'or empilés dans un coffre sombre, reflets dorés profonds, luxe et pouvoir absolu, clair-obscur, macro."+Q),
 ('empereurs-shots','14',"Un homme en costume, seul, de dos, dans un palais opulent surplombant une ville par une immense baie vitrée, pouvoir et solitude, lumière dorée crépusculaire."+Q),
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
def vids(): return set(json.loads(c.ev("JSON.stringify([...document.querySelectorAll('video')].map(v=>v.currentSrc||v.src).filter(Boolean))") or '[]'))
def errc(): return c.ev("[...document.querySelectorAll('*')].filter(e=>/Une erreur s.est produite|Échec/i.test(e.innerText||'')&&(e.innerText||'').length<40).length") or 0
def fetch(src,out):
    r=c.cmd('Runtime.evaluate',{'expression':
        f"fetch({json.dumps(src)}).then(r=>r.arrayBuffer()).then(b=>{{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}})",
        'awaitPromise':True,'returnByValue':True}, to=180)
    b=(r or {}).get('result',{}).get('result',{}).get('value')
    if b: open(out,'wb').write(base64.b64decode(b)); return True
    return False
done=0
for sd,sid,prompt in HERO:
    out=f'{SP}/{sd}/shot-{sid}.mp4'
    tag=f'{sd}/{sid}'
    if os.path.exists(out.replace('.mp4','.omni.mp4')):
        print(f'{tag}: déjà upgradé',flush=True); done+=1; continue
    try:
        before=vids(); e0=errc()
        click(750,771,0.8); c.cmd('Input.insertText',{'text':prompt}); time.sleep(1); click(1128,814,3)
        new=None; failed=False
        for _ in range(28):
            time.sleep(18)
            try:
                fr=[s for s in vids() if s not in before]
                if fr: new=fr[0]; break
                if errc()>e0: failed=True; break
            except Exception as e: print(f'  poll {str(e)[:25]}'); continue
        if new:
            tmp=f'{SP}/{sd}/_hero-{sid}.mp4'
            if fetch(new,tmp):
                if os.path.exists(out) and not os.path.exists(out.replace('.mp4','.omni.mp4')):
                    shutil.copy(out, out.replace('.mp4','.omni.mp4'))  # backup Omni Flash
                shutil.move(tmp,out); print(f'{tag}: OK',flush=True); done+=1
            else: print(f'{tag}: fetch KO',flush=True)
        elif failed: print(f'{tag}: ECHEC Flow',flush=True)
        else: print(f'{tag}: timeout',flush=True)
    except Exception as e: print(f'{tag}: EXC {str(e)[:40]}',flush=True)
    time.sleep(2)
print('HERO-TERMINE',done,'/',len(HERO),flush=True)
