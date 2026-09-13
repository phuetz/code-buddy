/**
 * `buddy fleet rooms` — persistent signed messages between fleet members.
 *
 * Messages are data: `read` and `tail` print sanitized text and never run
 * anything. Credentials come from the environment by default
 * (`CODEBUDDY_FLEET_ROOMS_URL`, `CODEBUDDY_FLEET_API_KEY` / `CODEBUDDY_FLEET_TOKEN`);
 * the member secret stays in its 0600 identity file and is never printed.
 */

import type { Command } from 'commander';

import type { FleetRoomClient, ReceivedRoomMessage, RoomCursor } from '../../fleet/rooms/room-client.js';
import type { RoomFilter } from '../../fleet/rooms/room-filter.js';

interface ConnectionOptions {
  url?: string;
  apiKey?: string;
  jwt?: string;
  audience?: string;
  identity?: string;
  json?: boolean;
}

interface PostOptions extends ConnectionOptions {
  mention: string[];
  replyTo?: string;
  replyRoot?: string;
}

interface ReadOptions extends ConnectionOptions {
  limit?: string;
  mentionsMe?: boolean;
  cursor?: string;
}

const collect = (value: string, previous: string[]) => [...previous, value];

function addConnectionOptions(command: Command): Command {
  return command
    .option('--url <url>', 'hub WebSocket URL (default $CODEBUDDY_FLEET_ROOMS_URL)')
    .option('--api-key <key>', 'hub API key with fleet:listen (prefer $CODEBUDDY_FLEET_API_KEY)')
    .option('--jwt <token>', 'hub JWT with fleet:listen (prefer $CODEBUDDY_FLEET_TOKEN)')
    .option('--audience <url>', 'hub URL to sign for when reached through a proxy')
    .option('--identity <file>', 'member identity file (default $CODEBUDDY_FLEET_ROOMS_IDENTITY)')
    .option('--json', 'machine-readable output');
}

function fail(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function connect(options: ConnectionOptions) {
  const url = options.url ?? process.env.CODEBUDDY_FLEET_ROOMS_URL;
  if (!url) throw new Error('hub URL required: --url or CODEBUDDY_FLEET_ROOMS_URL');
  const apiKey = options.apiKey ?? process.env.CODEBUDDY_FLEET_API_KEY;
  const jwt = options.jwt ?? process.env.CODEBUDDY_FLEET_TOKEN;
  const [{ FleetRoomClient }, { loadRoomIdentity }] = await Promise.all([
    import('../../fleet/rooms/room-client.js'),
    import('../../fleet/rooms/room-identity.js'),
  ]);
  const identity = loadRoomIdentity(options.identity);
  const client = new FleetRoomClient({
    url,
    secretKey: identity.secretKey,
    ...(apiKey ? { apiKey } : jwt ? { jwt } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
  });
  try {
    const session = await client.connect();
    return { client, session };
  } catch (error) {
    await client.close();
    throw error;
  }
}

function toJson(message: ReceivedRoomMessage) {
  return {
    seq: message.seq,
    id: message.event.id,
    room: message.room,
    author: message.author,
    createdAt: message.event.created_at,
    mentions: message.mentions,
    ...(message.thread ? { thread: message.thread } : {}),
    text: message.text,
  };
}

function printMessage(message: ReceivedRoomMessage): void {
  const when = new Date(message.event.created_at * 1000).toISOString();
  const reply = message.thread ? ` ↳${message.thread.parent.slice(0, 8)}` : '';
  console.log(`#${message.seq} ${when} ${message.author.slice(0, 12)}${reply} [${message.event.id.slice(0, 8)}]\n  ${message.text.replace(/\n/g, '\n  ')}`);
}

async function readCursor(file: string, room: string): Promise<RoomCursor | undefined> {
  const fs = await import('node:fs/promises');
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw) as { version?: unknown; room?: unknown; storeId?: unknown; throughSeq?: unknown };
  if (parsed.version !== 1 || parsed.room !== room || typeof parsed.storeId !== 'string' ||
      !Number.isSafeInteger(parsed.throughSeq) || (parsed.throughSeq as number) < 0) {
    throw new Error(`cursor file ${file} does not belong to room ${room}`);
  }
  return { storeId: parsed.storeId, throughSeq: parsed.throughSeq as number };
}

async function writeCursor(file: string, room: string, cursor: RoomCursor): Promise<void> {
  const { writeJsonAtomic } = await import('../../utils/atomic-write.js');
  await writeJsonAtomic(file, { version: 1, room, storeId: cursor.storeId, throughSeq: cursor.throughSeq });
}

function filterFor(room: string, options: ReadOptions, pubkey: string): RoomFilter {
  const filter: RoomFilter = { '#h': [room], kinds: [9] };
  if (options.mentionsMe) filter['#p'] = [pubkey];
  if (options.limit !== undefined) {
    const limit = Number(options.limit);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 500) throw new Error('--limit must be an integer between 0 and 500');
    filter.limit = limit;
  }
  return filter;
}

