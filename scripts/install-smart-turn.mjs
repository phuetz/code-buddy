#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const URL = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx';
const EXPECTED_SHA256 = '2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f';
const target = path.resolve(
  process.env.BUDDY_SENSE_SMART_TURN_MODEL ||
    path.join(homedir(), '.codebuddy', 'turn-detection', 'smart-turn-v3.2-cpu.onnx'),
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

if (existsSync(target) && sha256(readFileSync(target)) === EXPECTED_SHA256) {
  console.log(`Smart Turn v3.2 already verified: ${target}`);
  process.exit(0);
}

mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const temporary = `${target}.${process.pid}.tmp`;
try {
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== EXPECTED_SHA256) {
    throw new Error(`checksum mismatch: expected ${EXPECTED_SHA256}, received ${actual}`);
  }
  writeFileSync(temporary, bytes, { mode: 0o600 });
  renameSync(temporary, target);
  console.log(`Smart Turn v3.2 installed and verified: ${target}`);
} finally {
  rmSync(temporary, { force: true });
}
