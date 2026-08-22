import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectObjectsInImage,
  type YoloDetectionRequest,
} from '../../src/tools/vision/object-detection.js';
import {
  createVisionTools,
  ObjectDetectTool,
} from '../../src/tools/registry/vision-tools.js';

let tempWorkspace: string;

function fixedNow(): Date {
  return new Date('2026-06-27T12:00:00.000Z');
}

describe('object_detect YOLOv8 tool', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-object-detect-'));
    await fs.mkdir(path.join(tempWorkspace, 'models'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'frame.jpg'), 'fake image bytes');
  });

  afterEach(async () => {
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('runs the injected YOLO runtime and writes a durable report', async () => {
    const requests: YoloDetectionRequest[] = [];
    const result = await detectObjectsInImage({
      imagePath: 'frame.jpg',
      modelPath: 'models/yolov8n.onnx',
      minConfidence: 0.4,
      classes: ['person', '0'],
      saveAnnotated: true,
    }, {
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: () => 'object-test',
    }, {
      env: {
        CODEBUDDY_YOLO_PYTHON: '/opt/yolo/bin/python',
        CODEBUDDY_YOLO_DEVICE: 'cpu',
      },
      runYolo: async (request) => {
        requests.push(request);
        return {
          imageWidth: 640,
          imageHeight: 480,
          inferenceMs: 31,
          detections: [
            {
              label: 'person',
              classId: 0,
              confidence: 0.91234,
              box: { x1: 10.111, y1: 20.222, x2: 110.333, y2: 220.444, width: 100.222, height: 200.222 },
            },
          ],
        };
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      imagePath: path.join(tempWorkspace, 'frame.jpg'),
      modelPath: path.join(tempWorkspace, 'models/yolov8n.onnx'),
      pythonPath: '/opt/yolo/bin/python',
      minConfidence: 0.4,
      classes: ['person', '0'],
      device: 'cpu',
      saveAnnotated: true,
    });
    expect(result).toMatchObject({
      kind: 'object_detect_result',
      ok: true,
      generatedAt: '2026-06-27T12:00:00.000Z',
      summary: {
        count: 1,
        labels: ['person'],
        countsByLabel: { person: 1 },
      },
      image: { width: 640, height: 480 },
      runtime: { engine: 'ultralytics-yolov8', inferenceMs: 31 },
    });
    expect(result.detections[0]).toMatchObject({
      label: 'person',
      confidence: 0.9123,
      box: { x1: 10.11, y1: 20.22, x2: 110.33, y2: 220.44, width: 100.22, height: 200.22 },
    });
    expect(result.reportPath).toBe(path.join(tempWorkspace, '.codebuddy', 'object-detections', 'object-detect-object-test.json'));
    expect(result.annotatedImagePath).toBe(path.join(tempWorkspace, '.codebuddy', 'object-detections', 'object-detect-object-test.png'));
    await expect(fs.readFile(result.reportPath, 'utf8')).resolves.toContain('"kind": "object_detect_result"');
  });

  it('adapts the registry tool schema and returns JSON output', async () => {
    const tool = new ObjectDetectTool({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: () => 'tool-test',
    }, {
      env: {
        CODEBUDDY_YOLO_MODEL: 'models/yolov8n.pt',
        CODEBUDDY_YOLO_PYTHON: '/opt/yolo/bin/python',
      },
      runYolo: async () => ({
        detections: [],
        inferenceMs: 5,
      }),
    });

    const result = await tool.execute({
      image_path: 'frame.jpg',
      min_confidence: 0.5,
      classes: ['person'],
    }, { cwd: tempWorkspace });

    expect(result.success, result.error).toBe(true);
    const payload = JSON.parse(result.output as string) as { kind: string; summary: { count: number }; parameters: { classes: string[] } };
    expect(payload.kind).toBe('object_detect_result');
    expect(payload.summary.count).toBe(0);
    expect(payload.parameters.classes).toEqual(['person']);
    expect(tool.validate?.({ image_path: 'frame.jpg', classes: ['person'] })).toEqual({ valid: true });
    expect(tool.validate?.({ image_path: 'frame.jpg', classes: [0] })).toEqual({
      valid: false,
      errors: ['classes must be an array of strings'],
    });
  });

  it('is included in the vision tool factory', () => {
    expect(createVisionTools().map(tool => tool.name)).toContain('object_detect');
  });
});
