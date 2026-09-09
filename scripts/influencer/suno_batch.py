#!/usr/bin/env python3
"""Pilote batch Suno Pro via CDP (Brave port 9222, onglet suno.com uniquement).

UI 2026-09 (suno.com/create) : onglets Simple / Advanced / Sounds, Create song,
Instrumental (« Check this to generate an instrumental only song »), champ
Styles, titre optionnel. Le clic DOM ne déclenche pas Create : clic TRUSTED
(Page.bringToFront + mouseMoved + mousePressed buttons:1). La file met 20–60 s
à afficher les cartes — ne pas re-cliquer.

Ne pilote JAMAIS Flow ni Dreamina. Ne clique JAMAIS Upgrade / Earn Credits /
Buy credits / Buy downloads.

Usage :
  python3 suno_batch.py jobs.json --outdir DIR [--min-credits 320]
  jobs.json = [{"name","style","instrumental":true,"title"}, ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.expanduser('~/code-buddy/scripts/influencer'))
cdp = __import__('cdp-lib')

COMMERCE_RE = re.compile(
    r'\b(buy credits|buy downloads|earn credits|upgrade|premier plan|'
    r'manage subscription|all plans|subscribe|acheter|abonnement|'
    r'unlock \& download for|purchase)\b',
    re.I,
)
CREATE_COST = 10  # 1 generate = 2 takes
CLIP_WAIT_S = 180
DOWNLOAD_WAIT_S = 90
AUDIO_EXT = ('.wav', '.mp3', '.m4a', '.ogg', '.flac')

MSE_HOOK = r'''(()=>{
  if (!window.__SUNO_SB__) window.__SUNO_SB__ = {chunks:[], n:0, bytes:0};
  window.__SUNO_CAPTURE = window.__SUNO_CAPTURE || false;
  const proto = window.SourceBuffer && window.SourceBuffer.prototype;
  if (!proto || proto.__sunoWrapped) return;
  const orig = proto.appendBuffer;
  proto.appendBuffer = function(data) {
    try {
      let u = null;
      if (data instanceof ArrayBuffer) u = new Uint8Array(data.slice(0));
      else if (ArrayBuffer.isView(data)) {
        u = new Uint8Array(data.buffer.slice(
          data.byteOffset, data.byteOffset + data.byteLength));
      }
      if (u && u.length && window.__SUNO_SB__ && window.__SUNO_CAPTURE) {
        window.__SUNO_SB__.chunks.push(u);
        window.__SUNO_SB__.n += 1;
        window.__SUNO_SB__.bytes += u.length;
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  proto.__sunoWrapped = true;
})();'''


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


def slugify(name: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9]+', '-', (name or '').strip()).strip('-').lower()
    return (s or 'clip')[:80]


def credits_remaining_from_account_text(text: str) -> int | None:
    """Parse « Credits Remaining 2460 » from suno.com/account."""
    m = re.search(
        r'Credits Remaining\s+([\d\s\u202f,]{1,12})',
        text or '',
        re.I,
    )
    if not m:
        return None
    return parse_credit_int(m.group(1))


def downloads_remaining_from_account_text(text: str) -> int | None:
    m = re.search(
        r'Downloads Remaining\s+([\d\s\u202f,]{1,8})',
        text or '',
        re.I,
    )
    if not m:
        return None
    return parse_credit_int(m.group(1))


def validate_job(job: dict, *, allow_vocals: bool) -> str | None:
    if not isinstance(job, dict):
        return 'job must be an object'
    if not (job.get('name') or job.get('title')):
        return 'job needs name or title'
    if not job.get('style'):
        return 'job needs style'
    instrumental = bool(job.get('instrumental', True))
    lyrics = (job.get('lyrics') or '').strip()
    if not allow_vocals and not instrumental:
        return 'refusing non-instrumental job without --allow-vocals'
    if not allow_vocals and lyrics:
        return 'refusing lyrics without --allow-vocals'
    return None


def _tabs():
    return json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list', timeout=5))


def suno_tab(tabs=None):
    tabs = tabs if tabs is not None else _tabs()
    pages = [t for t in tabs if t.get('type') == 'page']
    for t in pages:
        url = (t.get('url') or '').lower()
        if 'flow.google' in url or 'labs.google' in url:
            continue
        if 'dreamina.capcut.com' in url:
            continue
        if 'suno.com' in url:
            return t
    raise SystemExit(
        'Onglet suno.com introuvable sur :9222 '
        '(et refus explicite de tout onglet Flow/Dreamina).'
    )


def conn():
    tab = suno_tab()
    c = cdp.CDP(tab)
    c.s.settimeout(90)
    c.cmd('Page.enable')
    c.cmd('Runtime.enable')
    c.cmd('Network.enable')
    c.cmd('Page.addScriptToEvaluateOnNewDocument', {'source': MSE_HOOK})
    c.cmd('Page.bringToFront')
    c.cmd('Page.setWebLifecycleState', {'state': 'active'})
    c.cmd('Emulation.setFocusEmulationEnabled', {'enabled': True})
    # Coordonnées CSS = hit-test TRUSTED (Input.dispatchMouseEvent).
    # 1200 px de haut : le bouton Duration/Custom est à y≈1084.
    c.cmd('Emulation.setDeviceMetricsOverride', {
        'width': 1920, 'height': 1200, 'deviceScaleFactor': 1, 'mobile': False,
    })
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
        time.sleep(0.2)


def trusted_click(c, x, y, n=1):
    x, y = float(x), float(y)
    c.cmd('Page.bringToFront')
    c.cmd('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    for t in ('mousePressed', 'mouseReleased'):
        c.cmd('Input.dispatchMouseEvent', {
            'type': t, 'x': x, 'y': y, 'button': 'left',
            'buttons': 1 if t == 'mousePressed' else 0, 'clickCount': n,
        })
        time.sleep(0.05)
    time.sleep(0.25)


def journal_write(path: Path, event: str, **kw):
    rec = {'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'event': event, **kw}
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        f.flush()


def wait_url(c, needle: str, timeout_s=20) -> str:
    t0 = time.time()
    href = ev(c, 'location.href') or ''
    while time.time() - t0 < timeout_s:
        href = ev(c, 'location.href') or ''
        ready = ev(c, 'document.readyState')
        if needle in href and ready == 'complete':
            time.sleep(1.2)
            return href
        time.sleep(0.5)
    return href


def reload_fresh(c, needle: str, timeout_s=25) -> str:
    """Page.reload is async; wait_url can return on the OLD document.
    Marker on window dies with the document, so None means a new page."""
    ev(c, 'window.__SUNO_NAV=1')
    c.cmd('Page.reload', {'ignoreCache': True})
    t0 = time.time()
    href = ev(c, 'location.href') or ''
    while time.time() - t0 < timeout_s:
        marker = ev(c, 'window.__SUNO_NAV')
        ready = ev(c, 'document.readyState')
        href = ev(c, 'location.href') or ''
        if marker in (None, 'null') and ready == 'complete' and needle in href:
            time.sleep(1.2)
            return href
        time.sleep(0.3)
    return href


def play_song(c) -> dict | None:
    """Do not click Play if already playing (that would pause)."""
    paused = ev(c, '''(()=>{
      const a=[...document.querySelectorAll('audio')].find(x=>x.duration>3);
      return a ? (a.paused ? 'paused' : 'playing') : 'none';
    })()''')
    if paused == 'playing':
        return {'t': 'already-playing'}
    pos = click_pred(
        c,
        "[...document.querySelectorAll('button')].find(b=>"
        "(b.getAttribute('aria-label')||'')==='Playbar: Play button')",
    )
    if pos:
        return pos
    return click_pred(
        c,
        "[...document.querySelectorAll('button')].find(b=>{"
        "const t=(b.innerText||'').trim(); const r=b.getBoundingClientRect();"
        "return t==='Play' && r.width>=50 && r.y>250 && r.y<400;})",
    )


def goto(c, url: str) -> str:
    c.cmd('Page.navigate', {'url': url})
    return wait_url(c, 'suno.com', 25)


def find_clickable(c, pred_js: str):
    raw = ev(c, f'''(()=>{{
      const vis=el=>{{const r=el.getBoundingClientRect();
        return r.width>2 && r.height>2;}};
      const txt=el=>((el.getAttribute('aria-label')||'')+' '+(el.innerText||''))
        .replace(/\\s+/g,' ').trim();
      const el={pred_js};
      if(!el) return null;
      const t=txt(el);
      if(/buy credits|buy downloads|earn credits|upgrade|premier plan|acheter|abonnement/i.test(t))
        return 'COMMERCE';
      const r=el.getBoundingClientRect();
      return JSON.stringify({{t:t.slice(0,80), x:r.x+r.width/2, y:r.y+r.height/2,
        w:r.width, h:r.height, dis:!!el.disabled,
        ariaDis:el.getAttribute('aria-disabled')}});
    }})()''')
    if raw == 'COMMERCE':
        raise RuntimeError('refus de cliquer un libellé d\'achat/abonnement')
    if raw in (None, 'null', 'NOEL'):
        return None
    return json.loads(raw)


def click_pred(c, pred_js: str) -> dict | None:
    pos = find_clickable(c, pred_js)
    if not pos:
        return None
    trusted_click(c, pos['x'], pos['y'])
    return pos


def native_set_value(c, find_js: str, value: str) -> bool:
    payload = json.dumps(value)
    raw = ev(c, f'''(()=>{{
      const el={find_js};
      if(!el) return 'NOEL';
      el.focus();
      const proto = el.tagName==='TEXTAREA'
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc=Object.getOwnPropertyDescriptor(proto,'value');
      if(desc && desc.set) desc.set.call(el, {payload});
      else el.value={payload};
      el.dispatchEvent(new Event('input',{{bubbles:true}}));
      el.dispatchEvent(new Event('change',{{bubbles:true}}));
      return JSON.stringify({{len:(el.value||'').length, head:(el.value||'').slice(0,40)}});
    }})()''')
    return raw not in (None, 'NOEL', 'null')


def page_fetch_json(c, url: str, timeout_s=25):
    js = f'''(async()=>{{
      const token = await window.Clerk.session.getToken();
      const r = await fetch({json.dumps(url)}, {{
        credentials:'include',
        headers: {{Authorization:'Bearer '+token}}
      }});
      const t = await r.text();
      return JSON.stringify({{status:r.status, body:t}});
    }})()'''
    res = c.cmd('Runtime.evaluate', {
        'expression': js, 'awaitPromise': True, 'returnByValue': True,
    }, to=timeout_s)
    raw = ((res or {}).get('result') or {}).get('result', {}).get('value')
    if not raw:
        return None
    parsed = json.loads(raw)
    if parsed.get('status') != 200:
        return None
    try:
        return json.loads(parsed['body'])
    except json.JSONDecodeError:
        return None


def read_billing(c) -> dict:
    data = page_fetch_json(c, 'https://studio-api.prod.suno.com/api/billing/info/')
    if not data:
        data = page_fetch_json(c, 'https://studio-api-prod.suno.com/api/billing/info/')
    return data or {}


def read_credits(c) -> int | None:
    bill = read_billing(c)
    for key in ('total_credits_left', 'credits_remaining', 'credits'):
        val = bill.get(key)
        if isinstance(val, (int, float)) and (key != 'credits' or val > 0):
            return int(val)
    usage = bill.get('monthly_usage')
    limit = bill.get('monthly_limit')
    if isinstance(usage, (int, float)) and isinstance(limit, (int, float)):
        return int(limit) - int(usage)
    return None


def read_download_quota(c) -> int | None:
    bill = read_billing(c)
    du = bill.get('download_usage') or {}
    used = du.get('current_period_downloads_used')
    limit = du.get('current_period_downloads_limit')
    extra = du.get('additional_download_remaining') or 0
    if isinstance(used, (int, float)) and isinstance(limit, (int, float)):
        return int(limit) - int(used) + int(extra or 0)
    return None


def feed_clips(c, page: int = 0) -> list[dict]:
    data = page_fetch_json(
        c, f'https://studio-api.prod.suno.com/api/feed/v2?page={int(page)}')
    if not data:
        return []
    if isinstance(data, list):
        return data
    return list(data.get('clips') or [])


def clip_ids(clips: list[dict]) -> set[str]:
    return {str(cl.get('id')) for cl in clips if cl.get('id')}


def dismiss_overlays(c) -> None:
    esc(c, 2)
    click_pred(
        c,
        "[...document.querySelectorAll('button')].find(b=>{"
        "const t=(b.getAttribute('aria-label')||'').trim();"
        "const r=b.getBoundingClientRect();"
        "return t==='Close' && r.y>450 && r.y<620 && r.width<50;})",
    )


def ensure_create(c) -> None:
    href = ev(c, 'location.href') or ''
    if '/create' not in href:
        goto(c, 'https://suno.com/create')
        time.sleep(1.5)
    dismiss_overlays(c)


def ensure_advanced(c) -> bool:
    tab = find_clickable(
        c,
        "[...document.querySelectorAll('[role=tab]')].find("
        "e=>/^Advanced$/i.test((e.getAttribute('aria-label')||'').trim())"
        "||/^Advanced$/i.test((e.innerText||'').trim().split('\\n')[0]))",
    )
    if not tab:
        return False
    selected = ev(c, '''(()=>{
      const e=[...document.querySelectorAll('[role=tab]')].find(
        x=>/Advanced/i.test(x.getAttribute('aria-label')||x.innerText||''));
      return e?e.getAttribute('aria-selected'):'';
    })()''')
    if selected == 'true':
        return True
    trusted_click(c, tab['x'], tab['y'])
    time.sleep(0.8)
    return True


def set_instrumental(c, wanted: bool) -> bool:
    pos = find_clickable(
        c,
        "[...document.querySelectorAll('button')].find(e=>"
        "/instrumental only song/i.test(e.getAttribute('aria-label')||''))",
    )
    if not pos:
        return False
    state = ev(c, '''(()=>{
      const e=[...document.querySelectorAll('button')].find(b=>
        /instrumental only song/i.test(b.getAttribute('aria-label')||''));
      if(!e) return '';
      return (e.getAttribute('aria-pressed')||e.getAttribute('aria-checked')
        ||e.getAttribute('data-state')|| (e.getAttribute('class')||''));
    })()''') or ''
    on = bool(re.search(r'\b(true|on|checked|active)\b', str(state), re.I))
    if on == wanted:
        return True
    trusted_click(c, pos['x'], pos['y'])
    time.sleep(0.5)
    return True


def set_style(c, style: str) -> bool:
    ok = native_set_value(
        c,
        "[...document.querySelectorAll('textarea')].find(t=>{"
        "const r=t.getBoundingClientRect();"
        "return r.width>200 && r.height>40 && r.y>400 && r.y<900"
        " && /125 bpm|describe the sound|style of music|future pop/i.test(t.placeholder||'');})",
        style,
    )
    if ok:
        return True
    return native_set_value(
        c,
        "[...document.querySelectorAll('textarea')].find(t=>{"
        "const r=t.getBoundingClientRect();"
        "return r.width>200 && r.height>60 && r.y>500;})",
        style,
    )


def set_title(c, title: str) -> bool:
    pos = find_clickable(
        c,
        "[...document.querySelectorAll('input[type=text]')].find(t=>{"
        "const r=t.getBoundingClientRect();"
        "return r.width>100 && r.y<200 && /song title/i.test(t.placeholder||'');})",
    )
    if pos:
        trusted_click(c, pos['x'], pos['y'], n=3)
        time.sleep(0.1)
        for t in ('keyDown', 'keyUp'):
            c.cmd('Input.dispatchKeyEvent', {
                'type': t, 'key': 'a', 'code': 'KeyA',
                'windowsVirtualKeyCode': 65, 'modifiers': 2,
            })
        time.sleep(0.05)
        c.cmd('Input.insertText', {'text': title})
        time.sleep(0.2)
    return native_set_value(
        c,
        "[...document.querySelectorAll('input[type=text]')].find(t=>{"
        "const r=t.getBoundingClientRect();"
        "return r.width>100 && /song title/i.test(t.placeholder||'');})",
        title,
    )


def set_lyrics(c, lyrics: str) -> bool:
    payload = json.dumps(lyrics)
    raw = ev(c, f'''(()=>{{
      const el=document.querySelector('.lyrics-editor-content');
      if(!el) return 'NOEL';
      el.focus();
      el.innerHTML='';
      const ok=document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, {payload});
      el.dispatchEvent(new InputEvent('input',{{bubbles:true, data:{payload}}}));
      return JSON.stringify({{len:(el.innerText||'').length,
        head:(el.innerText||'').slice(0,40)}});
    }})()''')
    return raw not in (None, 'NOEL', 'null')


def set_duration(c, secs: int | None) -> bool:
    if not secs:
        return True
    ev(c, '''(()=>{
      const e=[...document.querySelectorAll('button')].find(
        b=>/^Custom$/i.test((b.innerText||'').trim()));
      if(e) e.scrollIntoView({block:'center'});
      return !!e;
    })()''')
    time.sleep(0.3)
    click_pred(
        c,
        "[...document.querySelectorAll('button')].find("
        "b=>/^Custom$/i.test((b.innerText||'').trim())"
        " && b.getBoundingClientRect().width<90)",
    )
    time.sleep(0.5)
    return native_set_value(
        c,
        "[...document.querySelectorAll('input[type=number]')].find(t=>{"
        "const r=t.getBoundingClientRect();"
        "return r.width>30 && r.width<120"
        " && /auto|sec|duration/i.test((t.placeholder||'')+(t.getAttribute('aria-label')||''));})",
        str(int(secs)),
    )


def set_persona(c, name: str) -> bool:
    if not name:
        return True
    opened = click_pred(
        c,
        "[...document.querySelectorAll('button')].find("
        "b=>(b.getAttribute('aria-label')||'')==='Add Voice')",
    )
    if not opened:
        return False
    time.sleep(1.2)
    hit = click_pred(
        c,
        f"[...document.querySelectorAll('button,[role=option],[role=menuitem]')].find("
        f"e=>new RegExp({json.dumps(name)},'i').test((e.innerText||'')+' '+(e.getAttribute('aria-label')||''))"
        f" && e.getBoundingClientRect().width>20)",
    )
    if not hit:
        # Select clip fallback (persona card)
        hit = click_pred(
            c,
            "[...document.querySelectorAll('button')].find("
            "b=>/select clip/i.test((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')))",
        )
    time.sleep(0.6)
    esc(c, 1)
    return hit is not None


def create_button(c) -> dict | None:
    return find_clickable(
        c,
        "[...document.querySelectorAll('button')].find(b=>{"
        "const t=(b.getAttribute('aria-label')||'')+' '+(b.innerText||'');"
        "const r=b.getBoundingClientRect();"
        "return /create song/i.test(t) && r.width>200 && r.y>400;})",
    )


def generate_trusted(c) -> bool:
    btn = None
    for _ in range(16):
        btn = create_button(c)
        if btn and not btn.get('dis') and btn.get('ariaDis') != 'true':
            break
        time.sleep(0.4)
    else:
        return False
    if is_forbidden_commerce_text(btn.get('t')):
        raise RuntimeError('refus de cliquer Create (libellé commerce)')
    trusted_click(c, btn['x'], btn['y'])
    time.sleep(1.5)
    return True


def wait_new_clips(c, before_ids: set[str], want: int = 2,
                   timeout_s: int = CLIP_WAIT_S) -> list[dict]:
    t0 = time.time()
    found: list[dict] = []
    while time.time() - t0 < timeout_s:
        clips = feed_clips(c)
        fresh = [
            cl for cl in clips
            if str(cl.get('id')) not in before_ids
            and (cl.get('status') or '') in ('complete', 'streaming', 'queued', 'submitted')
        ]
        complete = [cl for cl in fresh if cl.get('status') == 'complete']
        print(
            f'    wait +{int(time.time()-t0)}s fresh={len(fresh)} '
            f'complete={len(complete)}',
            flush=True,
        )
        if len(complete) >= want:
            return complete[:want]
        found = complete
        time.sleep(6)
    return found


def set_download_dir(c, path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    dest = str(path)
    c.cmd('Browser.setDownloadBehavior', {
        'behavior': 'allow', 'downloadPath': dest, 'eventsEnabled': True,
    })
    c.cmd('Page.setDownloadBehavior', {
        'behavior': 'allow', 'downloadPath': dest,
    })


def restore_download_dir(c) -> None:
    """Browser.setDownloadBehavior is process-wide — don't leave Flow/Dreamina
    downloading into the Suno folder."""
    dest = os.path.expanduser('~/Downloads')
    c.cmd('Browser.setDownloadBehavior', {
        'behavior': 'allow', 'downloadPath': dest, 'eventsEnabled': True,
    })


def reset_mse_capture(c) -> None:
    ev(c, '''(()=>{
      window.__SUNO_CAPTURE = false;
      for (const a of document.querySelectorAll('audio,video')) {
        try { a.pause(); } catch (e) {}
      }
      window.__SUNO_SB__ = {chunks:[], n:0, bytes:0};
      return 1;
    })()''')
    ev(c, MSE_HOOK)


def arm_mse_capture(c) -> None:
    ev(c, '''(()=>{
      window.__SUNO_SB__ = {chunks:[], n:0, bytes:0};
      window.__SUNO_CAPTURE = true;
      return 1;
    })()''')


def duration_plausible(got_s: float | None, expected_s: float | None) -> bool:
    if not got_s or got_s < 5:
        return False
    if not expected_s or expected_s < 8:
        return True
    # Player duration can exceed API metadata (~20–30 %); leftover concat is ~2×.
    return expected_s * 0.70 <= got_s <= expected_s * 1.45


def clip_ids_from_journal(journal: Path, name: str) -> list[str]:
    if not journal.exists():
        return []
    ids: list[str] = []
    for line in journal.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get('name') == name and rec.get('clip_ids'):
            ids = [str(x) for x in rec['clip_ids'] if x]
    return ids


def snapshot_audio(dir_path: Path) -> set[str]:
    if not dir_path.exists():
        return set()
    return {
        p.name for p in dir_path.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXT
    }


def wait_new_audio(dir_path: Path, before: set[str],
                   timeout_s: int = DOWNLOAD_WAIT_S) -> Path | None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        now = snapshot_audio(dir_path)
        fresh = [dir_path / n for n in sorted(now - before)]
        ready = [
            p for p in fresh
            if p.stat().st_size > 20_000 and not p.name.endswith('.crdownload')
        ]
        if ready:
            return max(ready, key=lambda p: p.stat().st_mtime)
        time.sleep(0.8)
    return None


def wait_mse_buffer(c, timeout_s: int = 120) -> dict:
    """Play at 16x so SourceBuffer receives the full decrypted clip."""
    t0 = time.time()
    last_bytes = -1
    stable = 0
    info: dict = {}
    while time.time() - t0 < timeout_s:
        raw = ev(c, '''(()=>{
          const a=[...document.querySelectorAll('audio')].find(x=>x.duration>5);
          const h=window.__SUNO_SB__||{bytes:0,n:0};
          let covered=0, t=0;
          if(a){
            try{
              for(let i=0;i<a.buffered.length;i++)
                covered += a.buffered.end(i)-a.buffered.start(i);
            }catch(e){}
            try{ a.muted=true; a.playbackRate=16; }catch(e){}
            if(a.paused) a.play().catch(()=>{});
            t=a.currentTime||0;
          }
          return JSON.stringify({bytes:h.bytes,n:h.n,dur:a?a.duration:0,
            covered:covered, t:t, paused:a?a.paused:true, ended:a?a.ended:false});
        })()''')
        try:
            info = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            info = {}
        b = int(info.get('bytes') or 0)
        dur = float(info.get('dur') or 0)
        covered = float(info.get('covered') or 0)
        cur = float(info.get('t') or 0)
        if b == last_bytes and b > 80_000:
            stable += 1
        else:
            stable = 0
        last_bytes = b
        if dur > 10 and (covered >= dur * 0.92 or cur >= dur * 0.92 or info.get('ended')):
            if stable >= 1 or covered >= dur * 0.92:
                break
        # fMP4 decrypted in one go — but a bytes plateau with low coverage
        # is a false end (intro only). Require real coverage or a full-size buffer.
        if (
            dur > 10
            and covered >= dur * 0.80
            and b > max(1_500_000, dur * 8000)
            and stable >= 2
        ):
            break
        if dur > 10 and b > max(4_000_000, dur * 20000) and stable >= 5:
            break
        if info.get('paused') and int(time.time() - t0) % 8 == 0:
            play_song(c)
        time.sleep(1.0)
    return info


def ev_async(c, js, to=30):
    res = c.cmd('Runtime.evaluate', {
        'expression': js, 'awaitPromise': True, 'returnByValue': True,
    }, to=to)
    return ((res or {}).get('result') or {}).get('result', {}).get('value')


def trigger_mse_download(c, filename: str) -> bool:
    """Rebuild captured MSE fragments and click <a download> (no Suno quota)."""
    raw = ev(c, f'''(()=>{{
      const h=window.__SUNO_SB__;
      if(!h || !h.chunks || h.bytes<20000) return JSON.stringify({{ok:false, bytes:h?h.bytes:0}});
      const blob=new Blob(h.chunks, {{type:'audio/mp4'}});
      window.__SUNO_MSE_BLOB = blob;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download={json.dumps(filename)};
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>a.remove(), 2000);
      return JSON.stringify({{ok:true, bytes:h.bytes, n:h.n}});
    }})()''', to=60)
    if not raw:
        return False
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        return False
    return bool(info.get('ok'))


def mse_dump_to_path(c, dest: Path) -> Path | None:
    """Fallback: pull the in-page Blob over CDP as base64 chunks (no download manager)."""
    import base64
    n = ev_async(c, '''(async()=>{
      if(!window.__SUNO_MSE_BLOB){
        const h=window.__SUNO_SB__;
        if(!h||!h.chunks||h.bytes<20000) return 0;
        window.__SUNO_MSE_BLOB=new Blob(h.chunks,{type:'audio/mp4'});
      }
      const buf=await window.__SUNO_MSE_BLOB.arrayBuffer();
      window.__SUNO_MSE_U8=new Uint8Array(buf);
      return window.__SUNO_MSE_U8.byteLength;
    })()''', to=60)
    try:
        total = int(n or 0)
    except (TypeError, ValueError):
        total = 0
    if total < 20_000:
        return None
    chunk = 196608
    offset = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + '.part')
    with open(tmp, 'wb') as f:
        while offset < total:
            b64 = ev(c, f'''(()=>{{
              const u=window.__SUNO_MSE_U8;
              if(!u) return '';
              const sl=u.subarray({offset}, {offset + chunk});
              let s='';
              for(let i=0;i<sl.length;i++) s+=String.fromCharCode(sl[i]);
              return btoa(s);
            }})()''', to=30)
            if not b64:
                break
            data = base64.b64decode(b64)
            if not data:
                break
            f.write(data)
            offset += len(data)
            if len(data) < chunk:
                break
    if tmp.exists() and tmp.stat().st_size > 20_000:
        tmp.replace(dest)
        print(f'    mse dump {dest.name} {dest.stat().st_size//1024} Ko', flush=True)
        return dest
    try:
        tmp.unlink()
    except OSError:
        pass
    return None


def official_download(c) -> bool:
    # Do not click Play here: if MSE is playing, that pauses the buffer.
    more = click_pred(
        c,
        '''(()=>{
          const share=[...document.querySelectorAll('button')].find(
            b=>(b.getAttribute('aria-label')||'')==='Playbar: Share');
          const cands=[...document.querySelectorAll('button')].filter(b=>
            (b.getAttribute('aria-label')||'')==='More menu contents');
          if(share){
            const sr=share.getBoundingClientRect();
            const near=cands.find(b=>{
              const r=b.getBoundingClientRect();
              return Math.abs(r.y-sr.y)<24 && r.x>sr.x-10 && r.x<sr.x+140;
            });
            if(near) return near;
          }
          const bottom=cands.filter(b=>b.getBoundingClientRect().y>800);
          return bottom[0]||cands[0]||null;
        })()''',
    )
    time.sleep(0.8)
    dl = click_pred(
        c,
        "[...document.querySelectorAll('button')].find(b=>{"
        "const t=((b.getAttribute('aria-label')||'')+' '+(b.innerText||'')).trim();"
        "const r=b.getBoundingClientRect();"
        "return /^Download(\\s+Download)?$/i.test(t) && r.width>80 && r.y>400;})",
    )
    if not dl:
        return False
    time.sleep(1.0)
    fmt = click_pred(
        c,
        "[...document.querySelectorAll('button')].find(b=>{"
        "const t=(b.innerText||'').trim();"
        "const r=b.getBoundingClientRect();"
        "return /^WAV$/i.test(t) && r.width>80;})",
    )
    if not fmt:
        fmt = click_pred(
            c,
            "[...document.querySelectorAll('button')].find(b=>{"
            "const t=(b.innerText||'').trim();"
            "return /^MP3$/i.test(t) && b.getBoundingClientRect().width>80;})",
        )
    if not fmt:
        fmt = click_pred(
            c,
            "[...document.querySelectorAll('button')].find(b=>{"
            "const t=(b.innerText||'').trim();"
            "return /^M4A$/i.test(t) && b.getBoundingClientRect().width>80;})",
        )
    time.sleep(0.6)
    unlock = find_clickable(
        c,
        "[...document.querySelectorAll('button')].find(b=>"
        "/unlock/i.test((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')))",
    )
    if unlock and not is_forbidden_commerce_text(unlock.get('t')):
        if not re.search(r'buy|purchase|upgrade', unlock.get('t') or '', re.I):
            trusted_click(c, unlock['x'], unlock['y'])
            time.sleep(1.0)
    return fmt is not None or unlock is not None


def ffprobe_duration(path: Path) -> float | None:
    import subprocess
    try:
        raw = subprocess.check_output(
            [
                'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                '-of', 'default=nw=1:nk=1', str(path),
            ],
            text=True, timeout=30,
        ).strip()
        return float(raw) if raw else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def download_clip(c, clip_id: str, dest: Path,
                  expected_dur: float | None = None) -> Path | None:
    outdir = dest.parent
    set_download_dir(c, outdir)
    try:
        before = snapshot_audio(outdir)
        reset_mse_capture(c)  # capture OFF before navigation so the previous take cannot leak
        goto(c, f'https://suno.com/song/{clip_id}')
        wait_url(c, clip_id, 20)
        reload_fresh(c, clip_id, 25)
        time.sleep(0.8)
        reset_mse_capture(c)
        time.sleep(0.3)
        # Arm BEFORE Play so the fMP4 init segment is in the dump.
        arm_mse_capture(c)
        play_song(c)
        buf = wait_mse_buffer(c, timeout_s=150)
        print(f'    mse bytes={buf.get("bytes")} covered={buf.get("covered")}/{buf.get("dur")}',
              flush=True)
        mse_name = dest.stem + '.m4a'
        player_dur = float(buf.get('dur') or 0)
        meta_dur = float(expected_dur or 0)
        leftover = bool(meta_dur >= 8 and player_dur > meta_dur * 1.6)
        suno_dur = player_dur if player_dur >= 8 and not leftover else meta_dur
        got = None
        if leftover:
            print(f'    player {player_dur:.1f}s >> meta {meta_dur:.1f}s (reste MSE), dump quand même',
                  flush=True)
        if trigger_mse_download(c, mse_name):
            got = wait_new_audio(outdir, before, timeout_s=30)
        if not got:
            dump_dest = dest.with_suffix('.m4a')
            got = mse_dump_to_path(c, dump_dest)
        if got:
            dur = ffprobe_duration(got) or 0
            if duration_plausible(dur, suno_dur) or (
                duration_plausible(dur, meta_dur) if meta_dur else False
            ):
                final = dest.with_suffix(got.suffix)
                if got != final:
                    got.replace(final)
                return final
            print(
                f'    mse durée {dur:.1f}s vs ref {suno_dur:.1f}s/meta {meta_dur:.1f}s, repli officiel',
                flush=True,
            )
            try:
                got.unlink()
            except OSError:
                pass
        before2 = snapshot_audio(outdir)
        if official_download(c):
            got = wait_new_audio(outdir, before2, timeout_s=DOWNLOAD_WAIT_S)
            if got:
                dur = ffprobe_duration(got) or 0
                if duration_plausible(dur, suno_dur) or not suno_dur:
                    final = dest.with_suffix(got.suffix)
                    if got != final:
                        got.replace(final)
                    esc(c, 2)
                    return final
                print(f'    officiel durée {dur:.1f}s vs suno {suno_dur:.1f}s, rejeté',
                      flush=True)
                try:
                    got.unlink()
                except OSError:
                    pass
        esc(c, 2)
        return None
    finally:
        restore_download_dir(c)


def write_sidecar(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run_job(c, job: dict, *, outdir: Path, journal: Path,
            min_credits: int, allow_vocals: bool) -> dict:
    name = slugify(str(job.get('name') or job.get('title')))
    title = str(job.get('title') or job.get('name'))
    style = str(job['style'])
    instrumental = bool(job.get('instrumental', True))
    lyrics = (job.get('lyrics') or '').strip()
    persona = (job.get('persona') or '').strip()
    duration_sec = job.get('duration_sec')
    result = {
        'name': name, 'title': title, 'ok': False, 'instrumental': instrumental,
        'files': [],
    }

    err = validate_job(job, allow_vocals=allow_vocals)
    if err:
        result['error'] = err
        journal_write(journal, 'job_refused', name=name, reason=err)
        return result

    existing = list(job.get('existing_ids') or [])
    if not existing:
        existing = clip_ids_from_journal(journal, name)

    def _good_take(i: int, expected: float | None = None) -> Path | None:
        sidecar = outdir / f'{name}-{i}.json'
        exp = expected
        if sidecar.exists():
            try:
                meta = json.loads(sidecar.read_text(encoding='utf-8'))
                exp = exp or meta.get('suno_duration')
            except json.JSONDecodeError:
                pass
        found = next(
            (p for p in outdir.glob(f'{name}-{i}.*')
             if p.suffix.lower() in AUDIO_EXT and p.stat().st_size > 20_000),
            None,
        )
        if not found:
            return None
        dur = ffprobe_duration(found)
        exp_f = float(exp) if exp else None
        if duration_plausible(dur, exp_f):
            return found
        # Beds: keep an existing long take rather than looping redownload.
        # Jingles (≤30 s expected): reject a polluted 2–3 min file.
        if exp_f and exp_f <= 30 and dur and dur > 45:
            print(f'    {found.name} durée {dur} vs jingle {exp}, à retélécharger',
                  flush=True)
            return None
        if dur and dur > 20 and (not exp_f or exp_f >= 60):
            return found
        print(f'    {found.name} durée {dur} vs suno {exp}, à retélécharger',
              flush=True)
        return None

    if existing:
        files = []
        for i, cid in enumerate(existing[:2], start=1):
            good = _good_take(i)
            if good:
                files.append(str(good))
                continue
            dest = outdir / f'{name}-{i}.wav'
            print(f'    redownload {name}-{i} {cid}', flush=True)
            got = download_clip(c, str(cid), dest)
            if got:
                files.append(str(got))
        result['ok'] = len(files) >= 1
        result['files'] = files
        result['clip_ids'] = existing[:2]
        result['skipped_generate'] = True
        journal_write(journal, 'job_done' if result['ok'] else 'job_fail',
                      name=name, files=files, clip_ids=existing[:2],
                      skipped_generate=True)
        return result

    existing_audio = [_good_take(i) for i in (1, 2)]
    existing_audio = [p for p in existing_audio if p]
    if len(existing_audio) >= 2:
        print(f'[{name}] déjà fait, skip', flush=True)
        result['ok'] = True
        result['skipped'] = True
        result['files'] = [str(p) for p in existing_audio]
        return result

    ensure_create(c)
    ensure_advanced(c)
    before_ids = clip_ids(feed_clips(c))
    credits_before = read_credits(c)
    result['credits_before'] = credits_before
    journal_write(journal, 'job_start', name=name, title=title,
                  credits_before=credits_before, style=style[:200])
    if credits_before is not None and credits_before < min_credits:
        print(f'[{name}] STOP solde {credits_before} < {min_credits}', flush=True)
        journal_write(journal, 'stop_low_balance', name=name,
                      credits=credits_before, min_credits=min_credits)
        result['stop'] = True
        return result
    if credits_before is not None and credits_before < CREATE_COST:
        result['stop'] = True
        result['error'] = 'solde insuffisant pour 1 generate'
        return result

    print(f'[{name}] {title!r} instrumental={instrumental} solde={credits_before}',
          flush=True)
    set_instrumental(c, instrumental)
    if not set_style(c, style):
        journal_write(journal, 'style_fail', name=name)
        result['error'] = 'style non collé'
        return result
    set_title(c, title)
    if lyrics:
        if not set_lyrics(c, lyrics):
            journal_write(journal, 'lyrics_fail', name=name)
            result['error'] = 'paroles non collées'
            return result
    if persona:
        if not set_persona(c, persona):
            journal_write(journal, 'persona_fail', name=name, persona=persona)
            result['error'] = f'persona {persona!r} non sélectionnée — pas de create chanté sans Voice'
            return result
    if duration_sec:
        set_duration(c, int(duration_sec))
    time.sleep(0.6)

    if not generate_trusted(c):
        journal_write(journal, 'no_generate', name=name)
        result['error'] = 'Create song indisponible (disabled ?)'
        return result

    clips = wait_new_clips(c, before_ids, want=2, timeout_s=CLIP_WAIT_S)
    credits_after = read_credits(c)
    result['credits_after'] = credits_after
    result['clip_ids'] = [cl.get('id') for cl in clips]
    if len(clips) < 2:
        print(f'[{name}] {len(clips)}/2 cartes  solde {credits_before}→{credits_after}',
              flush=True)
        journal_write(journal, 'job_incomplete', name=name, n=len(clips),
                      credits_before=credits_before, credits_after=credits_after)
        # still try to download what we have

    files = []
    for i, cl in enumerate(clips[:2], start=1):
        cid = str(cl.get('id'))
        dest = outdir / f'{name}-{i}.wav'
        meta = cl.get('metadata') or {}
        got = download_clip(c, cid, dest, expected_dur=meta.get('duration'))
        dur = None
        if got:
            dur = ffprobe_duration(got)
            sidecar = {
                'name': name,
                'title': title,
                'style': style,
                'instrumental': instrumental,
                'clip_id': cid,
                'suno_duration': meta.get('duration'),
                'ffprobe_duration': dur,
                'credits_before': credits_before,
                'credits_after': credits_after,
                'file': str(got),
                'bytes': got.stat().st_size,
                'usage': job.get('usage'),
                'model': cl.get('model_name') or cl.get('major_model_version'),
            }
            write_sidecar(got.with_suffix('.json'), sidecar)
            files.append(str(got))
            print(f'    -> {got.name} {got.stat().st_size//1024} Ko dur={dur}', flush=True)
        else:
            print(f'    download KO clip {cid}', flush=True)
            write_sidecar(outdir / f'{name}-{i}.json', {
                'name': name, 'title': title, 'style': style,
                'clip_id': cid, 'download': None,
                'credits_before': credits_before, 'credits_after': credits_after,
            })

    result['files'] = files
    result['ok'] = len(files) >= 1
    journal_write(journal, 'job_done' if result['ok'] else 'job_fail',
                  name=name, files=files, clip_ids=result.get('clip_ids'),
                  credits_before=credits_before, credits_after=credits_after)
    ensure_create(c)
    return result


def redownload_from_journal(c, journal: Path, outdir: Path) -> int:
    """Download missing takes from clip_ids already logged (0 crédit generate)."""
    n = 0
    if not journal.exists():
        return 0
    for line in journal.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get('event') not in ('job_done', 'job_fail', 'job_incomplete'):
            continue
        name = rec.get('name')
        ids = rec.get('clip_ids') or []
        if not name or not ids:
            continue
        for i, cid in enumerate(ids[:2], start=1):
            if not cid:
                continue
            already = next(
                (p for p in outdir.glob(f'{name}-{i}.*')
                 if p.suffix.lower() in AUDIO_EXT and p.stat().st_size > 20_000),
                None,
            )
            sidecar = outdir / f'{name}-{i}.json'
            expected = None
            if sidecar.exists():
                try:
                    expected = json.loads(sidecar.read_text(encoding='utf-8')).get(
                        'suno_duration')
                except json.JSONDecodeError:
                    expected = None
            if already and duration_plausible(ffprobe_duration(already), expected):
                continue
            dest = outdir / f'{name}-{i}.wav'
            print(f'[redownload] {name}-{i} {cid}', flush=True)
            got = download_clip(c, str(cid), dest, expected_dur=expected)
            if got:
                n += 1
                print(f'    -> {got}', flush=True)
            else:
                print('    KO', flush=True)
    return n


def parse_args(argv=None):
    p = argparse.ArgumentParser(description='Batch Suno Pro (onglet CDP suno.com uniquement)')
    p.add_argument('jobs', nargs='?', help='JSON jobs (sinon stdin)')
    p.add_argument('--outdir', required=True)
    p.add_argument('--min-credits', type=int, default=320,
                   help='Arrêt propre si le solde passe sous ce seuil (défaut 320 = réserve Jade)')
    p.add_argument('--journal', default=None)
    p.add_argument('--allow-vocals', action='store_true',
                   help='Autorise paroles + persona (Jade). Défaut : instrumental only.')
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--redownload-journal', action='store_true',
                   help='Ne génère pas : retélécharge les clip_ids du journal')
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    outdir = Path(args.outdir).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    journal = Path(args.journal).expanduser() if args.journal else (outdir / 'suno-journal.jsonl')

    if args.redownload_journal:
        c = conn()
        n = redownload_from_journal(c, journal, outdir)
        print(f'=== redownload {n} fichiers ===')
        return

    if args.jobs:
        jobs = json.loads(Path(args.jobs).read_text(encoding='utf-8'))
    else:
        jobs = json.load(sys.stdin)
    if not isinstance(jobs, list):
        raise SystemExit('jobs.json doit être une liste')
    if args.limit:
        jobs = jobs[: args.limit]

    c = conn()
    ensure_create(c)
    esc(c, 2)
    done = []
    for j in jobs:
        r = run_job(
            c, j, outdir=outdir, journal=journal,
            min_credits=args.min_credits, allow_vocals=args.allow_vocals,
        )
        if r.get('ok'):
            done.append(r)
        if r.get('stop'):
            print('=== ARRÊT PROPRE (solde) ===', flush=True)
            break
        time.sleep(2)
    print(f'\n=== TERMINÉ : {len(done)}/{len(jobs)} jobs ===')
    for d in done:
        for f in d.get('files') or []:
            print(' ', f)


if __name__ == '__main__':
    main()
