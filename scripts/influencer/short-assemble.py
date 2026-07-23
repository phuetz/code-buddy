#!/usr/bin/env python3
"""Assemble un Short vertical 9:16 : short-<book>-shots (v01..) + short-<book>-vo + carton titre + musique + master -14 LUFS.
Usage: short-assemble.py <book> <musique.mp3> [TITRE|"titre"]"""
import os as _os
WORKDIR = _os.environ.get('INFLUENCER_WORKDIR', _os.path.expanduser('~/.codebuddy/influencer-work'))
_os.makedirs(WORKDIR, exist_ok=True)

import sys, os, subprocess, glob
BASE=WORKDIR
book=sys.argv[1]; MUSIC=sys.argv[2] if len(sys.argv)>2 else None
TITLE=sys.argv[3] if len(sys.argv)>3 else book.upper()
SHOTS=f'{BASE}/short-{book}-shots'; VO=f'{BASE}/short-{book}-vo'
WORK=f'{BASE}/short-{book}-work'; OUT=f'{BASE}/short-{book}.mp4'
os.makedirs(WORK,exist_ok=True)
W,H=1080,1920; GAP=0.55
def dur(f):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True)
    try: return float(r.stdout.strip())
    except: return 0.0
def esc(t): return t.replace('\\','\\\\').replace(':','\\:').replace("'","’")
# vidéos verticales dispo (fallback si manque)
avail=sorted(glob.glob(f'{SHOTS}/v*.mp4'))
def shot(i):
    p=f'{SHOTS}/v{i:02d}.mp4'
    return p if os.path.exists(p) else (avail[(i-1)%len(avail)] if avail else None)
# narrations dans l'ordre
lines=sorted(glob.glob(f'{VO}/*.mp3'))
# map réplique -> plan (01->v01,02->v02,03->v03,04->v01 titre)
plan=[1,2,3,1]
segs=[]
for idx,vof in enumerate(lines):
    sp=shot(plan[idx] if idx<len(plan) else 1)
    if not sp: print(f'seg {idx}: pas de plan'); continue
    seg_len=round(dur(vof)+GAP,2)
    seg=f'{WORK}/seg-{idx:02d}.mp4'
    vf=f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30,format=yuv420p"
    is_title=(idx==len(lines)-1)
    if is_title:
        vf+=(f",drawtext=text='{esc(TITLE)}':fontcolor=white:fontsize=76:x=(w-text_w)/2:y=(h/2)-90:line_spacing=14"
             f":box=0:shadowcolor=black@0.7:shadowx=3:shadowy=3"
             f":alpha='if(lt(t,0.4),t/0.4,1)'")
        vf+=(f",drawtext=text='Roman de Patrice Huetz':fontcolor=0xC9A24B:fontsize=40:x=(w-text_w)/2:y=(h/2)+30"
             f":alpha='if(lt(t,0.7),max(0,(t-0.3)/0.4),1)'")
    subprocess.run(['ffmpeg','-y','-v','error','-stream_loop','-1','-i',sp,'-t',f'{seg_len}',
                    '-vf',vf,'-c:v','libx264','-crf','19','-r','30','-pix_fmt','yuv420p','-an',seg],check=True)
    segs.append((seg,vof,seg_len))
if not segs: print('AUCUN segment'); sys.exit(1)
XF=0.35
inputs=[]
for s,_,_ in segs: inputs+=['-i',s]
fc=[]; prev='[0:v]'; off=0.0; durs=[d for _,_,d in segs]
for i in range(1,len(segs)):
    off+=durs[i-1]-XF
    fc.append(f'{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.2f}[v{i}]'); prev=f'[v{i}]'
vid=f'{WORK}/video.mp4'
subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(fc) if len(segs)>1 else 'null',
                '-map',prev if len(segs)>1 else '0:v','-c:v','libx264','-crf','19','-pix_fmt','yuv420p',vid],check=True)
total=sum(durs)-XF*(len(segs)-1)
# narration timée
na_in=[]; na_fc=[]; off=0.0; ai=0
for (_,vof,d) in segs:
    na_in+=['-i',vof]; delay=int(off*1000)
    na_fc.append(f'[{ai}:a]adelay={delay}|{delay},volume=1.0[a{ai}]'); ai+=1; off+=d-XF
na_fc.append(''.join(f'[a{k}]' for k in range(ai))+f'amix=inputs={ai}:normalize=0[narr]')
narr=f'{WORK}/narr.wav'
subprocess.run(['ffmpeg','-y','-v','error',*na_in,'-filter_complex',';'.join(na_fc),'-map','[narr]','-t',f'{total}',narr],check=True)
# musique duckée + master -14 LUFS
fa=f'{WORK}/audio.wav'
if MUSIC and os.path.exists(MUSIC):
    subprocess.run(['ffmpeg','-y','-v','error','-i',narr,'-stream_loop','-1','-i',MUSIC,'-filter_complex',
        f'[1:a]atrim=0:{total},afade=t=in:st=0:d=0.5,afade=t=out:st={total-1:.2f}:d=1,volume=0.32[m];'
        f'[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=250[d];'
        f'[0:a][d]amix=inputs=2:normalize=0[mix]','-map','[mix]',fa],check=True)
else: fa=narr
mst=f'{WORK}/mastered.wav'
subprocess.run(['ffmpeg','-y','-v','error','-i',fa,'-af','loudnorm=I=-14:TP=-1.5:LRA=11','-ar','48000',mst],check=True)
subprocess.run(['ffmpeg','-y','-v','error','-i',vid,'-i',mst,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-shortest',OUT],check=True)
print(f'SHORT-OK {OUT} ({total:.1f}s)')
