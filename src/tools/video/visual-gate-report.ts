/** Strict schema-V1 parser and fail-closed evaluator for measured visual gates. */

import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import { open } from 'fs/promises';
import path from 'path';

import type { GateResult } from './native-fashion-defects.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export type VisualGateReportProfile = 'native-fashion-v1' | 'legacy-localized-v1';

export interface VisualGateFrameReference {
  frameIndex: number;
  timestampSeconds: number;
}

export interface VisualGateIdentityFrame extends VisualGateFrameReference {
  similarity: number;
}

export interface VisualGateIdentityMetrics {
  evaluatedFrameCount: number;
  detectedFaceCount: number;
  minSimilarity: number;
  meanSimilarity: number;
  stdDevSimilarity: number;
  lowSimilarityFrames: VisualGateIdentityFrame[];
  noFace: VisualGateFrameReference[];
}

export interface VisualGateAnatomyFrame extends VisualGateFrameReference {
  lowVisibilityLandmarkCount: number;
  detectedHandFingerCounts: number[];
  implausibleFingerCounts: number[];
  teleportation: boolean;
}

export interface VisualGateTeleportationFrame extends VisualGateFrameReference {
  landmarkIndices: number[];
  maxNormalizedDelta: number;
}

export interface VisualGateAnatomyMetrics {
  evaluatedFrameCount: number;
  suspectFrameCount: number;
  suspiciousFrames: VisualGateAnatomyFrame[];
  teleportationFrames: VisualGateTeleportationFrame[];
}

export interface VisualGateTemporalStabilityMetrics {
  framePairCount: number;
  globalFlickerMean: number;
  thirdsFlickerMean: {
    top: number;
    middle: number;
    bottom: number;
  };
  exposureJitterVariance: number;
  localWarpGradientMean: number;
}

export interface VisualGateSharpnessFrame extends VisualGateFrameReference {
  laplacianVariance: number;
}

export interface VisualGateSharpnessMetrics {
  evaluatedFrameCount: number;
  minLaplacianVariance: number;
  meanLaplacianVariance: number;
  lowSharpnessFrames: VisualGateSharpnessFrame[];
}

export interface VisualGateMasterProperties {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  videoBitrateKbps: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
  nearBlackFrameRatio: number;
}

export interface VisualGateLoopMetrics {
  normalizedAbsoluteDifference: number;
  histogramCorrelation: number;
}

export interface VisualGateReport {
  schemaVersion: 1;
  generatedAt: string;
  clipSha256: string | null;
  profile: VisualGateReportProfile;
  sampleFps: number;
  metrics: {
    identity: VisualGateIdentityMetrics;
    anatomy: VisualGateAnatomyMetrics;
    temporalStability: VisualGateTemporalStabilityMetrics;
    sharpness: VisualGateSharpnessMetrics;
    masterProperties: VisualGateMasterProperties;
    loop: VisualGateLoopMetrics | null;
  };
}

export interface HumanConfirmedVisualGates {
  outfit?: true;
  decorFraming?: true;
}

export const VISUAL_GATE_THRESHOLDS = {
  'native-fashion-v1': {
    // calibration pending — see docs/studies/2026-07-20-synthesis
    identity: { minSimilarity: 0.35, meanSimilarity: 0.45, maxNoFaceFrames: 0 },
    anatomy: { maxTeleportationFrames: 0, maxImplausibleHandFrames: 0 },
    temporalStability: {
      maxGlobalFlickerMean: 12,
      maxThirdFlickerMean: 16,
      maxExposureJitterVariance: 100,
      maxLocalWarpGradientMean: 40,
    },
    sharpness: { minLaplacianVariance: 100 },
    masterProperties: {
      minWidth: 1080,
      minHeight: 1920,
      targetFps: 30,
      fpsTolerance: 0.05,
      minDurationSeconds: 11,
      maxDurationSeconds: 13,
      minVideoBitrateKbps: 12_000,
      maxVideoBitrateKbps: 20_000,
      maxNearBlackFrameRatio: 0.05,
      videoCodecs: ['h264', 'hevc'] as const,
      audioCodecs: ['aac', 'opus'] as const,
    },
    loop: {
      required: true,
      maxNormalizedAbsoluteDifference: 0.12,
      minHistogramCorrelation: 0.9,
    },
  },
} as const;

