/** Fail-closed commercial voice rights registry shared by CLI and Cowork. */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import type { ResolvedVoiceProfile } from './narration.js';
import { canonicalizeLocale } from './localized-media.js';

export type VerifiedVoiceProfile = ResolvedVoiceProfile & {
  registryRevision: string;
  evidenceSha256: string;
  modelSha256?: string;
  scopes: string[];
  reviewedAt: string;
  reviewer: string;
  expiresAt?: string;
};

interface RegistryFile {
  schemaVersion: 2;
  profiles: unknown[];
}

export async function loadVoiceRightsRegistry(
  filename: string,
  requiredScope = 'commercial-youtube',
  now = new Date(),
): Promise<Map<string, VerifiedVoiceProfile>> {
  const registryPath = await regularSecureFile(filename, 'Voice rights registry');
  const registryBytes = await fs.readFile(registryPath);
  const registryRevision = createHash('sha256').update(registryBytes).digest('hex');
  const raw = JSON.parse(registryBytes.toString('utf8')) as Partial<RegistryFile>;
  if (raw.schemaVersion !== 2 || !Array.isArray(raw.profiles)) {
    throw new Error('Voice rights registry must use schemaVersion 2 and contain profiles');
  }
  const profiles = new Map<string, VerifiedVoiceProfile>();
  for (const candidate of raw.profiles) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Voice rights registry contains an invalid profile');
    }
    const item = candidate as Record<string, unknown>;
    const id = boundedText(item.id, 'voice profile id', 120);
    if (profiles.has(id)) throw new Error(`Duplicate voice profile: ${id}`);
    if (item.status !== 'approved' || item.revoked === true) throw new Error(`Voice profile ${id} is not approved`);
    const scopes = Array.isArray(item.scopes)
      ? item.scopes.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim()))
      : [];
    if (!scopes.includes(requiredScope)) throw new Error(`Voice profile ${id} lacks scope ${requiredScope}`);
    const reviewedAt = isoDate(item.reviewedAt, `Voice profile ${id} reviewedAt`);
    const reviewer = boundedText(item.reviewer, `Voice profile ${id} reviewer`, 120);
    const expiresAt = item.expiresAt === undefined ? undefined : isoDate(item.expiresAt, `Voice profile ${id} expiresAt`);
    if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) throw new Error(`Voice profile ${id} approval has expired`);
    const provenance = item.provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
      throw new Error(`Voice profile ${id} lacks provenance evidence`);
    }
    const evidence = provenance as Record<string, unknown>;
    const provenanceRef = boundedText(evidence.ref, `Voice profile ${id} provenance ref`, 500);
    const evidencePath = boundedText(evidence.evidencePath, `Voice profile ${id} evidence path`, 2_000);
    const evidenceSha256 = shaText(evidence.evidenceSha256, `Voice profile ${id} evidence SHA-256`);
    const canonicalEvidence = await regularSecureFile(evidencePath, `Voice profile ${id} evidence`);
    if (await sha256File(canonicalEvidence) !== evidenceSha256) throw new Error(`Voice profile ${id} evidence digest mismatch`);
    const locale = canonicalizeLocale(boundedText(item.locale, `Voice profile ${id} locale`, 40));
    const provider = item.provider;
    let profile: VerifiedVoiceProfile;
    if (provider === 'pocket') {
      profile = {
        id,
        locale,
        provider,
        voice: boundedText(item.voice, `Voice profile ${id} voice`, 120),
        language: boundedText(item.language, `Voice profile ${id} language`, 80),
        ...(typeof item.highQuality === 'boolean' ? { highQuality: item.highQuality } : {}),
        commercialUseApproved: true,
        provenanceRef,
        registryRevision,
        evidenceSha256,
        scopes,
        reviewedAt,
        reviewer,
        ...(expiresAt ? { expiresAt } : {}),
      };
    } else if (provider === 'piper') {
      const modelPath = boundedText(item.modelPath, `Voice profile ${id} model path`, 2_000);
      const modelSha256 = shaText(item.modelSha256, `Voice profile ${id} model SHA-256`);
      const canonicalModel = await regularSecureFile(modelPath, `Voice profile ${id} Piper model`);
      if (await sha256File(canonicalModel) !== modelSha256) throw new Error(`Voice profile ${id} model digest mismatch`);
      profile = {
        id,
        locale,
        provider,
        modelPath: canonicalModel,
        modelSha256,
        commercialUseApproved: true,
        provenanceRef,
        registryRevision,
        evidenceSha256,
        scopes,
        reviewedAt,
        reviewer,
        ...(expiresAt ? { expiresAt } : {}),
      };
    } else {
      throw new Error(`Voice profile ${id} uses an unsupported provider`);
    }
    profiles.set(id, profile);
  }
  return profiles;
}

export function voiceProfileRevision(profile: ResolvedVoiceProfile): string {
  const verified = profile as ResolvedVoiceProfile & Partial<VerifiedVoiceProfile>;
  const provider = profile.provider === 'pocket'
    ? { provider: profile.provider, voice: profile.voice, language: profile.language, highQuality: profile.highQuality ?? false }
    : { provider: profile.provider, modelPath: profile.modelPath, modelSha256: verified.modelSha256 };
  return createHash('sha256').update(JSON.stringify({
    id: profile.id,
    locale: canonicalizeLocale(profile.locale),
    commercialUseApproved: profile.commercialUseApproved,
    provenanceRef: profile.provenanceRef,
    registryRevision: verified.registryRevision,
    evidenceSha256: verified.evidenceSha256,
    ...provider,
  })).digest('hex');
}

async function regularSecureFile(filename: string, label: string): Promise<string> {
  if (!path.isAbsolute(filename) || filename.includes('\0')) throw new Error(`${label} path must be absolute`);
  const info = await fs.lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error(`${label} permissions must not grant group or other access`);
  return fs.realpath(filename);
}

async function sha256File(filename: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function shaText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function isoDate(value: unknown, label: string): string {
  const text = boundedText(value, label, 40);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} is invalid`);
  return text;
}
