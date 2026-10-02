import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

describe('lecture des avis npm du replay B', () => {
  it('accepte le filtre jq réel sans prendre .key pour un fichier', () => {
    const command = `npm audit --json 2>&1 | jq '.vulnerabilities | to_entries[] | select(.value.severity == "high") | .key' 2>/dev/null`;
    expect(validateCommand(command)).toMatchObject({ valid: true });
  });

  it.each([
    `jq '.key' signing.key`,
    `jq -f signing.key audit.json`,
    `jq -f '.key' audit.json`,
    `jq '.key' .key`,
    `jq '.key' < .key`,
    `jq '"signing.key"' audit.json`,
    `jq '.key' < signing.key`,
    `jq '.key'; cat signing.key`,
    `jq '"signing.key" | input' signing.key`,
  ])('garde le refus des véritables clés : %s', command => {
    expect(validateCommand(command).valid).toBe(false);
  });
});
