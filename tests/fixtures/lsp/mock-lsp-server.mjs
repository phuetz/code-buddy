let buffer = Buffer.alloc(0);

function send(message) {
  const content = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${content.byteLength}\r\n\r\n`);
  process.stdout.write(content);
}

function location(uri, line, character, endCharacter) {
  return {
    uri,
    range: {
      start: { line, character },
      end: { line, character: endCharacter },
    },
  };
}

function handle(message) {
  const method = message.method;
  const params = message.params ?? {};

  if (method === 'textDocument/didOpen') {
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: params.textDocument.uri,
        diagnostics: [
          {
            range: {
              start: { line: 2, character: 9 },
              end: { line: 2, character: 15 },
            },
            severity: 2,
            source: 'mock-ts',
            message: 'Mock warning for answer',
          },
        ],
      },
    });
    return;
  }

  if (method === 'exit') {
    process.exit(0);
  }

  if (message.id === undefined) return;

  const uri = params.textDocument?.uri ?? 'file:///unknown';
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true,
          },
        },
      });
      break;
    case 'textDocument/definition':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: location(uri, 0, 13, 19),
      });
      break;
    case 'textDocument/references':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [location(uri, 0, 13, 19), location(uri, 2, 9, 15)],
      });
      break;
    case 'textDocument/hover':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          contents: { kind: 'markdown', value: '```ts\nconst answer: 42\n```' },
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 19 },
          },
        },
      });
      break;
    case 'textDocument/documentSymbol':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [
          {
            name: 'answer',
            kind: 14,
            range: {
              start: { line: 0, character: 13 },
              end: { line: 0, character: 19 },
            },
          },
          {
            name: 'useAnswer',
            kind: 12,
            range: {
              start: { line: 1, character: 7 },
              end: { line: 3, character: 1 },
            },
          },
        ],
      });
      break;
    case 'shutdown':
      send({ jsonrpc: '2.0', id: message.id, result: null });
      break;
    default:
      send({ jsonrpc: '2.0', id: message.id, result: null });
  }
}

function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const contentStart = headerEnd + 4;
    const contentEnd = contentStart + contentLength;
    if (buffer.byteLength < contentEnd) return;

    const content = buffer.subarray(contentStart, contentEnd).toString('utf8');
    buffer = buffer.subarray(contentEnd);
    handle(JSON.parse(content));
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});
