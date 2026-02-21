/**
 * buddy pairing – DM Pairing CLI commands
 *
 * Subcommands:
 *   buddy pairing status           – show pairing mode status
 *   buddy pairing list             – list approved senders
 *   buddy pairing pending          – list pending pairing requests
 *   buddy pairing approve <code>   – approve a pending request by code
 *   buddy pairing revoke <id>      – revoke an approved sender
 *   buddy pairing enable           – enable pairing mode
 *   buddy pairing disable          – disable pairing mode
 */

import { Command } from 'commander';
import { getDMPairing } from '../channels/dm-pairing.js';
import type { ChannelType } from '../channels/index.js';

export function createPairingCommand(): Command {
  const cmd = new Command('pairing')
    .description('Manage DM pairing security (allowlist unknown senders on messaging channels)');

  cmd
    .command('status')
    .description('Show pairing mode configuration and statistics')
    .action(() => {
      const pairing = getDMPairing();
      const stats = pairing.getStats();

      console.log('\nDM Pairing Status');
      console.log('─'.repeat(40));
      console.log(`Enabled:         ${stats.enabled ? '✅ yes' : '❌ no'}`);
      console.log(`Approved senders: ${stats.totalApproved}`);
      console.log(`Pending requests: ${stats.totalPending}`);
      console.log(`Blocked senders:  ${stats.totalBlocked}`);

      if (Object.keys(stats.approvedByChannel).length > 0) {
        console.log('\nApproved by channel:');
        for (const [ch, count] of Object.entries(stats.approvedByChannel)) {
          console.log(`  ${ch}: ${count}`);
        }
      }
    });

  cmd
    .command('list')
    .description('List approved senders')
    .option('-c, --channel <channel>', 'Filter by channel type')
    .action(async (opts) => {
      const pairing = getDMPairing();
      await pairing.loadAllowlist();

      const senders = opts.channel
        ? pairing.listApprovedForChannel(opts.channel as ChannelType)
        : pairing.listApproved();

      if (senders.length === 0) {
        console.log('No approved senders.');
        return;
      }

      console.log(`\nApproved senders (${senders.length}):`);
      console.log('─'.repeat(60));
      for (const s of senders) {
        const when = new Date(s.approvedAt).toLocaleDateString();
        const name = s.displayName ? ` (${s.displayName})` : '';
        console.log(`  [${s.channelType}] ${s.senderId}${name}  — approved ${when} by ${s.approvedBy}`);
      }
    });

  cmd
    .command('pending')
    .description('List pending pairing requests')
    .action(() => {
      const pairing = getDMPairing();
      const requests = pairing.listPending();

      if (requests.length === 0) {
        console.log('No pending pairing requests.');
        return;
      }

      console.log(`\nPending pairing requests (${requests.length}):`);
      console.log('─'.repeat(60));
      for (const r of requests) {
        const exp = new Date(r.expiresAt).toLocaleTimeString();
        const name = r.displayName ? ` (${r.displayName})` : '';
        console.log(`  [${r.channelType}] ${r.senderId}${name}`);
        console.log(`    Code: ${r.code}   Attempts: ${r.attempts}   Expires: ${exp}`);
        if (r.messageExcerpt) {
          console.log(`    Message: "${r.messageExcerpt}"`);
        }
      }
    });

  cmd
    .command('approve <code>')
    .description('Approve a pending pairing request by code')
    .requiredOption('-c, --channel <channel>', 'Channel type (telegram, discord, slack, etc.)')
    .action((code: string, opts) => {
      const pairing = getDMPairing();
      const sender = pairing.approve(opts.channel as ChannelType, code.toUpperCase());

      if (!sender) {
        console.error(`❌ No pending request found for code "${code}" on channel "${opts.channel}".`);
        console.error('   The code may have expired. Ask the user to send a new message to generate a fresh code.');
        process.exit(1);
      }

      const name = sender.displayName ? ` (${sender.displayName})` : '';
      console.log(`✅ Approved: [${sender.channelType}] ${sender.senderId}${name}`);
    });

  cmd
    .command('add <senderId>')
    .description('Directly approve a sender without a pairing code')
    .requiredOption('-c, --channel <channel>', 'Channel type')
    .option('-n, --name <name>', 'Display name for this sender')
    .action(async (senderId: string, opts) => {
      const pairing = getDMPairing();
      const sender = pairing.approveDirectly(
        opts.channel as ChannelType,
        senderId,
        'owner-cli',
        opts.name
      );
      console.log(`✅ Added: [${sender.channelType}] ${sender.senderId}`);
      await pairing.persistAllowlist();
    });

  cmd
    .command('revoke <senderId>')
    .description('Revoke approval for a sender')
    .requiredOption('-c, --channel <channel>', 'Channel type')
    .action(async (senderId: string, opts) => {
      const pairing = getDMPairing();
      await pairing.loadAllowlist();
      const ok = pairing.revoke(opts.channel as ChannelType, senderId);

      if (!ok) {
        console.error(`❌ Sender "${senderId}" not found in allowlist for channel "${opts.channel}".`);
        process.exit(1);
      }

      console.log(`✅ Revoked: [${opts.channel}] ${senderId}`);
    });

  cmd
    .command('enable')
    .description('Enable DM pairing mode (requires restart of channel adapters)')
    .action(() => {
      console.log('⚠️  Pairing mode must be enabled via config or environment:');
      console.log('   Set DM_PAIRING_ENABLED=true in your .env, then restart.');
      console.log('');
      console.log('   Or in code: getDMPairing({ enabled: true })');
    });

  return cmd;
}
