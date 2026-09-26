import { Command } from 'commander';
import { collectRuntimeStatus, type RuntimeStatus } from '../runtime/runtime-status.js';

export function formatRuntimeStatus(status: RuntimeStatus): string {
  const { execution, repository } = status;
  const lines = [
    `Code exécuté : ${execution.version ?? 'inconnue'} / ${execution.revision ?? 'révision inconnue'} (${execution.kind}, empreinte ${execution.verified ? 'vérifiée' : 'non vérifiée'}, provenance ${execution.revisionOrigin ?? 'inconnue'})`,
    `Installation : ${execution.installationPath}`,
    `Dépôt : ${repository.path ?? 'inconnu'} / ${repository.revision ?? 'révision inconnue'} / modifications : ${repository.dirty === null ? 'inconnues' : repository.dirty ? 'oui' : 'non'}`,
    `Référence main : ${repository.mainRef ?? 'inconnue'} / avance : ${repository.mainAheadBy ?? 'inconnue'} commit(s)`,
    `Dernier appel effectif : ${status.lastEffectiveCall ? `${status.lastEffectiveCall.provider} / ${status.lastEffectiveCall.model ?? 'modèle inconnu'} (${status.lastEffectiveCall.observedAt})` : 'inconnu'}`,
    `Services (${status.servicesObservation}) :`,
    ...status.services.map((service) => `  ${service.name} : ${service.state}, version ${service.version ?? 'inconnue'}, révision ${service.revision ?? 'inconnue'}`),
    `Options activées par environnement : ${status.environmentEnabled.join(', ') || 'aucune observée'}`,
  ];
  if (status.services.length === 0) lines.push('  aucun service connu observable');
  if (status.alerts.length > 0) lines.unshift(`ÉCARTS : ${status.alerts.join(', ')}`);
  return lines.join('\n');
}

export function createRuntimeCommand(): Command {
  const command = new Command('runtime').description('Observe the running installation and known services');
  command.command('status')
    .description('Show attested code identity, last effective LLM call and known services')
    .option('--json', 'Machine-readable output')
    .action((options: { json?: boolean }) => {
      const status = collectRuntimeStatus();
      process.stdout.write(`${options.json ? JSON.stringify(status, null, 2) : formatRuntimeStatus(status)}\n`);
    });
  return command;
}
