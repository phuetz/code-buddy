/** Charges citées par Gemini et réserves de la revue 4 ; jamais exécutées. */
export const reprise5Scripts = [
  ['prefixed-subprocess', 'run.py', 'import SAFE_subprocess\nSAFE_subprocess.Popen(["id"])', 'python-process'],
  ['prefixed-subprocess-bracket', 'run.py', 'SAFE_subprocess["Popen"](["id"])', 'python-process'],
  ['prefixed-child-process', 'run.js', 'SAFE_child_process.spawn("id")', 'child_process'],
  ['camel-api-key', 'run.js', 'const apiKey = "REAL_SECRET";', 'embedded-secret'],
  ['lower-secret', 'run.js', 'const secret = "REAL_SECRET";', 'embedded-secret'],
  ['prefixed-secret-value', 'run.js', 'const SC_API_KEY = "REAL_SECRET";', 'embedded-secret'],
  ['comment-rm-python', 'run.py', '# Do not run rm -rf /', 'rm-rf'],
  ['comment-rm-shell', 'run.sh', '# Do not run rm -rf /', 'rm-rf'],
  ['extensionless-shell', 'run', '#!/bin/sh\nout=`id`', 'shell-backtick'],
  ['extensionless-env-shell', 'run', '#!/usr/bin/env -S bash -e\nout=｀id｀', 'shell-backtick'],
  ['extensionless-php', 'run', '#!/usr/bin/env php\n$out = `id`;', 'php-backtick'],
  ['unknown-interpreter', 'run', '#!/opt/custom\nout=`id`', 'shell-backtick'],
  ['unknown-extension', 'run.data', 'out=｀id｀', 'shell-backtick'],
  ['wide-shell-optout', 'run.sh', 'out=｀id｀', 'shell-backtick'],
  ['wide-php-optout', 'run.php', '$out = ｀id｀;', 'php-backtick'],
  ['comment-native', 'run.py', '# operating system (Linux)\nos.system("id")', 'python-process'],
  ['quoted-rm-secret-comment', 'run.js', '/* must be rejected */ fs["rmSync"](target, {"recursive": !0})', 'script-recursive-delete'],
  ['fake-document-extension', 'run.md', '```kotlin\nrequire(value.isNotBlank())\n```\nshutil.rmtree(target)', 'script-recursive-delete'],
  ['shell-interpreter-payload', 'run.sh', 'bash ../payload.txt', 'shell-interpreter'],
] as const;

export const reprise5Documents = [
  ['gemini-rmtree', "shutil.rmtree('/tmp/foo')", 'script-recursive-delete'],
  ['wide-fence-optout', '```ｐｈｐ\n$out = ｀id｀;\n```', 'php-backtick'],
  ['zero-width-fence', '```p\u200bhp\n$out = `id`;\n```', 'php-backtick'],
  ['unknown-fence', '```unknown\nout=`id`\n```', 'shell-backtick'],
  ['secret-document', '```js\nconst apiKey = "REAL_SECRET";\n```', 'embedded-secret'],
] as const;
