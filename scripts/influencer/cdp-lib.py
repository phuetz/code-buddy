import json, urllib.request, socket, base64, os, struct, time
def get_tab(match=('epidemicsound','accounts.google','login.epidemic')):
    tabs=[t for t in json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list',timeout=5)) if t.get('type')=='page']
    return next((t for t in tabs if any(m in t.get('url','') for m in match)), None)
class CDP:
    def __init__(self, tab):
        path=tab['webSocketDebuggerUrl'].split('9222',1)[1]
        self.s=socket.create_connection(('127.0.0.1',9222),timeout=10)
        self.s.settimeout(180)
        key=base64.b64encode(os.urandom(16)).decode()
        self.s.send((f'GET {path} HTTP/1.1\r\nHost:127.0.0.1:9222\r\nUpgrade:websocket\r\nConnection:Upgrade\r\nSec-WebSocket-Key:{key}\r\nSec-WebSocket-Version:13\r\n\r\n').encode())
        assert b'101' in self.s.recv(4096)
        self.mid=0
    def _send(self,o):
        d=json.dumps(o).encode();h=bytearray([0x81]);n=len(d);m=os.urandom(4)
        if n<126:h.append(0x80|n)
        elif n<65536:h.append(0x80|126);h+=struct.pack('>H',n)
        else:h.append(0x80|127);h+=struct.pack('>Q',n)
        h+=m;self.s.send(bytes(h)+bytes(b^m[i%4] for i,b in enumerate(d)))
    def _recv(self):
        def rd(n):
            b=b''
            while len(b)<n:b+=self.s.recv(n-len(b))
            return b
        hh=rd(2);ln=hh[1]&0x7f
        if ln==126:ln=struct.unpack('>H',rd(2))[0]
        elif ln==127:ln=struct.unpack('>Q',rd(8))[0]
        return json.loads(rd(ln).decode())
    def cmd(self,method,params=None,to=25):
        self.mid+=1;my=self.mid;self._send({'id':my,'method':method,'params':params or {}})
        t0=time.time()
        while time.time()-t0<to:
            m=self._recv()
            if m.get('id')==my:return m
        return None
    def ev(self,expr,to=25):
        r=self.cmd('Runtime.evaluate',{'expression':expr,'returnByValue':True},to)
        return (r or {}).get('result',{}).get('result',{}).get('value')

if __name__=='__main__':
    tab=get_tab()
    c=CDP(tab); c.cmd('Runtime.enable'); c.cmd('Page.enable')
    # autoriser téléchargements vers ~/Downloads
    c.cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':os.path.expanduser('~/Downloads')})
    c.cmd('Page.setDownloadBehavior',{'behavior':'allow','downloadPath':os.path.expanduser('~/Downloads')})
    # recherche elegant + filtre no vocals via URL
    c.cmd('Page.navigate',{'url':'https://www.epidemicsound.com/music/search/?term=elegant'})
    time.sleep(8)
    info=c.ev("(()=>{"
      "const rows=[...document.querySelectorAll('[data-testid*=track],[class*=track-list-row],[class*=TrackListRow],[role=row]')].slice(0,4);"
      "const dl=[...document.querySelectorAll('button,a')].filter(e=>/download|télécharger/i.test((e.getAttribute('aria-label')||'')+(e.getAttribute('title')||'')));"
      "const filters=[...document.querySelectorAll('button')].filter(e=>/vocal|voix|instrumental/i.test(e.innerText||'')).map(e=>(e.innerText||'').slice(0,25));"
      "return JSON.stringify({url:location.href, nRows:rows.length, nDownloadBtn:dl.length, vocalFilters:filters.slice(0,5)});})()")
    print('SEARCH:', info)
