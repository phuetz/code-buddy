#!/usr/bin/env python3
"""Capture real Ink + real OpenAI-compatible model traffic. No simulated replies.
Linux/macOS PTY runner; use --peer-url for an existing authorized test peer.
Credentials stay in the child environment and are never recorded as headers.
"""
import re, argparse, os, pty, subprocess, tempfile, select, time, pathlib, signal, json, threading, struct, fcntl, termios, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--entry', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model', default='qwen3:4b-instruct')
parser.add_argument('--base-url', default='http://127.0.0.1:11434/v1')
parser.add_argument('--node', default='node')
parser.add_argument('--peer-url')
parser.add_argument('--timeout', type=int, default=300)
args = parser.parse_args()
out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
if (out/'events.jsonl').exists(): parser.error('Use a fresh output directory to preserve earlier captures')
started = time.monotonic(); calls = []; steps = []; lock = threading.Lock()
def event(kind, **data):
 record = {'elapsed': round(time.monotonic()-started,3), 'kind': kind, **data}
 with lock:
  with (out/'events.jsonl').open('a') as f: f.write(json.dumps(record,ensure_ascii=False)+'\n')
 return record
class Proxy(BaseHTTPRequestHandler):
 def log_message(self,*unused): pass
 def do_POST(self):
  payload = self.rfile.read(int(self.headers.get('Content-Length',0)))
  body = json.loads(payload)
  record = {'index': len(calls), 'ended': None, 'response': '', 'tool_calls': [], 'observations': [m for m in body.get('messages',[]) if m.get('role')=='tool']}
  calls.append(record)
  event('request_contract', index=record['index'], path=self.path, tool_choice=body.get('tool_choice'), schemas=body.get('tools',[]), system=[m.get('content') for m in body.get('messages',[]) if m.get('role')=='system'])
  event('model_request', index=record['index'], model=body.get('model'), tools=[t.get('function',{}).get('name') for t in body.get('tools',[])],
    runtime=[block for m in body.get('messages',[]) if isinstance(m.get('content'),str) for block in re.findall(r'<runtime_settings\b.*?</runtime_settings>', m['content'], re.S)],
    latest_user=next((m.get('content') for m in reversed(body.get('messages',[])) if m.get('role')=='user'),None))
  try:
   event('tool_observations', index=record['index'], results=record['observations'])
   upstream=args.base_url.rstrip('/')+'/'+self.path.removeprefix('/v1/').lstrip('/')
   # Ollama native capability probes share the host, outside its /v1 API.
   if self.path.startswith('/api/'):
    base=urllib.parse.urlsplit(args.base_url)
    upstream=urllib.parse.urlunsplit((base.scheme,base.netloc,self.path,'',''))
   request = urllib.request.Request(upstream,data=payload,headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(request,timeout=args.timeout) as response:
    self.send_response(response.status); self.send_header('Content-Type',response.headers.get('Content-Type','text/event-stream')); self.end_headers()
    if body.get('stream'):
     for line in response:
      self.wfile.write(line); self.wfile.flush()
      if line.startswith(b'data: ') and not line.startswith(b'data: [DONE]'):
       try:
        chunk=json.loads(line[6:]); delta=chunk.get('choices',[{}])[0].get('delta',{})
        record['response'] += delta.get('content') or ''
        if delta.get('tool_calls'): record['tool_calls'].extend(delta['tool_calls'])
       except (ValueError,IndexError): pass
    else:
     data=response.read();self.wfile.write(data);self.wfile.flush()
     message=json.loads(data).get('choices',[{}])[0].get('message',{})
     record['response']=message.get('content') or '';record['tool_calls']=message.get('tool_calls') or []
  except Exception as error:
   record['error']=str(error);event('model_error',index=record['index'],error=str(error))
   try: self.send_error(502)
   except OSError: pass
  finally:
   record['ended']=time.monotonic();event('model_response',**{k:v for k,v in record.items() if k!='ended'})
server=ThreadingHTTPServer(('127.0.0.1',0),Proxy)
threading.Thread(target=server.serve_forever,daemon=True).start()
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,110,0,0))
cast=(out/'terminal.cast').open('w');cast.write(json.dumps({'version':2,'width':110,'height':32,'timestamp':int(time.time()),'title':'Code Buddy live verification'})+'\n');cast.flush()
buffer=b''; process=None; approved_through=0
with tempfile.TemporaryDirectory(prefix='cb-live-pty-') as home:
 env={'PATH':os.environ['PATH'],'HOME':home,'USERPROFILE':home,'XDG_CONFIG_HOME':home+'/config','XDG_DATA_HOME':home+'/data','TERM':'xterm-256color',
  'GROK_API_KEY':'local-ollama','GROK_BASE_URL':f'http://127.0.0.1:{server.server_port}/v1','GROK_MODEL':args.model,
  'CODEBUDDY_DISABLE_MCP':'true','CODEBUDDY_SENSORY':'false','CODEBUDDY_TELEMETRY':'false','CODEBUDDY_LEARNING_BACKGROUND_REVIEW':'false',
  'CODEBUDDY_SEMANTIC_GATE':'false','CODEBUDDY_MAX_TOKENS':'700'}
 if os.environ.get('CODEBUDDY_FLEET_TOKEN'): env['CODEBUDDY_FLEET_TOKEN']=os.environ['CODEBUDDY_FLEET_TOKEN']
 def collect(duration=.1):
  global buffer, approved_through
  end=time.monotonic()+duration
  while time.monotonic()<end:
   if select.select([master],[],[],.03)[0]:
    try: data=os.read(master,65536)
    except OSError: break
    buffer+=data; cast.write(json.dumps([round(time.monotonic()-started,3),'o',data.decode(errors='replace')],ensure_ascii=False)+'\n');cast.flush()
    visible=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',buffer[approved_through:])
    if b'Do you want to proceed with this operation?' in visible and b'Enter select' in visible:
     operations=re.findall(rb'Execute tool: ([a-z_]+)',visible)
     if operations and operations[-1] in (b'list_peers',b'self_describe',b'peer_delegate',b'route_peer'):
      event('approval',tool=operations[-1].decode(),choice='Yes once');os.write(master,b'\r');approved_through=len(buffer)

 def until(condition, timeout):
  end=time.monotonic()+timeout
  while time.monotonic()<end and not condition(): collect()
  if not condition(): raise AssertionError('Timed out waiting for the real CLI')
 def send(text):
  event('input',text=text); os.write(master,text.encode());collect(.2);os.write(master,b'\r')
 def slash(text,expected):
  position=len(buffer); send(text);until(lambda:expected.encode() in buffer[position:],20);collect(.4)
  event('slash_complete',command=text)
 def prompt(text):
  first=len(calls); position=len(buffer);send(text)
  until(lambda: len(calls)>first and calls[-1]['ended'] is not None and time.monotonic()-calls[-1]['ended']>3 and b'Ready' in buffer[max(position,len(buffer)-6000):],args.timeout)
  result=calls[first:];event('prompt_complete',prompt=text,requests=len(result));return result
 try:
  process=subprocess.Popen([args.node,str(pathlib.Path(args.entry).resolve()),'--model',args.model,'--base-url',env['GROK_BASE_URL']],cwd=home,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
  os.close(slave);until(lambda:b'Ready' in buffer,40);event('ready',pid=process.pid)
  slash('/theme matrix','active immediately')
  saved=json.loads(pathlib.Path(home,'.codebuddy/theme-preferences.json').read_text());assert saved['activeTheme']=='matrix'
  theme_calls=prompt('Quel est ton thème actuellement actif ? Réponds brièvement avec son identifiant exact.')
  if args.peer_url: slash('/fleet listen '+args.peer_url+' --name qa-peer','qa-peer')
  fleet_calls=prompt("Y a-t-il d'autres Code Buddy actifs avec lesquels tu peux travailler ? Vérifie leur disponibilité et réponds brièvement.")
  delegated=[]
  if args.peer_url: delegated=prompt('Demande au pair qa-peer de proposer un test concret pour vérifier un changement de thème dans un terminal. Rapporte sa réponse.')
  code_calls=prompt('Lis ton propre code pour expliquer comment le changement de thème est propagé à Ink. Cite le fichier et les lignes que tu as réellement lus. Réponse courte.')
  send('/exit');until(lambda:process.poll() is not None,20);assert process.returncode==0
  def invoked(records,name):
   ids={call.get('id') for record in records for call in record['tool_calls'] if call.get('function',{}).get('name')==name}
   return any(observation.get('tool_call_id') in ids for record in records for observation in record['observations'])
  checks={
   'theme_answer': any('matrix' in record['response'].lower() for record in theme_calls),
   'fleet_observed': invoked(fleet_calls,'list_peers'),
   'core_inspected': invoked(code_calls,'self_describe'),
  }
  if args.peer_url: checks['peer_delegated']=invoked(delegated,'peer_delegate')
  event('validation',checks=checks,passed=all(checks.values()))
  event('finished',executionComplete=True,validationPassed=all(checks.values()))
  if not all(checks.values()): raise AssertionError('Real behavior checks failed: '+', '.join(key for key,value in checks.items() if not value))
 except Exception as error:
  event('failure',error=str(error));raise
 finally:
  (out/'terminal.raw').write_bytes(buffer)
  if process and process.poll() is None: os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=10)
  os.close(master);cast.close();server.shutdown();server.server_close()