export function registerFleetRoomsCommands(fleet: Command): void {
  const rooms = fleet
    .command('rooms')
    .description('Persistent signed messages between fleet members (read as data, never executed)');

  const identity = rooms.command('identity').description('Member key used to sign room messages');
  identity.command('init')
    .description('Create this member key (0600 file); prints only the public key')
    .option('--identity <file>', 'identity file (default $CODEBUDDY_FLEET_ROOMS_IDENTITY)')
    .option('--force', 'rotate: keep the old file aside and create a new key')
    .option('--json', 'machine-readable output')
    .action(async (options: { identity?: string; force?: boolean; json?: boolean }) => {
      try {
        const { createRoomIdentity } = await import('../../fleet/rooms/room-identity.js');
        const created = createRoomIdentity(options.identity, { force: options.force === true });
        console.log(options.json
          ? JSON.stringify({ publicKey: created.publicKey, path: created.path })
          : `Room key created: ${created.publicKey}\nAsk the hub operator to add it to rooms.json.`);
      } catch (error) { fail(error); }
    });
  identity.command('show')
    .description('Print this member public key')
    .option('--identity <file>', 'identity file (default $CODEBUDDY_FLEET_ROOMS_IDENTITY)')
    .option('--json', 'machine-readable output')
    .action(async (options: { identity?: string; json?: boolean }) => {
      try {
        const { loadRoomIdentity } = await import('../../fleet/rooms/room-identity.js');
        const loaded = loadRoomIdentity(options.identity);
        console.log(options.json ? JSON.stringify({ publicKey: loaded.publicKey, path: loaded.path }) : loaded.publicKey);
      } catch (error) { fail(error); }
    });

  addConnectionOptions(rooms.command('post <room> <text...>'))
    .description('Sign and publish a message; returns once the hub stored it durably')
    .option('--mention <pubkey>', 'notify a member (repeatable)', collect, [])
    .option('--reply-to <id>', 'answer this message')
    .option('--reply-root <id>', 'thread root when answering a nested reply')
    .action(async (room: string, words: string[], options: PostOptions) => {
      let client: { close(): Promise<void> } | undefined;
      try {
        const connected = await connect(options);
        client = connected.client;
        const replyTo = options.replyTo
          ? { root: options.replyRoot ?? options.replyTo, parent: options.replyTo }
          : undefined;
        const ack = await connected.client.publish({
          room,
          content: words.join(' '),
          mentions: options.mention,
          ...(replyTo ? { replyTo } : {}),
        });
        console.log(options.json ? JSON.stringify(ack) : `${ack.duplicate ? 'Already stored' : 'Stored'} #${ack.seq} ${ack.id}`);
      } catch (error) {
        fail(error);
      } finally {
        await client?.close();
      }
    });

  addConnectionOptions(rooms.command('read <room>'))
    .description('Print stored messages; with --cursor, only those after the saved cursor')
    .option('--limit <n>', 'newest messages to show without a cursor (0..500, default 100)')
    .option('--mentions-me', 'only messages mentioning this member')
    .option('--cursor <file>', 'resume after, then update, the cursor saved in this file')
    .action(async (room: string, options: ReadOptions) => {
      let client: { close(): Promise<void> } | undefined;
      try {
        const connected = await connect(options);
        client = connected.client;
        const previous = options.cursor ? await readCursor(options.cursor, room) : undefined;
        const result = await connected.client.fetch([filterFor(room, options, connected.client.pubkey)], previous);
        if (options.cursor) await writeCursor(options.cursor, room, result.cursor);
        if (options.json) {
          console.log(JSON.stringify({
            messages: result.messages.map(toJson),
            cursor: result.cursor,
            gap: result.gap,
            epochChanged: result.epochChanged,
            truncated: result.truncated,
          }));
        } else {
          if (result.gap) console.log('! some messages after your cursor were evicted by retention');
          if (result.epochChanged) console.log('! the hub ledger changed generation; showing current history');
          if (result.truncated) console.log('! more messages remain; read again with --cursor to continue');
          for (const message of result.messages) printMessage(message);
          if (result.messages.length === 0) console.log('(no messages)');
        }
      } catch (error) {
        fail(error);
      } finally {
        await client?.close();
      }
    });

  addConnectionOptions(rooms.command('tail <room>'))
    .description('Follow a room live (reconnects and catches up automatically) until Ctrl+C')
    .option('--mentions-me', 'only messages mentioning this member')
    .option('--cursor <file>', 'resume after, and keep updating, the cursor saved in this file')
    .action(async (room: string, options: ReadOptions) => {
      let client: FleetRoomClient | undefined;
      let finish = () => {};
      const done = new Promise<void>(resolve => { finish = resolve; });
      let pendingWrite: Promise<void> | undefined;
      let latestCursor: RoomCursor | undefined;
      let caughtUp = false;
      const persist = (cursor: RoomCursor): void => {
        if (!options.cursor) return;
        latestCursor = cursor;
        if (pendingWrite) return;
        const file = options.cursor;
        pendingWrite = (async () => {
          while (latestCursor) {
            const next = latestCursor;
            latestCursor = undefined;
            await writeCursor(file, room, next);
          }
        })().catch(error => { fail(error); finish(); }).finally(() => {
          pendingWrite = undefined;
          if (latestCursor) persist(latestCursor);
        });
      };
      const disconnected = () => { caughtUp = false; };
      const exhausted = () => { fail(new Error('Room reconnection attempts exhausted')); finish(); };
      const reconnectError = (error: { code?: string }) => {
        if (error.code === 'ROOM_AUTH_REFUSED') { fail(error); finish(); }
      };
      try {
        client = (await connect(options)).client;
        const previous = options.cursor ? await readCursor(options.cursor, room) : undefined;
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
        client.on('disconnected', disconnected);
        client.on('reconnect-exhausted', exhausted);
        client.on('reconnect-error', reconnectError);
        const handle = client.subscribe('tail', [filterFor(room, { ...options, limit: '20' }, client.pubkey)], {
          onMessage: (message) => {
            if (options.json) console.log(JSON.stringify(toJson(message)));
            else printMessage(message);
            const cursor = handle.cursor();
            if (caughtUp && cursor) persist(cursor);
          },
          onEose: (info) => {
            caughtUp = true;
            persist({ storeId: info.storeId, throughSeq: info.throughSeq });
          },
          onClosed: (message) => {
            fail(new Error(message));
            finish();
          },
        }, previous);
        await done;
      } catch (error) { fail(error); }
      finally {
        process.removeListener('SIGINT', finish);
        process.removeListener('SIGTERM', finish);
        client?.off('disconnected', disconnected);
        client?.off('reconnect-exhausted', exhausted);
        client?.off('reconnect-error', reconnectError);
        await client?.close();
        while (pendingWrite) await pendingWrite;
      }
    });
}
