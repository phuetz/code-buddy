export const PROOF_LEDGER_SCHEMA_VERSION = 1;
export const PROOF_LEDGER_ARTIFACT = 'proof-ledger.json';

export function isProofLedgerArtifact(name: string): boolean {
  return name.replace(/\\/g, '/') === PROOF_LEDGER_ARTIFACT;
}
