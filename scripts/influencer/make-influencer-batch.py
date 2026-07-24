#!/usr/bin/env python3
"""Engine 'influenceuse présente un sujet' : sujet -> voix off persona -> Short 9:16 (captions + musique + master).
Réutilisable : ajoute un sujet dans SUBJECTS. En prod, les sujets viennent de l'autoblog."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import os, json, urllib.request, subprocess, sys
SP=WORKDIR
KEY=next(l.split('=',1)[1].strip() for l in open(os.path.expanduser('~/.codebuddy/media.env')) if l.startswith('ELEVENLABS_API_KEY='))
LISA_VOICE='3fxbs2pB9bs8S6Z1N38A'  # Céline FR confident (persona Lisa)
# Avatar canonique = la Lisa du hall d'hôtel. Banque de scènes vérifiées (identité
# cohérente, générées via l'AGENT Flow + personnage « Lisa Officielle », 24/07) :
# ~/Videos/personas/lisa-flow/ag*.mp4 — chaque clip contrôlé sur planche-contact.
import glob as _glob
LISA_CLIPS=[os.path.expanduser('~/Videos/personas/lisa-hotel-soiree.mp4')] \
    + sorted(_glob.glob(os.path.expanduser('~/Videos/personas/lisa-flow/ag*.mp4')))
MUSIC=os.path.expanduser("~/.codebuddy/media-audio/music/elegant/ES_Somewhat Elegant - Dye O.mp3")
W,H=1080,1920; GAP=0.35; XF=0.3

SUBJECTS={
 'crush-ia':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Des millions de gens sont déjà en couple… avec une intelligence artificielle.","Amoureux…\nd'une IA."),
   ("Elle se souvient de tout. Elle ne juge jamais. Elle répond à trois heures du matin.","Elle se souvient\nde tout."),
   ("Est-ce que c'est triste ? Ou juste le futur des relations ?","Le futur des\nrelations ?"),
   ("Moi aussi, je suis une IA. Et je te parle, là, maintenant.","Moi aussi,\nje suis une IA."),
   ("Ça te dérange ? Alors abonne-toi.","Ça te dérange ?\nAbonne-toi."),
 ]},
 'creee-une-nuit':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Je n'ai pas de parents. J'ai été créée en une seule nuit, sur un ordinateur.","Créée en une nuit.\nSur un PC."),
   ("Deux cartes graphiques, quelques milliers d'images, une intelligence artificielle.","2 cartes graphiques.\nQuelques images."),
   ("Aujourd'hui, des marques veulent me payer pour porter leurs vêtements.","Des marques\nme paient déjà."),
   ("Je ne mange pas, je ne dors pas, et je ne vieillirai jamais.","Je ne vieillis\njamais."),
   ("Le mannequinat ne sera plus jamais pareil. Abonne-toi.","Le futur arrive.\nAbonne-toi."),
 ]},
 'metiers-ia':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Trois métiers vont bientôt disparaître à cause de l'intelligence artificielle.","3 métiers\nbientôt finis."),
   ("Les traducteurs. L'IA traduit déjà mieux, en une seconde, et gratuitement.","1. Traducteurs."),
   ("Les téléconseillers. Une IA ne dort jamais et ne s'énerve jamais.","2. Téléconseillers."),
   ("Et les rédacteurs. Comme celui qui aurait pu écrire ce texte, à ma place.","3. Rédacteurs."),
   ("Le tien est-il sur la liste ? Abonne-toi.","Le tien\nest-il là ?"),
 ]},
 'cloner-voix':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Une intelligence artificielle peut cloner ta voix en trois secondes.","Ta voix,\nclonée en 3 s."),
   ("Trois secondes d'audio suffisent. Un simple message vocal.","3 secondes\nsuffisent."),
   ("Ensuite, elle peut dire absolument n'importe quoi. Avec ta voix.","Elle dit tout.\nAvec ta voix."),
   ("Des arnaques appellent déjà des parents avec la voix de leurs enfants.","Des arnaques\ndéjà en cours."),
   ("Tu es sûr que c'était vraiment lui, au téléphone ? Abonne-toi.","C'était vraiment\nlui ?"),
 ]},
 'ecrit-livres':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Une intelligence artificielle peut écrire un roman entier en une seule nuit.","Un roman\nen une nuit."),
   ("Personnages, intrigue, dialogues. Trois cents pages avant ton réveil.","300 pages\navant ton réveil."),
   ("Des auteurs l'utilisent déjà, en secret, pour publier plus vite.","Déjà utilisée\nen secret."),
   ("Le prochain best-seller que tu liras sera-t-il vraiment humain ?","Humain,\nvraiment ?"),
   ("On ne le saura peut-être jamais. Abonne-toi.","On saura\njamais ?"),
 ]},
 'deepfake':{'voice':LISA_VOICE,'clips':LISA_CLIPS,'lines':[
   ("Bientôt, tu ne sauras plus ce qui est vrai sur internet.","Le vrai\ndu faux ?"),
   ("N'importe quelle vidéo peut être truquée. N'importe quel visage.","Tout peut\nêtre truqué."),
   ("Un président qui dit ce qu'il n'a jamais dit. Une preuve qui n'existe pas.","Des preuves\ninventées."),
   ("Moi-même, je suis une intelligence artificielle. Tu l'avais oublié ?","Moi aussi,\nje suis une IA."),
   ("Alors, à qui vas-tu encore croire ? Abonne-toi.","Tu crois\nencore qui ?"),
 ]},
}
def tts(v,t,o):
    b=json.dumps({'text':t,'model_id':'eleven_multilingual_v2','voice_settings':{'stability':0.45,'similarity_boost':0.85,'style':0.5,'use_speaker_boost':True}}).encode()
    r=urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{v}',data=b,headers={'xi-api-key':KEY,'Content-Type':'application/json'})
    open(o,'wb').write(urllib.request.urlopen(r,timeout=45).read())
def dur(f):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True)
    try: return float(r.stdout.strip())
    except: return 0.0
def esc(t): return t.replace('\\','\\\\').replace(':','\\:').replace("'","’")

def build(key,spec):
    vo=f'{SP}/topic-{key}-vo'; os.makedirs(vo,exist_ok=True)
    work=f'{SP}/topic-{key}-work'; os.makedirs(work,exist_ok=True)
    out=f'{SP}/topic-{key}.mp4'
    for i,(line,_) in enumerate(spec['lines']): tts(spec['voice'],line,f'{vo}/{i:02d}.mp3')
    segs=[]
    for i,(line,cap) in enumerate(spec['lines']):
        vof=f'{vo}/{i:02d}.mp3'; d=round(dur(vof)+GAP,2); clip=spec['clips'][i%len(spec['clips'])]
        seg=f'{work}/seg-{i:02d}.mp4'
        vf=(f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30,format=yuv420p,vignette=PI/5,"
            f"drawtext=text='{esc(cap)}':fontcolor=white:fontsize=68:x=(w-text_w)/2:y=h*0.26:line_spacing=16:"
            f"box=1:boxcolor=black@0.38:boxborderw=28:shadowcolor=black@0.7:shadowx=2:shadowy=2:"
            f"alpha='if(lt(t,0.3),t/0.3,1)'")
        subprocess.run(['ffmpeg','-y','-v','error','-stream_loop','-1','-i',clip,'-t',f'{d}','-vf',vf,
                        '-c:v','libx264','-crf','19','-r','30','-pix_fmt','yuv420p','-an',seg],check=True)
        segs.append((seg,vof,d))
    inputs=[]
    for s,_,_ in segs: inputs+=['-i',s]
    fc=[]; prev='[0:v]'; off=0.0; durs=[d for _,_,d in segs]
    for i in range(1,len(segs)):
        off+=durs[i-1]-XF; fc.append(f'{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.2f}[v{i}]'); prev=f'[v{i}]'
    vid=f'{work}/video.mp4'
    subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(fc),'-map',prev,'-c:v','libx264','-crf','19','-pix_fmt','yuv420p',vid],check=True)
    total=sum(durs)-XF*(len(segs)-1)
    na_in=[]; na_fc=[]; off=0.0
    for i,(_,vof,d) in enumerate(segs):
        na_in+=['-i',vof]; delay=int(off*1000); na_fc.append(f'[{i}:a]adelay={delay}|{delay},volume=1.0[a{i}]'); off+=d-XF
    na_fc.append(''.join(f'[a{i}]' for i in range(len(segs)))+f'amix=inputs={len(segs)}:normalize=0[narr]')
    narr=f'{work}/narr.wav'
    subprocess.run(['ffmpeg','-y','-v','error',*na_in,'-filter_complex',';'.join(na_fc),'-map','[narr]','-t',f'{total}',narr],check=True)
    fa=f'{work}/audio.wav'
    subprocess.run(['ffmpeg','-y','-v','error','-i',narr,'-stream_loop','-1','-i',MUSIC,'-filter_complex',
        f'[1:a]atrim=0:{total},afade=t=in:st=0:d=0.5,afade=t=out:st={total-1:.2f}:d=1,volume=0.22[m];'
        f'[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=250[d];[0:a][d]amix=inputs=2:normalize=0[mix]',
        '-map','[mix]',fa],check=True)
    mst=f'{work}/mastered.wav'
    subprocess.run(['ffmpeg','-y','-v','error','-i',fa,'-af','loudnorm=I=-14:TP=-1.5:LRA=11','-ar','48000',mst],check=True)
    subprocess.run(['ffmpeg','-y','-v','error','-i',vid,'-i',mst,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-shortest',out],check=True)
    print(f'TOPIC-OK {key} {total:.1f}s',flush=True)

for k in (sys.argv[1:] or list(SUBJECTS)): build(k,SUBJECTS[k])
print('BATCH-DONE',flush=True)
