sed -i 's/const store = new AcpSessionStore({ storeDir: tmpDir });/console.log("TEST DIR:", tmpDir); const store = new AcpSessionStore({ storeDir: tmpDir }); console.log("STORE DIR:", store["dir"]);/' tests/protocols/acp-stdio-server-real.test.ts
npm test -- tests/protocols/acp-stdio-server-real.test.ts --run
