import { Command } from 'commander';
import { DeviceAuthStore, getDeviceAuthStore } from '../server/auth/device-store.js';
import { renderQrAnsi, type SpawnSyncFn } from './token.js';

export interface DeviceCommandDependencies {
  store?: DeviceAuthStore;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnSyncFn;
}

function pairingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('Use a valid HTTP(S) server URL without credentials, query or fragment');
  }
}

export function createPairCommand(deps: DeviceCommandDependencies = {}): Command {
  return new Command('pair')
    .description('Pair an Android authenticator with this server (local one-time code, 10 minutes)')
    .option('--url <url>', 'Server URL reachable from the phone')
    .option('--json', 'Print the QR payload as JSON')
    .action((options: { url?: string; json?: boolean }) => {
      try {
        const env = deps.env ?? process.env;
        const url = pairingUrl(options.url || env.CODEBUDDY_SERVER_URL || `http://127.0.0.1:${env.CODEBUDDY_SERVER_PORT || env.PORT || '3000'}`);
        const { pairingCode, expiresAt } = (deps.store ?? getDeviceAuthStore()).createPairing();
        const payload = JSON.stringify({ url, pairingCode });
        if (options.json) {
          console.log(payload);
          return;
        }
        console.log(`Pairing code: ${pairingCode}`);
        console.log(`Expires: ${expiresAt} (10 minutes, one use)`);
        console.log(payload);
        const qr = renderQrAnsi(payload, deps.spawn);
        if (qr.ok) console.log(qr.output);
        else console.error(qr.hint);
      } catch (error) {
        console.error(error instanceof Error && error.message.startsWith('Use a valid')
          ? error.message : 'Device pairing unavailable');
        process.exitCode = 1;
      }
    });
}

export function createDevicesCommand(deps: DeviceCommandDependencies = {}): Command {
  const command = new Command('devices').description('Manage Android authentication devices (local only)');
  const getStore = () => deps.store ?? getDeviceAuthStore();
  command.command('list').option('--json', 'Print public device metadata as JSON')
    .action((options: { json?: boolean }) => {
      try {
        const devices = getStore().list().map(({ publicKeyJwk: _key, ...metadata }) => metadata);
        if (options.json) console.log(JSON.stringify(devices, null, 2));
        else if (devices.length === 0) console.log('No Android devices paired. Run buddy pair.');
        else for (const device of devices) {
          console.log(`${device.deviceId}  ${device.deviceName}  ${device.revokedAt ? 'revoked' : 'active'}  ${device.createdAt}`);
        }
      } catch {
        console.error('Device store unavailable');
        process.exitCode = 1;
      }
    });
  command.command('revoke <id>').description('Revoke an Android authentication device')
    .action((id: string) => {
      try {
        getStore().revoke(id);
        console.log('Device revoked');
      } catch {
        console.error('Unable to revoke device');
        process.exitCode = 1;
      }
    });
  command.command('rename <id> <name>').description('Rename an Android device')
    .action((id: string, name: string) => {
      try {
        getStore().rename(id, name);
        console.log('Device renamed');
      } catch {
        console.error('Unable to rename device');
        process.exitCode = 1;
      }
    });
  return command;
}
