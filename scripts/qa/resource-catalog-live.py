"""Real packaged/compiled CLI against two explicit loopback health endpoints; no business request."""
import argparse, http.server, json, os, pathlib, subprocess, tempfile, threading
parser = argparse.ArgumentParser()
parser.add_argument('--entry', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
requests = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        requests.append({'host': self.server.identity, 'method': 'GET', 'path': self.path})
        self.send_response(200); self.end_headers(); self.wfile.write(b'healthy')
servers = []
for identity in ['a', 'b']:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.identity = identity
    threading.Thread(target=server.serve_forever, daemon=True).start()
    servers.append(server)
records = []
try:
    with tempfile.TemporaryDirectory(prefix='cb-resources-live-') as home:
        env = {key: value for key, value in os.environ.items() if key in ['PATH', 'LANG', 'SYSTEMROOT']}
        env.update(HOME=home, USERPROFILE=home, XDG_CONFIG_HOME=home+'/config', XDG_DATA_HOME=home+'/data')
        for s in servers: env['QA_RESOURCE_'+s.identity.upper()] = 'http://127.0.0.1:'+str(s.server_port)
        def cli(*params):
            p = subprocess.run([os.environ.get('CODEBUDDY_QA_NODE','node'), args.entry, 'resources', *params], env=env, cwd=home, text=True, capture_output=True, timeout=30)
            try: result = json.loads(p.stdout)
            except ValueError: result = None
            records.append({'args':params,'exit':p.returncode,'result':result,'stderr':p.stderr})
            (out/'cli-cases.json').write_text(json.dumps(records,indent=2))
            assert p.returncode == 0, 'CLI failed: '+str(params)
            return result
        for s in servers:
            fixture = pathlib.Path(home,s.identity+'.json')
            fixture.write_text(json.dumps({'id':s.identity,'kind':'inference','hostId':'fixture-'+s.identity,'declaredCapabilities':['text-generation'],'endpointRef':'QA_RESOURCE_'+s.identity.upper(),'healthPath':'/health','permissions':{'probe':True,'use':True},'ttlMs':60000,'timeoutMs':300}))
            cli('add',str(fixture)); cli('probe',s.identity)
        first = cli('select','text-generation')['selected']['resource']['id']
        stopped = next(s for s in servers if s.identity == first)
        stopped.shutdown(); stopped.server_close()
        cli('probe',first)
        second = cli('select','text-generation')['selected']['resource']['id']
        assert second != first
        assert len(requests) == 2 and all(r['path']=='/health' for r in requests), 'Unexpected requests'
        cli('status',second); cli('list')
        raw = pathlib.Path(home,'.codebuddy/resources/catalog.json').read_text()
        assert '127.0.0.1' not in raw
        (out/'result.json').write_text(json.dumps({'first':first,'stopped':first,'second':second,'requests':requests,'businessCalls':0,'duplicateBusinessCalls':0,'automaticEffectRetry':False},indent=2))
        print('PASS: stopped',first,'selected',second,'health requests',len(requests))
finally:
    for s in servers: s.shutdown(); s.server_close()
