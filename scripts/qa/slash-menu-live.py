#!/usr/bin/env python3
"""Execute audited slash scenarios in real CLI PTYs.

Default behaviour matches the original per-case throwaway HOME (parallel).
Optional --home/--project reuse the same profile across sequential restarts
(workers forced to 1). A completed process is not a pass.

Flags only — repo root is discovered from this script, never a private path.
"""
import argparse, concurrent.futures, fcntl, hashlib, json, os, pathlib, pty, re, select, signal, struct, subprocess, tempfile, termios, time

parser = argparse.ArgumentParser()
parser.add_argument('--entry', required=True)
parser.add_argument('--node', default='node')
parser.add_argument('--plan', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--results-name', default='results.json')
parser.add_argument('--workers', type=int, default=3)
parser.add_argument('--timeout', type=int, default=45)
parser.add_argument('--home', help='Reuse this HOME across cases (implies workers=1)')
parser.add_argument('--project', help='Reuse this project directory across cases')
parser.add_argument('--model', default='qwen3:4b-instruct')
parser.add_argument('--base-url', default='http://127.0.0.1:11434/v1')
parser.add_argument('--omit-cli-model', action='store_true', help='Do not pass --model/--base-url (use saved settings)')
parser.add_argument('--unicode-fixture', action='store_true', help='Seed a Unicode filename/content search target')
args = parser.parse_args()
entry = str(pathlib.Path(args.entry).resolve())
out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
plan = json.loads(pathlib.Path(args.plan).read_text())
if isinstance(plan, dict): plan = plan.get('actions', plan.get('commands', []))
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)')
persist = bool(args.home or args.project)
workers = 1 if persist else args.workers

def seed_project(project: pathlib.Path, unicode_fixture: bool):
    project.mkdir(parents=True, exist_ok=True)
    (project/'invoice.js').write_text('export function total(price, quantity) { return price * quantity; }\n// TODO: add a zero quantity test\n')
    (project/'invoice.test.js').write_text("import {test} from 'node:test'; import assert from 'node:assert/strict'; import {total} from './invoice.js'; test('invoice',()=>assert.equal(total(12,3),36));\n")
    (project/'package.json').write_text(json.dumps({'name':'slash-qa-fixture','version':'1.0.0','type':'module','scripts':{'test':'node --test invoice.test.js'}}))
    (project/'README.md').write_text('# Invoice fixture\nLocal test project. total(price, quantity) multiplies the arguments.\n')
    if unicode_fixture:
        nested = project/'sub dir'
        nested.mkdir(exist_ok=True)
        (nested/'café notes.txt').write_text('needle-UNICORN-42 in a Unicode path with spaces.\n')

def git_init(project: pathlib.Path, env: dict):
    if (project/'.git').exists():
        return
    for cmd in [['git','init','-q'],['git','config','user.name','Code Buddy QA'],['git','config','user.email','qa@example.invalid'],['git','add','.'],['git','commit','-qm','fixture']]:
        subprocess.run(cmd,cwd=project,env=env,check=True,capture_output=True)

def handler_executed(visible: str, invocation: str) -> bool:
    """True when a slash handler produced an assistant card, not only text left in the input box."""
    if '──── Code Buddy ' not in visible and 'Select model (current:' not in visible and 'Theme Changed' not in visible:
        if not re.search(r'Search results for|Conversation saved|Status Dashboard|CODE BUDDY COMMANDS|Now using:', visible):
            return False
    input_only = False
    if re.search(r'│ ❯ '+re.escape(invocation), visible) and '──── Code Buddy ' not in visible and 'CODE BUDDY COMMANDS' not in visible:
        input_only = True
    return not input_only

