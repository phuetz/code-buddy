/**
 * video_quality_gate adapter — ITool wiring over visual-gate-report + youtube-master-quality.
 */
import { describe, expect, it } from 'vitest';

import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';
import { VideoQualityGateTool } from '../../src/tools/video-quality-gate-tool.js';
import type { VisualGateReport } from '../../src/tools/video/visual-gate-report.js';
import type { YouTubeTechnicalReport } from '../../src/tools/video/youtube-master-quality.js';

const clipSha256 = 'a'.repeat(64);

function validVisualReport(): VisualGateReport {
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

function youtubeReport(): YouTubeTechnicalReport {
  return {
    schemaVersion: 4,
    status: 'technical-approved',
    videoFile: 'pilot.mp4',
    sidecarFile: 'pilot.mp4.youtube.json',
    captionFile: 'pilot.mp4.fr-FR.vtt',
    videoSha256: clipSha256,
    sidecarSha256: 'b'.repeat(64),
    captionSha256: 'c'.repeat(64),
    qualityProfile: { id: 'legacy-localized-v1', version: 1 },
    sourceClips: [1, 2, 3].map((index) => ({
      file: `clip-${index}.mp4`,
      sha256: String(index).repeat(64),
      width: 720,
      height: 1280,
      fps: 30,
      durationMs: 3_720,
      generationMode: 'legacy',
      upscaled: true,
    })),
    checkedAt: '2026-07-20T12:34:56.000Z',
    probe: {
      duration: 10.16,
      width: 720,
      height: 1280,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
    },
    signal: { meanVolumeDb: -20, maxVolumeDb: -0.5, blackSeconds: 0.2 },
    autoPublish: false,
  };
}

const passingChecks = {
  voice: true,
  lip_sync: true,
  identity: true,
  anatomy: true,
  captions: true,
  disclosure: true,
  editorial: true,
};

describe('video_quality_gate — registration + schema', () => {
  it('is registered under its name with media metadata and no fleetSafe flag', () => {
    const tool = createMultimodalTools().find((entry) => entry.name === 'video_quality_gate');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata?.()?.category).toBe('media');
    expect(tool!.getMetadata?.()?.fleetSafe).toBeUndefined();
    expect(tool!.getSchema().parameters.required).toEqual(['operation', 'report']);
    expect(MULTIMODAL_TOOLS.some((entry) => entry.function.name === 'video_quality_gate')).toBe(true);
    expect(TOOL_METADATA.find((entry) => entry.name === 'video_quality_gate')?.fleetSafe).toBeUndefined();
  });

  it('rejects missing operation or report', () => {
    const tool = new VideoQualityGateTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ operation: 'evaluate_visual' }).valid).toBe(false);
    expect(tool.validate({ operation: 'evaluate_visual', report: validVisualReport() }).valid).toBe(true);
  });
});

describe('video_quality_gate — evaluate + review', () => {
  it('passes a green visual report with explicit human confirmations', async () => {
    const tool = new VideoQualityGateTool();
    const result = await tool.execute({
      operation: 'evaluate_visual',
      report: validVisualReport(),
      confirm_outfit: true,
      confirm_decor_framing: true,
    });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({ passed: true, profile: 'native-fashion-v1' });
  });

  it('reviews a technically approved YouTube master when every check passes', async () => {
    const tool = new VideoQualityGateTool();
    const result = await tool.execute({
      operation: 'review_youtube',
      report: youtubeReport(),
      expected_video_sha256: clipSha256,
      reviewer: 'patrice',
      reason: 'identity and captions verified',
      checks: passingChecks,
    });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({
      status: 'ready-for-private-upload',
      autoPublish: false,
      visibility: 'private',
    });
  });

  it('returns success:false for an incomplete visual report', async () => {
    const tool = new VideoQualityGateTool();
    const result = await tool.execute({
      operation: 'evaluate_visual',
      report: { schemaVersion: 1 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expected exactly|fields are invalid/i);
  });
});
