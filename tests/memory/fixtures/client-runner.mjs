// Processus réel : utilise le client, fait un appel, NE ferme PAS le client, et doit sortir seul.
import { BuddyMemoryClient } from '../../../src/memory/buddy-memory-client.ts';
const c = new BuddyMemoryClient({ ledgerPath: process.env.LEDGER, callTimeoutMs: 10000 });
const r = await c.call('ping');
console.log('RESULT ' + JSON.stringify(r));
if (process.env.CLOSE === '1') c.close();
