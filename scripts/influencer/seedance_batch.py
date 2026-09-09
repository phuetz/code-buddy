#!/usr/bin/env python3
"""Pilote batch Dreamina / Seedance via CDP (Brave port 9222, onglet Dreamina).

UI 2026-09 : chat agent (Tiptap ProseMirror, plus de textarea). Ne pilote
JAMAIS l'onglet Flow. Ne clique JAMAIS un achat / offre / abonnement.

Usage:
  python3 seedance_batch.py jobs.json --model 2.0mini --outdir DIR
  jobs.json = [{"name":"...","prompt":"...","ratio":"16:9","duration":"5s",
                "ref_pexels":"..."}, ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import subprocess
from pathlib import Path

sys.path.insert(0, os.path.expanduser('~/code-buddy/scripts/influencer'))
cdp = __import__('cdp-lib')

BAD_VIDEO = ('capcutstatic', 'loading', 'animation', 'static/media', 'record-loading')
COMMERCE_RE = re.compile(
    r'\b(buy credits|manage subscription|all plans|switch to|upgrade|'
    r'subscribe|acheter|abonnement)\b',
    re.I,
)
MODEL_LABELS = {
    '2.5': 'Dreamina Seedance 2.5',
    '2.0mini': 'Dreamina Seedance 2.0 Mini',
    '2.0-mini': 'Dreamina Seedance 2.0 Mini',
    'mini': 'Dreamina Seedance 2.0 Mini',
}
DISPATCH = (
    "for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){"
    "el.dispatchEvent(t.startsWith('pointer')"
    "?new PointerEvent(t,{bubbles:true,cancelable:true,pointerType:'mouse',button:0})"
    ":new MouseEvent(t,{bubbles:true,cancelable:true,button:0,view:window}));}"
)


def resolve_model_label(alias: str) -> str:
    key = (alias or '').strip().lower().replace(' ', '')
    if key not in MODEL_LABELS:
        raise SystemExit(
            f'--model inconnu {alias!r} (attendu 2.5 ou 2.0mini)'
        )
    return MODEL_LABELS[key]


def parse_duration_secs(raw) -> int:
    if raw is None or raw == '':
        return 5
    if isinstance(raw, (int, float)):
        return int(raw)
    m = re.search(r'(\d+)', str(raw))
    if not m:
        return 5
    return int(m.group(1))


def parse_credit_int(text: str | None) -> int | None:
    if not text:
        return None
    t = str(text).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
    m = re.search(r'(\d+(?:\.\d+)?)([KMB])?\b', t, re.I)
    if not m:
        return None
    n = float(m.group(1))
    suf = (m.group(2) or '').upper()
    if suf == 'K':
        n *= 1000
    elif suf == 'M':
        n *= 1_000_000
    elif suf == 'B':
        n *= 1_000_000_000
    return int(round(n))


def is_forbidden_commerce_text(text: str | None) -> bool:
    return bool(COMMERCE_RE.search(text or ''))


def is_placeholder_video_url(url: str) -> bool:
    u = (url or '').lower()
    return (not u.startswith('http')) or any(b in u for b in BAD_VIDEO)


def looks_like_generate_button(*, disabled: bool, width: float, y: float, primary: bool) -> bool:
    """Rond primary du compositeur (UI 2026-09). disabled HTML = prompt non committé."""
    return primary and (not disabled) and 20 <= float(width) <= 56 and float(y) > 700


# --- CDP ------------------------------------------------------------

def _tabs():
    return json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list', timeout=5))


def dreamina_tab(tabs=None):
    tabs = tabs if tabs is not None else _tabs()
    pages = [t for t in tabs if t.get('type') == 'page']
    for t in pages:
        url = (t.get('url') or '').lower()
        if 'flow.google' in url or 'labs.google' in url:
            continue
        if 'dreamina.capcut.com' in url and '/ai-tool/generate' in url:
            return t
    raise SystemExit(
        'Onglet Dreamina generate introuvable sur :9222 '
        '(et refus explicite de tout onglet Flow).'
    )


def conn():
    tab = dreamina_tab()
    c = cdp.CDP(tab)
    c.s.settimeout(60)
    c.cmd('Page.enable')
    c.cmd('Runtime.enable')
    c.cmd('Page.bringToFront')
    c.cmd('Page.setWebLifecycleState', {'state': 'active'})
    c.cmd('Emulation.setFocusEmulationEnabled', {'enabled': True})
    return c


def ev(c, js, to=25):
    return c.ev(js, to)


def esc(c, n=2):
    for _ in range(n):
        for t in ('keyDown', 'keyUp'):
            c.cmd('Input.dispatchKeyEvent', {
                'type': t, 'key': 'Escape', 'code': 'Escape',
                'windowsVirtualKeyCode': 27,
            })
        time.sleep(0.25)


def trusted_click(c, x, y, n=1):
    x, y = float(x), float(y)
    c.cmd('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    for t in ('mousePressed', 'mouseReleased'):
        c.cmd('Input.dispatchMouseEvent', {
            'type': t, 'x': x, 'y': y, 'button': 'left',
            'buttons': 1 if t == 'mousePressed' else 0, 'clickCount': n,
        })
        time.sleep(0.05)
    time.sleep(0.2)


def js_click(c, find_js: str):
    """Clic DOM synthétique (Pointer+Mouse) sur le premier élément trouvé."""
    raw = ev(c, f'''(()=>{{
      const el={find_js};
      if(!el) return 'NOEL';
      const t=(el.innerText||el.getAttribute('aria-label')||'').trim();
      if(/buy credits|manage subscription|all plans|switch to|upgrade|subscribe|acheter|abonnement/i.test(t)) return 'COMMERCE';
      {DISPATCH}
      const r=el.getBoundingClientRect();
      return JSON.stringify({{text:t.slice(0,80),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),
        w:Math.round(r.width),h:Math.round(r.height),dis:!!el.disabled}});
    }})()''')
    if raw == 'COMMERCE':
        raise RuntimeError('refus de cliquer un libellé d\'achat/abonnement')
    if raw in (None, 'NOEL', 'null'):
        return None
    return json.loads(raw)


def click_text(c, text: str, *, exact=True):
    cond = (
        f"(e.innerText||'').trim()==={json.dumps(text)}"
        if exact else
        f"(e.innerText||'').includes({json.dumps(text)})"
    )
    return js_click(
        c,
        f"[...document.querySelectorAll('button,[role=button],div,span')]"
        f".find(e=>e.getBoundingClientRect().width>0&&{cond}"
        f"&&!/buy credits|manage subscription|all plans|switch to/i.test((e.innerText||'')))",
    )


def journal_write(path: Path, event: str, **kw):
    rec = {'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'event': event, **kw}
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        f.flush()


def read_balance(c) -> int | None:
    """Clic sur le compact 3.3K, lecture .credits-R4hAvo, Escape immédiat."""
    compact = ev(c, '''(()=>{
      const e=document.querySelector('.credit-amount-text-UlvsZC');
      return e?(e.textContent||'').trim():'';
    })()''')
    clicked = js_click(c, "document.querySelector('.credit-amount-text-UlvsZC')")
    if not clicked:
        return parse_credit_int(compact)
    exact = None
    for _ in range(12):
        time.sleep(0.35)
        raw = ev(c, '''(()=>{
          const e=document.querySelector('.credits-R4hAvo');
          return e?(e.textContent||'').trim():'';
        })()''')
        exact = parse_credit_int(raw)
        if exact is not None and exact > 0:
            break
    esc(c, 3)
    time.sleep(0.4)
    return exact if exact is not None else parse_credit_int(compact)


def displayed_cost(c) -> int | None:
    raw = ev(c, '''(()=>{
      const e=document.querySelector('.actual-credits-ojfP8I');
      return e?(e.textContent||'').trim():'';
    })()''')
    return parse_credit_int(raw)


def current_model(c) -> str:
    return (ev(c, '''(()=>{
      const e=document.querySelector('.model-label-li_27b');
      return e?(e.innerText||'').trim():'';
    })()''') or '').strip()


def ensure_ai_video(c) -> None:
    kind = ev(c, '''(()=>{
      const e=[...document.querySelectorAll('[role=combobox]')].find(x=>/AI /.test(x.innerText||''));
      return e?(e.innerText||'').trim():'';
    })()''') or ''
    if 'AI Video' in kind:
        return
    js_click(c, "[...document.querySelectorAll('[role=combobox]')].find(x=>/AI /.test(x.innerText||''))")
    time.sleep(0.8)
    js_click(
        c,
        "[...document.querySelectorAll('[role=option], [class*=option-label], div, span')]"
        ".find(e=>(e.innerText||'').trim()==='AI Video' && e.getBoundingClientRect().width>0)",
    )
    time.sleep(0.5)
    esc(c, 1)


def set_model(c, label: str) -> bool:
    if current_model(c) == label:
        return True
    js_click(c, "document.querySelector('.model-label-li_27b')")
    time.sleep(1.2)
    ev(c, f'''(()=>{{
      const el=[...document.querySelectorAll('.option-label-jKuNta')].find(
        e=>(e.innerText||'').trim()==={json.dumps(label)});
      if(el) el.scrollIntoView({{block:'center'}});
      return !!el;
    }})()''')
    time.sleep(0.2)
    hit = js_click(
        c,
        f"[...document.querySelectorAll('.option-label-jKuNta')].find("
        f"e=>(e.innerText||'').trim()==={json.dumps(label)})",
    )
    time.sleep(0.8)
    esc(c, 1)
    return current_model(c) == label or (hit is not None and label in (current_model(c) or ''))


def current_duration(c) -> str:
    return (ev(c, r'''(()=>{
      const b=[...document.querySelectorAll('button')].find(e=>{
        const r=e.getBoundingClientRect();
        return r.y>800 && r.width>0 && /^\s*\d+s\s*$/.test((e.innerText||'').replace(/\s+/g,''));
      });
      return b?(b.innerText||'').replace(/\s+/g,'').trim():'';
    })()''') or '')


def set_duration(c, secs: int) -> bool:
    if current_duration(c) == f'{secs}s':
        return True
    js_click(
        c,
        r"[...document.querySelectorAll('button')].find(e=>{"
        r"const r=e.getBoundingClientRect();"
        r"return r.y>800 && /^\s*\d+s\s*$/.test((e.innerText||'').replace(/\s+/g,''));})",
    )
    time.sleep(0.9)
    tick = js_click(
        c,
        f"[...document.querySelectorAll('.tick-label-MCIj9H')].find("
        f"e=>(e.textContent||'').trim()==={json.dumps(str(secs))})",
    )
    if not tick:
        # rail proportionnel (2.5 peut aller à 30 s)
        ev(c, f'''(()=>{{
          const rail=document.querySelector('.lv-slider-road');
          if(!rail) return null;
          const r=rail.getBoundingClientRect();
          const ticks=[...document.querySelectorAll('.tick-label-MCIj9H')]
            .map(e=>parseInt((e.textContent||'').trim(),10)).filter(n=>!isNaN(n));
          const mx=Math.max(15, ...ticks, {int(secs)});
          const x=r.x + r.width * ({int(secs)}/mx);
          const y=r.y + r.height/2;
          const el=document.elementFromPoint(x,y) || rail;
          {DISPATCH}
          return 1;
        }})()''')
        inp = ev(c, '''(()=>{
          const i=[...document.querySelectorAll('input.lv-input')].find(e=>e.getBoundingClientRect().width>20 && e.getBoundingClientRect().y>750);
          return i?String(i.value):'';
        })()''')
        if str(inp) != str(secs):
            # dernier recours : stepper + / champ
            js_click(
                c,
                "[...document.querySelectorAll('.lv-input-number-step-button')].find(e=>"
                "e.getBoundingClientRect().width>0 && !e.className.includes('disabled') && e.getBoundingClientRect().y<e.parentElement.getBoundingClientRect().y+12)",
            )
    time.sleep(0.6)
    esc(c, 1)
    time.sleep(0.3)
    return current_duration(c) == f'{secs}s'


def current_ratio(c) -> str:
    return (ev(c, r'''(()=>{
      const b=[...document.querySelectorAll('button')].find(e=>/16:9|9:16|1:1|4:3|3:4|21:9/.test(e.innerText||'') && e.getBoundingClientRect().y>800);
      if(!b) return '';
      const m=(b.innerText||'').match(/(21:9|16:9|9:16|4:3|3:4|1:1)/);
      return m?m[1]:'';
    })()''') or '')


def set_ratio(c, ratio: str) -> bool:
    if current_ratio(c) == ratio:
        return True
    js_click(
        c,
        "[...document.querySelectorAll('button')].find(e=>/16:9|9:16|1:1|4:3|3:4|21:9/.test(e.innerText||'') && e.getBoundingClientRect().y>800)",
    )
    time.sleep(1.0)
    js_click(
        c,
        f"[...document.querySelectorAll('.label-AvMqF9, button, span, div')].find("
        f"e=>(e.innerText||'').trim()==={json.dumps(ratio)} && e.getBoundingClientRect().width>0"
        f" && e.getBoundingClientRect().y>500)",
    )
    time.sleep(0.6)
    esc(c, 1)
    return current_ratio(c) == ratio


def editor_text(c) -> str:
    return (ev(c, '''(()=>{
      const e=[...document.querySelectorAll('.tiptap.ProseMirror')].sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
      return e?(e.innerText||'').replace(/\u00a0/g,' ').trim():'';
    })()''') or '')


def _type_chars(c, prompt: str) -> None:
    for char in prompt:
        if char == '\n':
            for event_type in ('keyDown', 'keyUp'):
                c.cmd('Input.dispatchKeyEvent', {
                    'type': event_type, 'key': 'Enter', 'code': 'Enter',
                    'windowsVirtualKeyCode': 13, 'nativeVirtualKeyCode': 13,
                })
        else:
            c.cmd('Input.dispatchKeyEvent', {
                'type': 'char', 'text': char, 'unmodifiedText': char,
            })


def set_prompt(c, prompt: str) -> bool:
    raw = ev(c, '''(()=>{
      const e=[...document.querySelectorAll('.tiptap.ProseMirror')].sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
      if(!e) return null;
      e.focus();
      const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.x+40,y:r.y+Math.min(24,r.height/2)});
    })()''')
    if not raw:
        return False
    pos = json.loads(raw)
    trusted_click(c, pos['x'], pos['y'], n=3)
    time.sleep(0.1)
    for t in ('keyDown', 'keyUp'):
        c.cmd('Input.dispatchKeyEvent', {
            'type': t, 'key': 'a', 'code': 'KeyA',
            'windowsVirtualKeyCode': 65, 'modifiers': 2,
        })
    time.sleep(0.05)
    for t in ('keyDown', 'keyUp'):
        c.cmd('Input.dispatchKeyEvent', {
            'type': t, 'key': 'Backspace', 'code': 'Backspace',
            'windowsVirtualKeyCode': 8, 'nativeVirtualKeyCode': 8,
        })
    time.sleep(0.15)
    _type_chars(c, prompt)
    time.sleep(0.4)
    got = editor_text(c)
    if got == prompt.strip():
        return True
    # repli insertText
    trusted_click(c, pos['x'], pos['y'], n=3)
    c.cmd('Input.insertText', {'text': prompt})
    time.sleep(0.4)
    return prompt.strip()[:40] in (editor_text(c) or '')


def set_reference(c, image_path: str) -> bool:
    if not image_path or not os.path.exists(image_path):
        return False
    c.cmd('Page.setInterceptFileChooserDialog', {'enabled': True})
    c.cmd('DOM.enable')
    rect = ev(c, '''(()=>{
      const e=document.querySelector('.reference-upload-goGAYf');
      if(!e) return null;
      const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
    })()''')
    if not rect:
        return False
    pos = json.loads(rect)
    trusted_click(c, pos['x'], pos['y'])
    nid = None
    for _ in range(15):
        time.sleep(0.25)
        root = c.cmd('DOM.getDocument', {'depth': -1})
        if not root or 'result' not in root:
            continue
        node_id = root['result']['root']['nodeId']
        q = c.cmd('DOM.querySelector', {'nodeId': node_id, 'selector': 'input[type=file]'})
        nid = (q or {}).get('result', {}).get('nodeId')
        if nid:
            break
    if not nid:
        esc(c, 1)
        return False
    c.cmd('DOM.setFileInputFiles', {'files': [os.path.abspath(image_path)], 'nodeId': nid})
    time.sleep(4)
    return True


def clear_references(c) -> None:
    for _ in range(8):
        hit = ev(c, '''(()=>{
          const e=document.querySelector('[class*=remove-button], [class*=close]');
          if(!e) return 'null';
          const r=e.getBoundingClientRect();
          if(r.width<4 || r.y<700) return 'null';
          return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
        })()''')
        if hit in (None, 'null'):
            break
        d = json.loads(hit)
        trusted_click(c, d['x'], d['y'])
        time.sleep(0.4)


def generate_button_state(c) -> dict:
    raw = ev(c, '''(()=>{
      const b=[...document.querySelectorAll('button.lv-btn-primary.lv-btn-shape-circle')].find(e=>{
        const r=e.getBoundingClientRect();
        return r.width>0 && r.y>800;
      });
      if(!b) return null;
      const r=b.getBoundingClientRect();
      return JSON.stringify({dis:!!b.disabled, aria:b.getAttribute('aria-disabled'),
        x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2),
        w:Math.round(r.width), h:Math.round(r.height),
        cls:(b.className||'').toString()});
    })()''')
    return json.loads(raw) if raw and raw != 'null' else {}


def generate_and_confirm(c) -> bool:
    state = {}
    for _ in range(20):
        state = generate_button_state(c)
        if looks_like_generate_button(
            disabled=bool(state.get('dis')),
            width=float(state.get('w') or 0),
            y=float(state.get('y') or 0),
            primary=True,
        ):
            break
        time.sleep(0.4)
    else:
        return False
    trusted_click(c, state['x'], state['y'])
    time.sleep(2.5)
    conf = ev(c, '''(()=>{
      const e=[...document.querySelectorAll('button')].find(b=>{
        const t=(b.innerText||'').trim();
        return t==='Confirm' || t==='Continue' || t==='Got it';
      });
      if(!e) return null;
      const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,t:(e.innerText||'').trim()});
    })()''')
    if conf and conf != 'null':
        d = json.loads(conf)
        if not is_forbidden_commerce_text(d.get('t')):
            trusted_click(c, d['x'], d['y'])
            time.sleep(2)
    return True


def real_vids(c) -> list[str]:
    raw = ev(c, '''JSON.stringify([...document.querySelectorAll('video')]
      .map(x=>x.currentSrc||x.src).filter(Boolean))''')
    urls = json.loads(raw or '[]')
    extra = ev(c, '''JSON.stringify(performance.getEntriesByType('resource')
      .map(e=>e.name).filter(u=>/v16-cc|video\\/tos|capcut\\.com.*\\.mp4/i.test(u)))''')
    urls += json.loads(extra or '[]')
    out = []
    seen = set()
    for u in urls:
        if u in seen or is_placeholder_video_url(u):
            continue
        seen.add(u)
        out.append(u)
    return out


def wait_download(c, name: str, dest: str, timeout_s=420) -> str | None:
    baseline = set(real_vids(c))
    t0 = time.time()
    url = None
    while time.time() - t0 < timeout_s:
        time.sleep(8)
        click_text(c, 'Go to bottom')
        fresh = [u for u in real_vids(c) if u not in baseline]
        prog = ev(c, r'''(()=>{
          const t=document.body.innerText||'';
          const m=t.match(/(\d{1,3}%)|generation failed|failed to generate|content violat|sensitive content/i);
          return m?m[0]:'';
        })()''') or ''
        print(f"    [{name}] +{int(time.time()-t0)}s fresh={len(fresh)} prog={prog!r}", flush=True)
        if re.search(r'failed to generate|generation failed|content violat|sensitive content', prog, re.I):
            return None
        if fresh:
            url = fresh[0]
            break
    if not url:
        return None
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://dreamina.capcut.com/',
    })
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    try:
        Path(dest).write_bytes(urllib.request.urlopen(req, timeout=180).read())
    except Exception as exc:
        # fetch depuis la page (cookies de session)
        print(f'    urllib KO ({exc}); fetch in-page', flush=True)
        js = f'''(async()=>{{
          const r=await fetch({json.dumps(url)},{{credentials:'include'}});
          const b=await r.arrayBuffer();
          const u=new Uint8Array(b);
          let s=''; const n=u.length;
          const chunk=0x8000;
          for(let i=0;i<n;i+=chunk) s+=String.fromCharCode.apply(null,u.subarray(i,i+chunk));
          return btoa(s);
        }})()'''
        res = c.cmd('Runtime.evaluate', {
            'expression': js, 'awaitPromise': True, 'returnByValue': True,
        }, to=120)
        b64 = ((res or {}).get('result') or {}).get('result', {}).get('value')
        if not b64:
            return None
        import base64
        Path(dest).write_bytes(base64.b64decode(b64))
    if not os.path.exists(dest) or os.path.getsize(dest) < 50_000:
        return None
    return dest


def ffprobe_info(path: str) -> str:
    return subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'stream=width,height,codec_type',
         '-show_entries', 'format=duration',
         '-of', 'default=nw=1', path],
        capture_output=True, text=True,
    ).stdout.replace('\n', ' ').strip()


def pex_download(query: str, dest_dir: str, orientation='landscape') -> str | None:
    key = os.environ.get('PEXELS_API_KEY', '')
    if not key:
        return None
    ua = 'Mozilla/5.0 (SeedanceBot)'
    u = 'https://api.pexels.com/v1/search?' + urllib.parse.urlencode(
        {'query': query, 'per_page': 10, 'orientation': orientation})
    try:
        d = json.load(urllib.request.urlopen(
            urllib.request.Request(u, headers={'Authorization': key, 'User-Agent': ua}),
            timeout=30))
        photos = d.get('photos') or []
        if not photos:
            return None
        src = photos[0]['src'].get('large2x') or photos[0]['src'].get('original')
        slug = ''.join(ch if ch.isalnum() else '-' for ch in query.lower())[:40]
        path = os.path.join(dest_dir, '_ref_' + slug + '.jpg')
        Path(path).write_bytes(urllib.request.urlopen(
            urllib.request.Request(src, headers={'User-Agent': ua}), timeout=60).read())
        return path
    except Exception as e:
        print('  pexels err', e, flush=True)
        return None


def run_job(c, job: dict, *, model_label: str, outdir: Path, journal: Path,
            min_credits: int) -> dict:
    name = job['name']
    dest = str(outdir / f'{name}.mp4')
    secs = parse_duration_secs(job.get('duration', job.get('secs', 5)))
    ratio = job.get('ratio') or '16:9'
    prompt = job['prompt']
    result = {'name': name, 'ok': False, 'path': dest, 'secs': secs, 'ratio': ratio}

    if os.path.exists(dest) and os.path.getsize(dest) > 100_000:
        print(f'[{name}] déjà fait, skip', flush=True)
        result['ok'] = True
        result['skipped'] = True
        return result

    esc(c, 2)
    click_text(c, 'New chat')
    time.sleep(1.0)
    esc(c, 1)
    ensure_ai_video(c)
    before = read_balance(c)
    result['credits_before'] = before
    journal_write(journal, 'clip_start', name=name, model=model_label,
                  ratio=ratio, duration=secs, credits_before=before)
    if before is not None and before < min_credits:
        print(f'[{name}] STOP solde {before} < {min_credits}', flush=True)
        journal_write(journal, 'stop_low_balance', name=name, credits=before,
                      min_credits=min_credits)
        result['stop'] = True
        return result

    print(f'[{name}] model={model_label} {secs}s {ratio} solde={before}', flush=True)
    ok_m = set_model(c, model_label)
    ok_r = set_ratio(c, ratio)
    ok_d = set_duration(c, secs)
    print(f'    settings model={ok_m} ratio={ok_r} dur={ok_d} now={current_model(c)!r} {current_duration(c)} {current_ratio(c)}', flush=True)
    if (model_label not in (current_model(c) or '')
            or current_duration(c) != f'{secs}s'
            or (ratio and current_ratio(c) != ratio)):
        print(f'[{name}] réglages incohérents, job sauté', flush=True)
        journal_write(journal, 'skip_bad_settings', name=name,
                      model=current_model(c), duration=current_duration(c),
                      ratio=current_ratio(c), want_model=model_label)
        return result

    clear_references(c)
    ref = job.get('ref')
    if not ref and job.get('ref_pexels'):
        ref = pex_download(
            job['ref_pexels'], str(outdir),
            'portrait' if ratio == '9:16' else 'landscape',
        )
    if ref:
        set_reference(c, ref)

    if not set_prompt(c, prompt):
        print(f'[{name}] prompt non committé', flush=True)
        journal_write(journal, 'prompt_fail', name=name)
        return result

    cost = displayed_cost(c)
    result['cost_shown'] = cost
    if before is not None and cost is not None and cost > before:
        print(f'[{name}] STOP coût {cost} > solde {before}', flush=True)
        journal_write(journal, 'stop_cost', name=name, cost=cost, credits=before)
        result['stop'] = True
        return result

    if not generate_and_confirm(c):
        print(f'[{name}] bouton generate indisponible', flush=True)
        journal_write(journal, 'no_generate', name=name)
        return result

    got = wait_download(c, name, dest, timeout_s=900 if '2.5' in model_label else 480)
    after = read_balance(c)
    result['credits_after'] = after
    if got:
        info = ffprobe_info(got)
        (outdir / f'{name}.txt').write_text(prompt, encoding='utf-8')
        print(f'    -> {got} ({os.path.getsize(got)//1024} Ko) {info} solde {before}→{after}', flush=True)
        journal_write(journal, 'clip_done', name=name, dest=got, ffprobe=info,
                      credits_before=before, credits_after=after,
                      cost_shown=cost, bytes=os.path.getsize(got))
        result['ok'] = True
        result['ffprobe'] = info
        result['bytes'] = os.path.getsize(got)
    else:
        print(f'[{name}] ÉCHEC / timeout  solde {before}→{after}', flush=True)
        journal_write(journal, 'clip_fail', name=name,
                      credits_before=before, credits_after=after)
    return result


def parse_args(argv=None):
    p = argparse.ArgumentParser(description='Batch Dreamina/Seedance (onglet CDP Dreamina uniquement)')
    p.add_argument('jobs', nargs='?', help='JSON jobs (sinon stdin)')
    p.add_argument('--model', default='2.5', help='2.5 ou 2.0mini')
    p.add_argument('--persona', default='ambre')
    p.add_argument('--outdir', default=None)
    p.add_argument('--min-credits', type=int, default=160,
                   help='Arrêt propre si le solde passe sous ce seuil (défaut 160 = 1 clip 2.5 5s)')
    p.add_argument('--journal', default=None)
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    model_label = resolve_model_label(args.model)
    if args.jobs:
        jobs = json.loads(Path(args.jobs).read_text(encoding='utf-8'))
    else:
        jobs = json.load(sys.stdin)
    if not isinstance(jobs, list):
        raise SystemExit('jobs.json doit être une liste')

    outdir = Path(args.outdir).expanduser() if args.outdir else Path(
        os.path.expanduser(f'~/.codebuddy/personas/{args.persona}/seedance')
    )
    outdir.mkdir(parents=True, exist_ok=True)
    journal = Path(args.journal).expanduser() if args.journal else (outdir / 'seedance-journal.jsonl')

    c = conn()
    esc(c, 2)
    done = []
    for j in jobs:
        r = run_job(c, j, model_label=model_label, outdir=outdir,
                    journal=journal, min_credits=args.min_credits)
        if r.get('ok'):
            done.append(r)
        if r.get('stop'):
            print('=== ARRÊT PROPRE (solde) ===', flush=True)
            break
        time.sleep(2)
    print(f'\n=== TERMINÉ : {len(done)}/{len(jobs)} clips ===')
    for d in done:
        print(' ', d.get('path'))


if __name__ == '__main__':
    main()
