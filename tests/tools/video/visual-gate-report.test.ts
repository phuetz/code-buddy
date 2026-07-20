import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertReportMatchesClip,
  evaluateVisualGates,
  loadAndEvaluateVisualGateReport,
  parseVisualGateReport,
  type VisualGateReport,
} from '../../../src/tools/video/visual-gate-report.js';

const roots: string[] = [];
const clipSha256 = 'a'.repeat(64);

function validReport(): VisualGateReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-20T12:34:56.000Z',
    clipSha256,
    profile: 'native-fashion-v1',
    sampleFps: 6,
    metrics: {
      identity: {
        evaluatedFrameCount: 6,
        detectedFaceCount: 6,
        minSimilarity: 0.52,
        meanSimilarity: 0.61,
        stdDevSimilarity: 0.03,
        lowSimilarityFrames: [],
        noFace: [],
      },
      anatomy: {
        evaluatedFrameCount: 6,
        suspectFrameCount: 0,
        suspiciousFrames: [],
        teleportationFrames: [],
      },
      temporalStability: {
        framePairCount: 359,
        globalFlickerMean: 4.2,
        thirdsFlickerMean: { top: 4.1, middle: 4.5, bottom: 5.2 },
        exposureJitterVariance: 18,
        localWarpGradientMean: 11,
      },
      sharpness: {
        evaluatedFrameCount: 6,
        minLaplacianVariance: 180,
        meanLaplacianVariance: 260,
        lowSharpnessFrames: [],
      },
      masterProperties: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 12,
        videoBitrateKbps: 15_000,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasAudio: true,
        nearBlackFrameRatio: 0.01,
      },
      loop: {
        normalizedAbsoluteDifference: 0.05,
        histogramCorrelation: 0.96,
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('visual gate report schema', () => {
  it('strictly parses a valid schema V1 report', () => {
    expect(parseVisualGateReport(validReport())).toEqual(validReport());
  });

  it('rejects altered, unknown-version and incomplete reports', () => {
    const altered = { ...validReport(), unexpected: true };
    expect(() => parseVisualGateReport(altered)).toThrow('expected exactly');
    expect(() => parseVisualGateReport({ ...validReport(), schemaVersion: 2 })).toThrow('schemaVersion');

    const incomplete: Record<string, unknown> = structuredClone(validReport());
    const metrics = incomplete.metrics as Record<string, unknown>;
    const identity = metrics.identity as Record<string, unknown>;
    delete identity.meanSimilarity;
    expect(() => parseVisualGateReport(incomplete)).toThrow('metrics.identity');
  });

  it('fails closed when the report digest is absent or targets other clip bytes', () => {
    expect(() => assertReportMatchesClip(validReport(), 'b'.repeat(64))).toThrow('mismatch');
    expect(() => assertReportMatchesClip({ ...validReport(), clipSha256: null }, clipSha256))
      .toThrow('cannot authorize');
  });
});

describe('visual gate evaluation', () => {
  it('passes every gate only with green measurements and explicit human confirmations', () => {
    const results = evaluateVisualGates(validReport(), 'native-fashion-v1', {
      outfit: true,
      decorFraming: true,
    });
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.pass)).toBe(true);
  });

  it('fails unmeasured gates by default and passes only explicit confirmations', () => {
    const unconfirmed = evaluateVisualGates(validReport(), 'native-fashion-v1');
    expect(unconfirmed.find((result) => result.gate === 'outfit')).toEqual({
      gate: 'outfit',
      pass: false,
      evidence: 'not-measured — human review required',
    });
    expect(unconfirmed.find((result) => result.gate === 'decor-framing')?.pass).toBe(false);

    const outfitOnly = evaluateVisualGates(validReport(), 'native-fashion-v1', { outfit: true });
    expect(outfitOnly.find((result) => result.gate === 'outfit')?.pass).toBe(true);
    expect(outfitOnly.find((result) => result.gate === 'decor-framing')?.pass).toBe(false);
  });

  it('fails identity and names the incriminated frame', () => {
    const report = validReport();
    report.metrics.identity.minSimilarity = 0.2;
    report.metrics.identity.lowSimilarityFrames = [{ frameIndex: 42, timestampSeconds: 1.4, similarity: 0.2 }];
    const result = evaluateVisualGates(report, 'native-fashion-v1').find((gate) => gate.gate === 'identity');
    expect(result).toMatchObject({ pass: false });
    expect(result?.evidence).toContain('42');
  });

  it('fails anatomy and names teleporting frames', () => {
    const report = validReport();
    report.metrics.anatomy.suspectFrameCount = 1;
    report.metrics.anatomy.suspiciousFrames = [{
      frameIndex: 84,
      timestampSeconds: 2.8,
      lowVisibilityLandmarkCount: 0,
      detectedHandFingerCounts: [5, 5],
      implausibleFingerCounts: [],
      teleportation: true,
    }];
    report.metrics.anatomy.teleportationFrames = [{
      frameIndex: 84,
      timestampSeconds: 2.8,
      landmarkIndices: [15],
      maxNormalizedDelta: 0.31,
    }];
    const result = evaluateVisualGates(report, 'native-fashion-v1').find((gate) => gate.gate === 'anatomy');
    expect(result).toMatchObject({ pass: false });
    expect(result?.evidence).toContain('84');
  });

  it('fails temporal stability independently', () => {
    const report = validReport();
    report.metrics.temporalStability.exposureJitterVariance = 101;
    expect(evaluateVisualGates(report, 'native-fashion-v1')
      .find((gate) => gate.gate === 'temporal-stability')).toMatchObject({ pass: false });
  });

  it.each([
    ['sharpness', (report: VisualGateReport) => {
      report.metrics.sharpness.minLaplacianVariance = 80;
      report.metrics.sharpness.lowSharpnessFrames = [{
        frameIndex: 126,
        timestampSeconds: 4.2,
        laplacianVariance: 80,
      }];
    }, '126'],
    ['bitrate', (report: VisualGateReport) => { report.metrics.masterProperties.videoBitrateKbps = 11_999; }, '11999'],
    ['loop', (report: VisualGateReport) => { report.metrics.loop = null; }, 'not-measured'],
  ] as const)('fails master-properties for %s', (_case, alter, evidence) => {
    const report = validReport();
    alter(report);
    const result = evaluateVisualGates(report, 'native-fashion-v1')
      .find((gate) => gate.gate === 'master-properties');
    expect(result).toMatchObject({ pass: false });
    expect(result?.evidence).toContain(evidence);
  });

  it('rejects evaluation under a profile different from the report', () => {
    expect(() => evaluateVisualGates({ ...validReport(), profile: 'legacy-localized-v1' }, 'native-fashion-v1'))
      .toThrow('profile mismatch');
  });
});

describe('visual gate report loader', () => {
  it('loads, binds, evaluates and hashes the exact report bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-gate-report-'));
    roots.push(root);
    const reportPath = path.join(root, 'report.json');
    const bytes = Buffer.from(`${JSON.stringify(validReport(), null, 2)}\n`);
    await fs.writeFile(reportPath, bytes);

    const evaluated = await loadAndEvaluateVisualGateReport(
      reportPath,
      clipSha256,
      'native-fashion-v1',
      { outfit: true, decorFraming: true },
    );

    expect(evaluated.report.clipSha256).toBe(clipSha256);
    expect(evaluated.gateResults.every((result) => result.pass)).toBe(true);
    expect(evaluated.reportSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
