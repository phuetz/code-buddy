#!/usr/bin/env python3
"""Banque B-roll premium (Veo 3.1 Quality, audio natif) — plans cinéma réutilisables pour le long-format YouTube.
Sortie durable : ~/.codebuddy/media-video/broll/ . Le modèle doit être réglé sur Veo Quality dans Flow (fait)."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import time, os, json, base64
_cdp = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'cdp-lib.py')
if not _os.path.exists(_cdp): _cdp = '/tmp/cdp-lib.py'
exec(open(_cdp).read().split("if __name__")[0])
OUT = os.path.expanduser('~/.codebuddy/media-video/broll')
os.makedirs(OUT, exist_ok=True)
SUF = (" Cinématographique, photoréaliste, éclairage naturel soigné, forte profondeur de champ, "
       "grain cinéma subtil, mouvement de caméra lent et fluide, aucun texte, 16:9.")
SHOTS = [
 # villes
 ('b01',"Skyline de Paris à l'aube dans une brume dorée, la tour Eiffel au loin, vue aérienne lente."),
 ('b02',"Gratte-ciels de New York la nuit sous la pluie, fenêtres illuminées, reflets sur l'asphalte mouillé."),
 ('b03',"Une ruelle européenne pavée la nuit, lampadaires, pluie fine, reflets, atmosphère feutrée."),
 ('b04',"Une mégalopole futuriste sous la pluie, néons bleus et roses, ambiance cyberpunk, vue en plongée."),
 ('b05',"Vue aérienne nocturne d'un échangeur autoroutier, traînées de phares, ville qui pulse."),
 # paysages
 ('b06',"Des dunes de désert à l'aube, le vent soulève le sable, ombres longues, immensité dorée."),
 ('b07',"L'océan qui frappe des falaises sombres dans la brume, lumière dramatique, embruns."),
 ('b08',"Une forêt brumeuse au petit matin, rayons de soleil entre les arbres, atmosphère paisible."),
 ('b09',"Des montagnes enneigées, des nuages qui défilent au-dessus des cimes, grandiose, vent."),
 ('b10',"Un champ de lavande en Provence au coucher du soleil, rangées violettes, lumière chaude."),
 ('b11',"Un orage sur une plaine la nuit, éclairs lointains illuminant les nuages, majestueux."),
 ('b12',"Une aurore boréale verte au-dessus d'un lac gelé, ciel étoilé, reflets sur la glace."),
 # ambiance / livre
 ('b13',"De la pluie qui ruisselle sur une vitre, un intérieur chaleureux et flou en arrière-plan, mélancolie."),
 ('b14',"Une bougie qui vacille dans l'obscurité, la cire qui coule lentement, macro intime."),
 ('b15',"Une vieille bibliothèque, des rayonnages de livres anciens, poussière flottant dans un rai de lumière."),
 ('b16',"Une main qui écrit à la plume sur du papier ancien, l'encre qui coule, gros plan délicat."),
 ('b17',"Les pages d'un vieux livre qui se tournent lentement, lumière chaude, reliure de cuir."),
 ('b18',"Une tasse de café fumante posée près d'un manuscrit sur un bureau en bois, lumière du matin."),
 ('b19',"Une machine à écrire vintage, gros plan des touches frappées une à une, mécanique."),
 ('b20',"Un feu de cheminée qui crépite, braises rougeoyantes, étincelles, gros plan chaleureux."),
 # cosmos / abstrait
 ('b21',"Un champ d'étoiles, lente dérive à travers une nébuleuse colorée, immensité cosmique."),
 ('b22',"Une planète vue depuis l'orbite, un lever de soleil embrase l'atmosphère, silence spatial."),
 ('b23',"Des flux de code lumineux qui défilent à toute vitesse dans le noir, données, bleu électrique."),
 ('b24',"Une double hélice d'ADN qui tourne lentement, lueur bleue, macro scientifique élégante."),
 ('b25',"De l'encre noire qui se diffuse dans de l'eau claire, volutes hypnotiques, macro, fond blanc."),
 ('b26',"Une horloge ancienne, gros plan des rouages en laiton qui tournent, le temps qui passe."),
 # mood premium
 ('b27',"Un manoir gothique dans la brume au crépuscule, des corbeaux s'envolent, silhouettes d'arbres nus."),
 ('b28',"Une salle de marché financière, murs d'écrans lumineux, silhouettes affairées, lumière froide."),
 ('b29',"Un train de nuit qui traverse un paysage sombre, fenêtres éclairées, mouvement, mélancolie."),
 ('b30',"Une silhouette solitaire sur un toit surplombant une ville nocturne illuminée, contemplation."),
 ('b31',"Une carte du monde ancienne éclairée à la bougie, un compas et une loupe, esprit d'exploration."),
 ('b32',"Des vagues de brouillard qui roulent sur une côte rocheuse à l'aube, phare au loin, calme."),
]
c = None
for _a in range(6):
    try:
        c = CDP(get_tab(('labs.google','flow'))); c.cmd('Runtime.enable'); c.cmd('Page.enable'); break
    except Exception as e:
        print(f'CDP retry {_a+1}: {str(e)[:40]}'); time.sleep(5)
if c is None: print('CDP KO'); raise SystemExit(1)
c.cmd('Browser.setDownloadBehavior', {'behavior':'allow','downloadPath':os.path.expanduser('~/Downloads')})
def click(x,y,w=1.0):
    c.cmd('Input.dispatchMouseEvent',{'type':'mousePressed','x':x,'y':y,'button':'left','clickCount':1})
    c.cmd('Input.dispatchMouseEvent',{'type':'mouseReleased','x':x,'y':y,'button':'left','clickCount':1}); time.sleep(w)
def vids(): return set(json.loads(c.ev("JSON.stringify([...document.querySelectorAll('video')].map(v=>v.currentSrc||v.src).filter(Boolean))") or '[]'))
def errc(): return c.ev("[...document.querySelectorAll('*')].filter(e=>/Une erreur s.est produite|Échec/i.test(e.innerText||'')&&(e.innerText||'').length<40).length") or 0
def fetch(src,out):
    r = c.cmd('Runtime.evaluate',{'expression':
        f"fetch({json.dumps(src)}).then(r=>r.arrayBuffer()).then(b=>{{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}})",
        'awaitPromise':True,'returnByValue':True}, to=180)
    b=(r or {}).get('result',{}).get('result',{}).get('value')
    if b: open(out,'wb').write(base64.b64decode(b)); return True
    return False
done=0
for sid,prompt in SHOTS:
    out=f'{OUT}/{sid}.mp4'
    if os.path.exists(out): print(f'{sid}: déjà',flush=True); done+=1; continue
    try:
        before=vids(); e0=errc()
        click(750,771,0.8); c.cmd('Input.insertText',{'text':prompt+SUF}); time.sleep(1); click(1128,814,3)
        new=None; failed=False
        for _ in range(28):   # Veo Quality est plus lent
            time.sleep(18)
            try:
                fr=[s for s in vids() if s not in before]
                if fr: new=fr[0]; break
                if errc()>e0: failed=True; break
            except Exception as e: print(f'  poll {str(e)[:25]}'); continue
        if new and fetch(new,out): print(f'{sid}: OK',flush=True); done+=1
        elif failed: print(f'{sid}: ECHEC Flow',flush=True)
        else: print(f'{sid}: timeout',flush=True)
    except Exception as e: print(f'{sid}: EXC {str(e)[:40]}',flush=True)
    time.sleep(2)
print('BROLL-TERMINE',done,'/',len(SHOTS),flush=True)