export type VisualGateThresholdProfileId = keyof typeof VISUAL_GATE_THRESHOLDS;

export interface EvaluatedVisualGateReport {
  report: VisualGateReport;
  gateResults: GateResult[];
  reportSha256: string;
}

function objectAt(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Visual gate report ${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Visual gate report ${location} fields are invalid; expected exactly: ${keys.join(', ')}`);
  }
}

function finiteNumber(value: unknown, location: string, minimum?: number, maximum?: number): number {
  if (
    typeof value !== 'number' || !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)
  ) {
    throw new Error(`Visual gate report ${location} must be a finite number${minimum !== undefined ? ` >= ${minimum}` : ''}`);
  }
  return value;
}

function integer(value: unknown, location: string, minimum = 0): number {
  const parsed = finiteNumber(value, location, minimum);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Visual gate report ${location} must be a safe integer`);
  return parsed;
}

function booleanAt(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Visual gate report ${location} must be boolean`);
  return value;
}

function stringAt(value: unknown, location: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Visual gate report ${location} must be a non-empty string`);
  return value;
}

function arrayAt(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Visual gate report ${location} must be an array`);
  return value;
}

function frameReference(value: unknown, location: string): VisualGateFrameReference {
  const record = objectAt(value, location);
  exactKeys(record, ['frameIndex', 'timestampSeconds'], location);
  return {
    frameIndex: integer(record.frameIndex, `${location}.frameIndex`),
    timestampSeconds: finiteNumber(record.timestampSeconds, `${location}.timestampSeconds`, 0),
  };
}

function identityFrame(value: unknown, location: string): VisualGateIdentityFrame {
  const record = objectAt(value, location);
  exactKeys(record, ['frameIndex', 'timestampSeconds', 'similarity'], location);
  return {
    frameIndex: integer(record.frameIndex, `${location}.frameIndex`),
    timestampSeconds: finiteNumber(record.timestampSeconds, `${location}.timestampSeconds`, 0),
    similarity: finiteNumber(record.similarity, `${location}.similarity`, -1, 1),
  };
}

function parseIdentity(value: unknown): VisualGateIdentityMetrics {
  const record = objectAt(value, 'metrics.identity');
  exactKeys(record, [
    'evaluatedFrameCount', 'detectedFaceCount', 'minSimilarity', 'meanSimilarity',
    'stdDevSimilarity', 'lowSimilarityFrames', 'noFace',
  ], 'metrics.identity');
  const result: VisualGateIdentityMetrics = {
    evaluatedFrameCount: integer(record.evaluatedFrameCount, 'metrics.identity.evaluatedFrameCount', 1),
    detectedFaceCount: integer(record.detectedFaceCount, 'metrics.identity.detectedFaceCount'),
    minSimilarity: finiteNumber(record.minSimilarity, 'metrics.identity.minSimilarity', -1, 1),
    meanSimilarity: finiteNumber(record.meanSimilarity, 'metrics.identity.meanSimilarity', -1, 1),
    stdDevSimilarity: finiteNumber(record.stdDevSimilarity, 'metrics.identity.stdDevSimilarity', 0),
    lowSimilarityFrames: arrayAt(record.lowSimilarityFrames, 'metrics.identity.lowSimilarityFrames')
      .map((item, index) => identityFrame(item, `metrics.identity.lowSimilarityFrames[${index}]`)),
    noFace: arrayAt(record.noFace, 'metrics.identity.noFace')
      .map((item, index) => frameReference(item, `metrics.identity.noFace[${index}]`)),
  };
  if (result.detectedFaceCount + result.noFace.length !== result.evaluatedFrameCount) {
    throw new Error('Visual gate report identity face counts are inconsistent');
  }
  return result;
}

function integerArray(value: unknown, location: string): number[] {
  return arrayAt(value, location).map((item, index) => integer(item, `${location}[${index}]`));
}

function anatomyFrame(value: unknown, location: string): VisualGateAnatomyFrame {
  const record = objectAt(value, location);
  exactKeys(record, [
    'frameIndex', 'timestampSeconds', 'lowVisibilityLandmarkCount', 'detectedHandFingerCounts',
    'implausibleFingerCounts', 'teleportation',
  ], location);
  return {
    frameIndex: integer(record.frameIndex, `${location}.frameIndex`),
    timestampSeconds: finiteNumber(record.timestampSeconds, `${location}.timestampSeconds`, 0),
    lowVisibilityLandmarkCount: integer(record.lowVisibilityLandmarkCount, `${location}.lowVisibilityLandmarkCount`),
    detectedHandFingerCounts: integerArray(record.detectedHandFingerCounts, `${location}.detectedHandFingerCounts`),
    implausibleFingerCounts: integerArray(record.implausibleFingerCounts, `${location}.implausibleFingerCounts`),
    teleportation: booleanAt(record.teleportation, `${location}.teleportation`),
  };
}

function teleportationFrame(value: unknown, location: string): VisualGateTeleportationFrame {
  const record = objectAt(value, location);
  exactKeys(record, ['frameIndex', 'timestampSeconds', 'landmarkIndices', 'maxNormalizedDelta'], location);
  return {
    frameIndex: integer(record.frameIndex, `${location}.frameIndex`),
    timestampSeconds: finiteNumber(record.timestampSeconds, `${location}.timestampSeconds`, 0),
    landmarkIndices: integerArray(record.landmarkIndices, `${location}.landmarkIndices`),
    maxNormalizedDelta: finiteNumber(record.maxNormalizedDelta, `${location}.maxNormalizedDelta`, 0),
  };
}

function parseAnatomy(value: unknown): VisualGateAnatomyMetrics {
  const record = objectAt(value, 'metrics.anatomy');
  exactKeys(record, ['evaluatedFrameCount', 'suspectFrameCount', 'suspiciousFrames', 'teleportationFrames'], 'metrics.anatomy');
  const result: VisualGateAnatomyMetrics = {
    evaluatedFrameCount: integer(record.evaluatedFrameCount, 'metrics.anatomy.evaluatedFrameCount', 1),
    suspectFrameCount: integer(record.suspectFrameCount, 'metrics.anatomy.suspectFrameCount'),
    suspiciousFrames: arrayAt(record.suspiciousFrames, 'metrics.anatomy.suspiciousFrames')
      .map((item, index) => anatomyFrame(item, `metrics.anatomy.suspiciousFrames[${index}]`)),
    teleportationFrames: arrayAt(record.teleportationFrames, 'metrics.anatomy.teleportationFrames')
      .map((item, index) => teleportationFrame(item, `metrics.anatomy.teleportationFrames[${index}]`)),
  };
  if (result.suspectFrameCount !== result.suspiciousFrames.length) {
    throw new Error('Visual gate report anatomy suspect frame count is inconsistent');
  }
  return result;
}

function parseTemporalStability(value: unknown): VisualGateTemporalStabilityMetrics {
  const record = objectAt(value, 'metrics.temporalStability');
  exactKeys(record, [
    'framePairCount', 'globalFlickerMean', 'thirdsFlickerMean',
    'exposureJitterVariance', 'localWarpGradientMean',
  ], 'metrics.temporalStability');
  const thirds = objectAt(record.thirdsFlickerMean, 'metrics.temporalStability.thirdsFlickerMean');
  exactKeys(thirds, ['top', 'middle', 'bottom'], 'metrics.temporalStability.thirdsFlickerMean');
  return {
    framePairCount: integer(record.framePairCount, 'metrics.temporalStability.framePairCount'),
    globalFlickerMean: finiteNumber(record.globalFlickerMean, 'metrics.temporalStability.globalFlickerMean', 0),
    thirdsFlickerMean: {
      top: finiteNumber(thirds.top, 'metrics.temporalStability.thirdsFlickerMean.top', 0),
      middle: finiteNumber(thirds.middle, 'metrics.temporalStability.thirdsFlickerMean.middle', 0),
      bottom: finiteNumber(thirds.bottom, 'metrics.temporalStability.thirdsFlickerMean.bottom', 0),
    },
    exposureJitterVariance: finiteNumber(record.exposureJitterVariance, 'metrics.temporalStability.exposureJitterVariance', 0),
    localWarpGradientMean: finiteNumber(record.localWarpGradientMean, 'metrics.temporalStability.localWarpGradientMean', 0),
  };
}

function sharpnessFrame(value: unknown, location: string): VisualGateSharpnessFrame {
  const record = objectAt(value, location);
  exactKeys(record, ['frameIndex', 'timestampSeconds', 'laplacianVariance'], location);
  return {
    frameIndex: integer(record.frameIndex, `${location}.frameIndex`),
    timestampSeconds: finiteNumber(record.timestampSeconds, `${location}.timestampSeconds`, 0),
    laplacianVariance: finiteNumber(record.laplacianVariance, `${location}.laplacianVariance`, 0),
  };
}

function parseSharpness(value: unknown): VisualGateSharpnessMetrics {
  const record = objectAt(value, 'metrics.sharpness');
  exactKeys(record, [
    'evaluatedFrameCount', 'minLaplacianVariance', 'meanLaplacianVariance', 'lowSharpnessFrames',
  ], 'metrics.sharpness');
  return {
    evaluatedFrameCount: integer(record.evaluatedFrameCount, 'metrics.sharpness.evaluatedFrameCount', 1),
    minLaplacianVariance: finiteNumber(record.minLaplacianVariance, 'metrics.sharpness.minLaplacianVariance', 0),
    meanLaplacianVariance: finiteNumber(record.meanLaplacianVariance, 'metrics.sharpness.meanLaplacianVariance', 0),
    lowSharpnessFrames: arrayAt(record.lowSharpnessFrames, 'metrics.sharpness.lowSharpnessFrames')
      .map((item, index) => sharpnessFrame(item, `metrics.sharpness.lowSharpnessFrames[${index}]`)),
  };
}

function parseMasterProperties(value: unknown): VisualGateMasterProperties {
  const record = objectAt(value, 'metrics.masterProperties');
  exactKeys(record, [
    'width', 'height', 'fps', 'durationSeconds', 'videoBitrateKbps', 'videoCodec',
    'audioCodec', 'hasAudio', 'nearBlackFrameRatio',
  ], 'metrics.masterProperties');
  return {
    width: integer(record.width, 'metrics.masterProperties.width', 1),
    height: integer(record.height, 'metrics.masterProperties.height', 1),
    fps: finiteNumber(record.fps, 'metrics.masterProperties.fps', 0.000_001),
    durationSeconds: finiteNumber(record.durationSeconds, 'metrics.masterProperties.durationSeconds', 0.000_001),
    videoBitrateKbps: finiteNumber(record.videoBitrateKbps, 'metrics.masterProperties.videoBitrateKbps', 0),
    videoCodec: stringAt(record.videoCodec, 'metrics.masterProperties.videoCodec'),
    audioCodec: stringAt(record.audioCodec, 'metrics.masterProperties.audioCodec'),
    hasAudio: booleanAt(record.hasAudio, 'metrics.masterProperties.hasAudio'),
    nearBlackFrameRatio: finiteNumber(record.nearBlackFrameRatio, 'metrics.masterProperties.nearBlackFrameRatio', 0, 1),
  };
}

function parseLoop(value: unknown): VisualGateLoopMetrics | null {
  if (value === null) return null;
  const record = objectAt(value, 'metrics.loop');
  exactKeys(record, ['normalizedAbsoluteDifference', 'histogramCorrelation'], 'metrics.loop');
  return {
    normalizedAbsoluteDifference: finiteNumber(record.normalizedAbsoluteDifference, 'metrics.loop.normalizedAbsoluteDifference', 0, 1),
    histogramCorrelation: finiteNumber(record.histogramCorrelation, 'metrics.loop.histogramCorrelation', -1, 1),
  };
}

export function parseVisualGateReport(json: unknown): VisualGateReport {
  const report = objectAt(json, 'root');
  exactKeys(report, ['schemaVersion', 'generatedAt', 'clipSha256', 'profile', 'sampleFps', 'metrics'], 'root');
  if (report.schemaVersion !== 1) {
    throw new Error(`Unsupported visual gate report schemaVersion: ${String(report.schemaVersion)}`);
  }
  const generatedAt = stringAt(report.generatedAt, 'generatedAt');
  if (!ISO_UTC.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Visual gate report generatedAt must be an ISO UTC timestamp');
  }
  if (report.clipSha256 !== null && (typeof report.clipSha256 !== 'string' || !SHA256.test(report.clipSha256))) {
    throw new Error('Visual gate report clipSha256 must be null or a lowercase SHA-256');
  }
  if (report.profile !== 'native-fashion-v1' && report.profile !== 'legacy-localized-v1') {
    throw new Error(`Unknown visual gate report profile: ${String(report.profile)}`);
  }
  const metrics = objectAt(report.metrics, 'metrics');
  exactKeys(metrics, ['identity', 'anatomy', 'temporalStability', 'sharpness', 'masterProperties', 'loop'], 'metrics');
  return {
    schemaVersion: 1,
    generatedAt,
    clipSha256: report.clipSha256,
    profile: report.profile,
    sampleFps: finiteNumber(report.sampleFps, 'sampleFps', 0.000_001),
    metrics: {
      identity: parseIdentity(metrics.identity),
      anatomy: parseAnatomy(metrics.anatomy),
      temporalStability: parseTemporalStability(metrics.temporalStability),
      sharpness: parseSharpness(metrics.sharpness),
      masterProperties: parseMasterProperties(metrics.masterProperties),
      loop: parseLoop(metrics.loop),
    },
  };
}

export function assertReportMatchesClip(report: VisualGateReport, clipSha256: string): void {
  if (!SHA256.test(clipSha256)) throw new Error('Expected clip digest must be a lowercase SHA-256');
  if (report.clipSha256 === null) {
    throw new Error('Visual gate report has no clipSha256 and cannot authorize a clip');
  }
  if (report.clipSha256 !== clipSha256) throw new Error('Visual gate report clip SHA-256 mismatch');
}

function frameList(frames: readonly VisualGateFrameReference[]): string {
  return frames.length ? frames.map((frame) => frame.frameIndex).join(',') : 'none';
}

export function evaluateVisualGates(
  report: VisualGateReport,
  profileId: VisualGateThresholdProfileId,
  humanConfirmed: HumanConfirmedVisualGates = {},
): GateResult[] {
  if (report.profile !== profileId) {
    throw new Error(`Visual gate report profile mismatch: report=${report.profile}, expected=${profileId}`);
  }
  const thresholds = VISUAL_GATE_THRESHOLDS[profileId];
  const { identity, anatomy, temporalStability, sharpness, masterProperties, loop } = report.metrics;
  const identityPass = identity.detectedFaceCount > 0 &&
    identity.minSimilarity >= thresholds.identity.minSimilarity &&
    identity.meanSimilarity >= thresholds.identity.meanSimilarity &&
    identity.noFace.length <= thresholds.identity.maxNoFaceFrames;
  const implausibleHandFrames = anatomy.suspiciousFrames.filter((frame) => frame.implausibleFingerCounts.length > 0);
  const anatomyPass = anatomy.teleportationFrames.length <= thresholds.anatomy.maxTeleportationFrames &&
    implausibleHandFrames.length <= thresholds.anatomy.maxImplausibleHandFrames;
  const thirdFlickerMax = Math.max(
    temporalStability.thirdsFlickerMean.top,
    temporalStability.thirdsFlickerMean.middle,
    temporalStability.thirdsFlickerMean.bottom,
  );
  const temporalPass = temporalStability.framePairCount > 0 &&
    temporalStability.globalFlickerMean <= thresholds.temporalStability.maxGlobalFlickerMean &&
    thirdFlickerMax <= thresholds.temporalStability.maxThirdFlickerMean &&
    temporalStability.exposureJitterVariance <= thresholds.temporalStability.maxExposureJitterVariance &&
    temporalStability.localWarpGradientMean <= thresholds.temporalStability.maxLocalWarpGradientMean;
  const master = thresholds.masterProperties;
  const sharpnessPass = sharpness.minLaplacianVariance >= thresholds.sharpness.minLaplacianVariance;
  const loopPass = loop !== null &&
    loop.normalizedAbsoluteDifference <= thresholds.loop.maxNormalizedAbsoluteDifference &&
    loop.histogramCorrelation >= thresholds.loop.minHistogramCorrelation;
  const masterPass = masterProperties.width >= master.minWidth && masterProperties.height >= master.minHeight &&
    masterProperties.height > masterProperties.width &&
    Math.abs(masterProperties.fps - master.targetFps) <= master.fpsTolerance &&
    masterProperties.durationSeconds >= master.minDurationSeconds &&
    masterProperties.durationSeconds <= master.maxDurationSeconds &&
    masterProperties.videoBitrateKbps >= master.minVideoBitrateKbps &&
    masterProperties.videoBitrateKbps <= master.maxVideoBitrateKbps &&
    masterProperties.nearBlackFrameRatio <= master.maxNearBlackFrameRatio &&
    master.videoCodecs.some((codec) => codec === masterProperties.videoCodec) &&
    masterProperties.hasAudio && master.audioCodecs.some((codec) => codec === masterProperties.audioCodec) &&
    (!thresholds.loop.required || loopPass) && sharpnessPass;

  return [
    {
      gate: 'identity',
      pass: identityPass,
      evidence: `min=${identity.minSimilarity.toFixed(4)}, mean=${identity.meanSimilarity.toFixed(4)}, noFace frames=${frameList(identity.noFace)}, lowSimilarity frames=${frameList(identity.lowSimilarityFrames)}`,
    },
    {
      gate: 'anatomy',
      pass: anatomyPass,
      evidence: `teleportation frames=${frameList(anatomy.teleportationFrames)}, implausible-hand frames=${frameList(implausibleHandFrames)}, suspect frames=${frameList(anatomy.suspiciousFrames)}`,
    },
    {
      gate: 'temporal-stability',
      pass: temporalPass,
      evidence: `flicker=${temporalStability.globalFlickerMean.toFixed(4)}, max-third=${thirdFlickerMax.toFixed(4)}, jitter=${temporalStability.exposureJitterVariance.toFixed(4)}, warp=${temporalStability.localWarpGradientMean.toFixed(4)}, pairs=${temporalStability.framePairCount}`,
    },
    {
      gate: 'outfit',
      pass: humanConfirmed.outfit === true,
      evidence: humanConfirmed.outfit === true ? 'human-confirmed' : 'not-measured — human review required',
    },
    {
      gate: 'decor-framing',
      pass: humanConfirmed.decorFraming === true,
      evidence: humanConfirmed.decorFraming === true ? 'human-confirmed' : 'not-measured — human review required',
    },
    {
      gate: 'master-properties',
      pass: masterPass,
      evidence: `master=${masterProperties.width}x${masterProperties.height}@${masterProperties.fps.toFixed(3)}, duration=${masterProperties.durationSeconds.toFixed(3)}s, bitrate=${masterProperties.videoBitrateKbps.toFixed(1)}kbps, codec=${masterProperties.videoCodec}/${masterProperties.audioCodec}, black=${masterProperties.nearBlackFrameRatio.toFixed(4)}, sharpness-min=${sharpness.minLaplacianVariance.toFixed(4)} low-sharpness frames=${frameList(sharpness.lowSharpnessFrames)}, loop=${loop === null ? 'not-measured' : `diff:${loop.normalizedAbsoluteDifference.toFixed(4)},corr:${loop.histogramCorrelation.toFixed(4)}`}`,
    },
  ];
}

async function readRegularReport(filename: string): Promise<Buffer> {
  const resolved = path.resolve(filename);
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > 10 * 1024 * 1024) {
      throw new Error('Visual gate report must be a regular non-symlink JSON file no larger than 10 MiB');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function loadAndEvaluateVisualGateReport(
  filename: string,
  clipSha256: string,
  profileId: VisualGateThresholdProfileId,
  humanConfirmed: HumanConfirmedVisualGates = {},
): Promise<EvaluatedVisualGateReport> {
  const bytes = await readRegularReport(filename);
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Visual gate report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = parseVisualGateReport(json);
  assertReportMatchesClip(report, clipSha256);
  return {
    report,
    gateResults: evaluateVisualGates(report, profileId, humanConfirmed),
    reportSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
