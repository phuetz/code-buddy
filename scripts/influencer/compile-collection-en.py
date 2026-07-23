#!/usr/bin/env python3
"""Compilation YouTube ANGLAISE : 14 trailers EN + cartons EN → 1 vidéo (>8 min = mid-roll YouTube)."""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import os, subprocess, glob
HOME=os.path.expanduser('~')
WORK=''+WORKDIR+'/collection-en-work'
OUTDIR=f'{HOME}/Videos/collection'
os.makedirs(WORK, exist_ok=True); os.makedirs(OUTDIR, exist_ok=True)
W,H=1920,1080
GOLD='0xC9A24B'
def esc(t): return t.replace('\\','\\\\').replace(':','\\:').replace("'","’")
def dur(f):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True)
    try: return float(r.stdout.strip())
    except: return 0.0

COLLECTION=[
 ('babel',       "THE BABEL ALGORITHM",        "Techno-thriller"),
 ('kepler',      "THE ECHOES OF KEPLER-442",   "Space opera"),
 ('patient-zero',"PATIENT ZERO",               "Medical thriller"),
 ('soeurs',      "SISTERS IN BLOOD",           "Crime saga"),
 ('empereurs',   "THE EMPERORS OF CRIME",      "Mafia saga"),
 ('conquerants', "THE MONEY CONQUERORS",       "Financial saga"),
 ('cain',        "THE SONS OF CAIN",           "Genetic thriller"),
 ('architectes', "THE ARCHITECTS OF CHAOS",    "Cyberpunk thriller"),
 ('juges',       "THE JUDGES OF THE SHADOWS",  "Legal thriller"),
 ('pionniers',   "THE PIONEERS OF EDEN",       "Epic science fiction"),
 ('immortels',   "THE IMMORTALS",              "Fantasy"),
 ('heritiers',   "THE HEIRS OF EVIL",          "Gothic saga"),
 ('rois',        "THE KINGS OF THE NIGHT",     "Urban drama"),
 ('seigneurs',   "THE WARLORDS",               "War thriller"),
 ('oublies',     "THE FORGOTTEN",              "Dystopia"),
 ('compagnie',   "THE COMPANY",                "Espionage noir"),
 ('compagnon',   "THE SILICON COMPANION",      "Documentary"),
 ('synchro',     "CARNAL SYNCHRONIZATION",     "Sensory cyberpunk"),
]
VF_BASE=f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"
def make_card(path, big, small, sub, seconds):
    d=seconds; dt=[]
    dt.append(f"drawtext=text='{esc(big)}':fontcolor=white:fontsize=82:x=(w-text_w)/2:y=(h/2)-120:line_spacing=14"
              f":alpha='if(lt(t,0.5),t/0.5,if(gt(t,{d-0.5}),max(0,1-(t-{d-0.5})/0.5),1))'")
    dt.append(f"drawtext=text='{esc(small)}':fontcolor={GOLD}:fontsize=44:x=(w-text_w)/2:y=(h/2)+20"
              f":alpha='if(lt(t,0.6),max(0,(t-0.2)/0.4),if(gt(t,{d-0.5}),max(0,1-(t-{d-0.5})/0.5),1))'")
    if sub:
        dt.append(f"drawtext=text='{esc(sub)}':fontcolor=white@0.7:fontsize=30:x=(w-text_w)/2:y=(h/2)+110"
                  f":alpha='if(lt(t,0.7),max(0,(t-0.3)/0.4),if(gt(t,{d-0.5}),max(0,1-(t-{d-0.5})/0.5),1))'")
    vf=f"color=c=black:s={W}x{H}:r=30:d={d},format=yuv420p," + ",".join(dt)
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i',vf,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',f'{d}',
                    '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-b:a','192k','-shortest',path],check=True)
def norm(src,path):
    d=dur(src)
    vf=f"{VF_BASE},fade=t=in:st=0:d=0.4,fade=t=out:st={max(0,d-0.5):.2f}:d=0.5"
    af=f"afade=t=in:st=0:d=0.4,afade=t=out:st={max(0,d-0.5):.2f}:d=0.5"
    subprocess.run(['ffmpeg','-y','-v','error','-i',src,'-vf',vf,'-af',af,
                    '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r','30',
                    '-c:a','aac','-ar','48000','-ac','2','-b:a','192k',path],check=True)
segments=[]
intro=f'{WORK}/00-intro.mp4'
make_card(intro,"PATRICE HUETZ","THE COLLECTION",f"{len(COLLECTION)} trailers — novels & sagas",5.0)
segments.append(intro); print('intro OK',flush=True)
for i,(folder,title,genre) in enumerate(COLLECTION,1):
    src=glob.glob(f'{HOME}/Videos/{folder}-trailer/*EN*1080p.mp4')
    if not src: print(f'{i:02d} {folder}: EN INTROUVABLE — sauté',flush=True); continue
    src=src[0]
    card=f'{WORK}/{i:02d}a-card-{folder}.mp4'; seg=f'{WORK}/{i:02d}b-{folder}.mp4'
    make_card(card,title,genre,f"{i} / {len(COLLECTION)}",3.2); norm(src,seg)
    segments+=[card,seg]; print(f'{i:02d} {folder} OK',flush=True)
lst=f'{WORK}/list.txt'
open(lst,'w').write('\n'.join(f"file '{s}'" for s in segments)+'\n')
out=f'{OUTDIR}/collection-patrice-huetz-EN-1080p.mp4'
subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',lst,'-c','copy',out],check=True)
print(f'COLLECTION-EN-OK {out} ({dur(out)/60:.1f} min)',flush=True)
