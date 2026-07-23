#!/usr/bin/env python3
"""Short 'influenceuse présente un sujet' : clips persona + voix off timée + captions TikTok + musique + master -14 LUFS."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import os, subprocess
SP=WORKDIR
VO=f'{SP}/lisa-topic-vo'
CLIPS=[os.path.expanduser('~/Videos/personas/lisa3004-cafe.mp4'),
       os.path.expanduser('~/Videos/lisa-tests/07-pilote-v3-lora-production.mp4')]
MUSIC=os.path.expanduser("~/.codebuddy/media-audio/music/elegant/ES_Somewhat Elegant - Dye O.mp3")
WORK=f'{SP}/lisa-topic-work'; os.makedirs(WORK,exist_ok=True)
OUT=f'{SP}/lisa-topic-short.mp4'
W,H=1080,1920; GAP=0.35
CAPS=["Tu me trouves jolie ?\nJe n'existe pas.",
      "Une influenceuse\ngénérée par IA.",
      "Payée des milliers d'€\npar publication.",
      "Sans photographe.\nSans studio.\nSans vieillir.",
      "Le futur arrive.\nAbonne-toi."]
def dur(f):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True)
    try: return float(r.stdout.strip())
    except: return 0.0
def esc(t): return t.replace('\\','\\\\').replace(':','\\:').replace("'","’")
segs=[]
for i in range(5):
    vof=f'{VO}/{i+1:02d}.mp3'; d=round(dur(vof)+GAP,2)
    clip=CLIPS[i%len(CLIPS)]
    cap=esc(CAPS[i])
    seg=f'{WORK}/seg-{i:02d}.mp4'
    vf=(f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30,format=yuv420p,"
        f"vignette=PI/5,"
        f"drawtext=text='{cap}':fontcolor=white:fontsize=68:x=(w-text_w)/2:y=h*0.26:line_spacing=16:"
        f"box=1:boxcolor=black@0.38:boxborderw=28:"
        f"shadowcolor=black@0.7:shadowx=2:shadowy=2:"
        f"alpha='if(lt(t,0.3),t/0.3,1)'")
    subprocess.run(['ffmpeg','-y','-v','error','-stream_loop','-1','-i',clip,'-t',f'{d}',
                    '-vf',vf,'-c:v','libx264','-crf','19','-r','30','-pix_fmt','yuv420p','-an',seg],check=True)
    segs.append((seg,vof,d))
XF=0.3; inputs=[]
for s,_,_ in segs: inputs+=['-i',s]
fc=[]; prev='[0:v]'; off=0.0; durs=[d for _,_,d in segs]
for i in range(1,len(segs)):
    off+=durs[i-1]-XF
    fc.append(f'{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.2f}[v{i}]'); prev=f'[v{i}]'
vid=f'{WORK}/video.mp4'
subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(fc),'-map',prev,
                '-c:v','libx264','-crf','19','-pix_fmt','yuv420p',vid],check=True)
total=sum(durs)-XF*(len(segs)-1)
na_in=[]; na_fc=[]; off=0.0
for i,(_,vof,d) in enumerate(segs):
    na_in+=['-i',vof]; delay=int(off*1000)
    na_fc.append(f'[{i}:a]adelay={delay}|{delay},volume=1.0[a{i}]'); off+=d-XF
na_fc.append(''.join(f'[a{i}]' for i in range(len(segs)))+f'amix=inputs={len(segs)}:normalize=0[narr]')
narr=f'{WORK}/narr.wav'
subprocess.run(['ffmpeg','-y','-v','error',*na_in,'-filter_complex',';'.join(na_fc),'-map','[narr]','-t',f'{total}',narr],check=True)
fa=f'{WORK}/audio.wav'
subprocess.run(['ffmpeg','-y','-v','error','-i',narr,'-stream_loop','-1','-i',MUSIC,'-filter_complex',
    f'[1:a]atrim=0:{total},afade=t=in:st=0:d=0.5,afade=t=out:st={total-1:.2f}:d=1,volume=0.22[m];'
    f'[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=250[d];'
    f'[0:a][d]amix=inputs=2:normalize=0[mix]','-map','[mix]',fa],check=True)
mst=f'{WORK}/mastered.wav'
subprocess.run(['ffmpeg','-y','-v','error','-i',fa,'-af','loudnorm=I=-14:TP=-1.5:LRA=11','-ar','48000',mst],check=True)
subprocess.run(['ffmpeg','-y','-v','error','-i',vid,'-i',mst,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-shortest',OUT],check=True)
print(f'PRESENTER-OK {OUT} ({total:.1f}s)')