def run(index, case, shared):
    command = case['command'].lstrip('/')
    if not re.fullmatch(r'[a-z0-9-]+', command): raise ValueError('Invalid command name')
    case_id = case.get('id') or command
    if not re.fullmatch(r'[a-z0-9-]+', case_id): raise ValueError('Invalid case id')
    invocation = case['invocation']
    if '\n' in invocation or '\r' in invocation or not re.match(r'^/'+re.escape(command)+r'(?:\s|$)', invocation):
        raise ValueError('Invalid invocation')
    dirname = f'{index:02d}-{case_id}' if persist else case_id
    target = out/'cases'/dirname; target.mkdir(parents=True, exist_ok=False)
    result = dict(command=command, id=case_id, invocation=invocation, expected=case.get('expected',''), artifact=f'cases/{dirname}/terminal.txt', status='A_RELIRE', summary='Exécution capturée ; résultat fonctionnel à analyser.')
    if case.get('executable') is False:
        result.update(status='BLOQUE_PREREQUIS', summary=case.get('prerequisites') or 'Prérequis externes nécessaires ; scénario non exécuté.')
        (target/'terminal.txt').write_text('NON EXÉCUTÉ : '+str(result['summary']))
        (target/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)); return result
    started=time.monotonic(); buffer=bytearray(); p=None; master=None; cast=None
    omit_model = args.omit_cli_model or case.get('omitCliModel') is True
    def execute(home: str, project: pathlib.Path):
        nonlocal p, master, cast, buffer
        env={'PATH':os.environ['PATH'],'HOME':home,'USERPROFILE':home,'XDG_CONFIG_HOME':home+'/config','XDG_DATA_HOME':home+'/data','TERM':'xterm-256color','LANG':'C.UTF-8',
             'GROK_API_KEY':'local-ollama','CODEBUDDY_DISABLE_MCP':'true','CODEBUDDY_SENSORY':'false','CODEBUDDY_TELEMETRY':'false','CODEBUDDY_LEARNING_BACKGROUND_REVIEW':'false',
             'CODEBUDDY_SEMANTIC_GATE':'false','CODEBUDDY_MAX_TOKENS':'700','GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1','GIT_TERMINAL_PROMPT':'0'}
        if not omit_model:
            env['GROK_BASE_URL']=args.base_url
            env['GROK_MODEL']=args.model
        git_init(project, env)
        if not persist:
            (project/'invoice.js').write_text((project/'invoice.js').read_text()+'// QA_CHANGE: pending local change\n')
        elif '// QA_CHANGE' not in (project/'invoice.js').read_text():
            (project/'invoice.js').write_text((project/'invoice.js').read_text()+'// QA_CHANGE: pending local change\n')
        master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,120,0,0))
        cast=(target/'terminal.cast').open('w');cast.write(json.dumps({'version':2,'width':120,'height':36})+'\n')
        cli=[args.node, entry]
        if not omit_model:
            cli += ['--model', args.model, '--base-url', args.base_url]
        p=subprocess.Popen(cli,cwd=project,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
        os.close(slave)
        def collect(timeout=.08):
            if select.select([master],[],[],timeout)[0]:
                try: data=os.read(master,65536)
                except OSError:return False
                if not data:return False
                buffer.extend(data)
                cast.write(json.dumps([round(time.monotonic()-started,3),'o',data.decode(errors='replace')],ensure_ascii=False)+'\n');cast.flush()
                return True
            return False
        def settle(seconds):
            end=time.monotonic()+seconds
            while time.monotonic()<end:collect()
        deadline=time.monotonic()+30
        while b'Ready' not in buffer and time.monotonic()<deadline and p.poll() is None:collect()
        if b'Ready' not in buffer:raise RuntimeError('CLI startup did not become ready')
        settle(.4)
        for preparation in case.get('prepare', []):
            if preparation != '/help': raise ValueError('Unsupported preparation')
            os.write(master, preparation.encode());settle(.3);os.write(master,b'\r');settle(2)
        position=len(buffer)
        os.write(master,invocation.encode());settle(.3);os.write(master,b'\r')
        executionStart=time.monotonic();lastOutput=executionStart;stopped='timeout'
        while time.monotonic()-executionStart<args.timeout:
            if collect():lastOutput=time.monotonic()
            visible=ansi.sub('',buffer[position:].decode(errors='replace'))
            if p.poll() is not None:stopped='process-exited';break
            if time.monotonic()-executionStart>1.3 and time.monotonic()-lastOutput>1.0:
                messageLines=re.findall(r'Message[^\r\n]*', visible)
                readyNow=bool(messageLines and 'Ready' in messageLines[-1])
                hasResponse='──── Code Buddy ' in visible
                if (readyNow and hasResponse) or 'Select model (current:' in visible:
                    stopped='idle-ui';break
                if re.search(r'proceed with this operation|Enter.*select|confirm|Approve', visible[-4000:],re.I):
                    stopped='approval-required';break
        result['stopReason']=stopped;result['durationSeconds']=round(time.monotonic()-started,2)
        visible=ansi.sub('',buffer[position:].decode(errors='replace'))
        result['outputTail']=visible[-10000:]
        result['exitBeforeCleanup']=p.poll()
        result['handlerExecuted']=handler_executed(visible, invocation)
        if not result['handlerExecuted']:
            result.update(status='ECHEC',summary='Slash left in the input box or no assistant handler output.')
        elif stopped=='timeout':result.update(status='ECHEC',summary='Délai dépassé ; résultat non validé.')
        elif stopped=='approval-required':result.update(status='BLOQUE_PREREQUIS',summary='Confirmation interactive requise ; opération non approuvée dans cette recette.')
        elif re.search(r'no conversation-loop handler|Unknown command|registered but|Unhandled|Command failed:',visible,re.I):result.update(status='ECHEC',summary='Commande non prise en charge ou erreur du gestionnaire.')
        elif re.search(r'Usage:|Missing required|requires? (?:an? )?(?:argument|parameter)|required argument',visible,re.I):result.update(status='VALIDATION_SEULE',summary='Aide ou validation des arguments observée ; action complète non validée.')
        elif re.search(r'API key.*(?:required|missing|not (?:set|configured))|requires? .*API.key|not authenticated|not signed in|not available|not installed|not configured|No .*configured|Cannot find module|not initialized',visible,re.I):result.update(status='BLOQUE_PREREQUIS',summary='Prérequis indisponible dans le profil isolé ; détail dans la capture.')
        elif re.search(r'cannot comply|attempt to override|\bError:|❌',visible,re.I):result.update(status='ECHEC',summary='Erreur ou refus observé ; détail dans la capture.')
        (target/'response.txt').write_text(visible)
        diff=subprocess.run(['git','diff','--no-ext-diff'],cwd=project,env=env,capture_output=True,text=True)
        (target/'git-after.txt').write_text(diff.stdout+diff.stderr)
        files=[]
        for path in project.rglob('*'):
            if path.is_file() and not path.is_symlink() and '.git' not in path.relative_to(project).parts:
                files.append({'path':str(path.relative_to(project)), 'bytes':path.stat().st_size, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        (target/'files-after.json').write_text(json.dumps(files,indent=2))
        homeFiles=[]
        codebuddy=pathlib.Path(home)/'.codebuddy'
        if codebuddy.exists():
            for path in codebuddy.rglob('*'):
                if path.is_file() and not path.is_symlink():
                    homeFiles.append({'path':str(path.relative_to(home)), 'bytes':path.stat().st_size, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        (target/'home-files-after.json').write_text(json.dumps(homeFiles,indent=2))
        facts={'projectAgentsExists':(project/'AGENTS.md').is_file(),'handlerExecuted':result['handlerExecuted']}
        if args.unicode_fixture:
            facts['unicodeHit']='needle-UNICORN-42' in visible
        prefs=pathlib.Path(home)/'.codebuddy'/'theme-preferences.json'
        if prefs.is_file():
            facts['themePreferences']=json.loads(prefs.read_text())
        settings=pathlib.Path(home)/'.codebuddy'/'user-settings.json'
        if settings.is_file():
            try: facts['userSettings']=json.loads(settings.read_text())
            except json.JSONDecodeError: facts['userSettingsUnreadable']=True
        saved=pathlib.Path(home)/'.codebuddy'/'conversations'/'conversation.md'
        if saved.is_file():
            facts['savedConversationBytes']=saved.stat().st_size
            facts['savedConversationContainsHelp']='CODE BUDDY COMMANDS' in saved.read_text()
        if command == 'export' or invocation.startswith('/export'):
            exports = []
            for path in pathlib.Path(home).rglob('*.md'):
                if path.is_file() and not path.is_symlink():
                    content = path.read_text(errors='replace')
                    if 'CODE BUDDY COMMANDS' in content:
                        exports.append(str(path.relative_to(home)))
                        (target/'export-content.md').write_text(content)
            facts['exportContainsHelp'] = bool(exports)
            facts['exportFilesWithHelp'] = exports
        (target/'postconditions.json').write_text(json.dumps(facts,indent=2))
        return env
    try:
        if persist:
            home=str(pathlib.Path(args.home).resolve()) if args.home else str(shared['home'])
            project=pathlib.Path(args.project).resolve() if args.project else pathlib.Path(shared['project'])
            pathlib.Path(home).mkdir(parents=True, exist_ok=True)
            if index==0:
                seed_project(project, args.unicode_fixture)
            execute(home, project)
        else:
            with tempfile.TemporaryDirectory(prefix=f'cb-slash-{case_id}-') as home:
                project=pathlib.Path(home)/'project'
                seed_project(project, args.unicode_fixture)
                execute(home, project)
    except Exception as exc:
        result.update(status='ECHEC',summary=str(exc))
    finally:
        if p and p.poll() is None:
            os.killpg(p.pid,signal.SIGTERM)
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
        if master is not None:
            os.close(master)
        if cast:cast.close()
        (target/'terminal.txt').write_text(ansi.sub('',buffer.decode(errors='replace')))
        (target/'terminal.raw').write_bytes(buffer)
    (target/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));return result

shared={}
if persist:
    if not args.home:
        shared['home']=tempfile.mkdtemp(prefix='cb-slash-persist-home-')
    if not args.project:
        proj=pathlib.Path(shared.get('home') or args.home)/'project'
        proj.mkdir(parents=True, exist_ok=True)
        shared['project']=str(proj)

results=[]
if persist:
    for i, case in enumerate(plan):
        result=run(i, case, shared); results.append(result)
        (out/args.results_name).write_text(json.dumps(results,ensure_ascii=False,indent=2))
        print(f"{len(results)}/{len(plan)} /{result['command']}: {result['status']}",flush=True)
else:
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        pending={pool.submit(run, i, case, shared):case for i, case in enumerate(plan)}
        for future in concurrent.futures.as_completed(pending):
            result=future.result();results.append(result)
            (out/args.results_name).write_text(json.dumps(sorted(results,key=lambda r:r['command']),ensure_ascii=False,indent=2))
            print(f"{len(results)}/{len(plan)} /{result['command']}: {result['status']}",flush=True)
