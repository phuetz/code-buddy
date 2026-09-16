import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export interface ObjectDetectionInput {
  imagePath: string;
  modelPath?: string;
  pythonPath?: string;
  minConfidence?: number;
  iouThreshold?: number;
  classes?: string[];
  device?: string;
  maxDetections?: number;
  saveAnnotated?: boolean;
  annotatedOutputPath?: string;
  timeoutMs?: number;
}

export interface ObjectDetectionOptions {
  rootDir?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface ObjectDetectionRuntime {
  env?: NodeJS.ProcessEnv;
  runYolo?: (request: YoloDetectionRequest) => Promise<YoloDetectionResponse>;
}

export interface YoloDetectionRequest {
  imagePath: string;
  modelPath: string;
  pythonPath: string;
  minConfidence: number;
  iouThreshold: number;
  classes?: string[];
  device?: string;
  maxDetections: number;
  saveAnnotated: boolean;
  annotatedImagePath?: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

export interface ObjectDetectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

export interface ObjectDetectionItem {
  label: string;
  classId: number;
  confidence: number;
  box: ObjectDetectionBox;
}

export interface YoloDetectionResponse {
  detections: ObjectDetectionItem[];
  modelNames?: Record<string, string>;
  imageWidth?: number;
  imageHeight?: number;
  inferenceMs?: number;
}

export interface ObjectDetectionResult {
  kind: 'object_detect_result';
  ok: true;
  imagePath: string;
  modelPath: string;
  pythonPath: string;
  reportPath: string;
  annotatedImagePath?: string;
  generatedAt: string;
  parameters: {
    minConfidence: number;
    iouThreshold: number;
    classes?: string[];
    device?: string;
    maxDetections: number;
  };
  summary: {
    count: number;
    labels: string[];
    countsByLabel: Record<string, number>;
  };
  image?: {
    width?: number;
    height?: number;
  };
  runtime: {
    engine: 'ultralytics-yolov8';
    inferenceMs?: number;
  };
  detections: ObjectDetectionItem[];
}

const DEFAULT_CONFIDENCE = 0.25;
const DEFAULT_IOU = 0.7;
const DEFAULT_MAX_DETECTIONS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CHILD_OUTPUT_BYTES = 1_000_000;

export async function detectObjectsInImage(
  input: ObjectDetectionInput,
  options: ObjectDetectionOptions = {},
  runtime: ObjectDetectionRuntime = {},
): Promise<ObjectDetectionResult> {
  if (!input.imagePath.trim()) {
    throw new Error('image_path is required');
  }

  const env = runtime.env ?? process.env;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const imagePath = path.isAbsolute(input.imagePath)
    ? path.resolve(input.imagePath)
    : path.resolve(rootDir, input.imagePath);
  await assertReadableFile(imagePath, 'image_path');

  const minConfidence = normalizeNumber(input.minConfidence, DEFAULT_CONFIDENCE, 0, 1, 'min_confidence');
  const iouThreshold = normalizeNumber(input.iouThreshold, DEFAULT_IOU, 0, 1, 'iou_threshold');
  const maxDetections = Math.round(normalizeNumber(input.maxDetections, DEFAULT_MAX_DETECTIONS, 1, 1000, 'max_detections'));
  const timeoutMs = Math.round(normalizeNumber(input.timeoutMs, Number(env.CODEBUDDY_YOLO_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000, 600_000, 'timeout_ms'));

  const reportDir = path.join(rootDir, '.codebuddy', 'object-detections');
  await fs.mkdir(reportDir, { recursive: true });

  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const reportId = sanitizeId(options.createId?.() ?? randomUUID());
  const reportPath = path.join(reportDir, `object-detect-${reportId}.json`);
  const saveAnnotated = input.saveAnnotated === true;
  const annotatedImagePath = saveAnnotated
    ? resolveOptionalOutputPath(rootDir, input.annotatedOutputPath, path.join(reportDir, `object-detect-${reportId}.png`))
    : undefined;

  if (annotatedImagePath) {
    await fs.mkdir(path.dirname(annotatedImagePath), { recursive: true });
  }

  const request: YoloDetectionRequest = {
    imagePath,
    modelPath: await resolveModelPath(rootDir, input.modelPath, env),
    pythonPath: await resolvePythonPath(input.pythonPath, env),
    minConfidence,
    iouThreshold,
    ...(normalizeStringArray(input.classes).length > 0 ? { classes: normalizeStringArray(input.classes) } : {}),
    ...(input.device?.trim() ? { device: input.device.trim() } : resolveDevice(env)),
    maxDetections,
    saveAnnotated,
    ...(annotatedImagePath ? { annotatedImagePath } : {}),
    cwd: rootDir,
    timeoutMs,
    env,
  };

  const raw = await (runtime.runYolo ?? runYoloViaPython)(request);
  const detections = raw.detections.map(normalizeDetection);
  const result: ObjectDetectionResult = {
    kind: 'object_detect_result',
    ok: true,
    imagePath,
    modelPath: request.modelPath,
    pythonPath: request.pythonPath,
    reportPath,
    ...(annotatedImagePath ? { annotatedImagePath } : {}),
    generatedAt,
    parameters: {
      minConfidence,
      iouThreshold,
      ...(request.classes ? { classes: request.classes } : {}),
      ...(request.device ? { device: request.device } : {}),
      maxDetections,
    },
    summary: summarizeDetections(detections),
    ...((raw.imageWidth !== undefined || raw.imageHeight !== undefined) ? {
      image: {
        ...(raw.imageWidth !== undefined ? { width: raw.imageWidth } : {}),
        ...(raw.imageHeight !== undefined ? { height: raw.imageHeight } : {}),
      },
    } : {}),
    runtime: {
      engine: 'ultralytics-yolov8',
      ...(raw.inferenceMs !== undefined ? { inferenceMs: raw.inferenceMs } : {}),
    },
    detections,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

async function runYoloViaPython(request: YoloDetectionRequest): Promise<YoloDetectionResponse> {
  const args = [
    '-c',
    YOLO_PYTHON_SNIPPET,
    request.imagePath,
    request.modelPath,
    String(request.minConfidence),
    String(request.iouThreshold),
    request.classes?.join(',') ?? '',
    request.device ?? '',
    String(request.maxDetections),
    request.saveAnnotated ? '1' : '0',
    request.annotatedImagePath ?? '',
  ];

  const { stdout, stderr } = await spawnWithTimeout(
    request.pythonPath,
    args,
    request.cwd,
    request.timeoutMs,
    request.env,
  );

  const parsed = parsePythonJson(stdout);
  if (!isYoloDetectionResponse(parsed)) {
    throw new Error(`YOLO runtime returned an unexpected response: ${stdout.slice(0, 500)}`);
  }
  if (stderr.trim() && process.env.VERBOSE === 'true') {
    process.stderr.write(stderr);
  }
  return parsed;
}

function spawnWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start YOLO runtime (${command}): ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`YOLO runtime timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`YOLO runtime exited with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}: ${stderr || stdout}`.slice(0, 1200)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function resolvePythonPath(input: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const explicit = input?.trim() || env.CODEBUDDY_YOLO_PYTHON?.trim() || env.BUDDY_YOLO_PYTHON?.trim();
  if (explicit) return expandHome(explicit);

  const homePython = path.join(os.homedir(), 'vision_tests', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (await pathExists(homePython)) return homePython;

  return process.platform === 'win32' ? 'python' : 'python3';
}

async function resolveModelPath(rootDir: string, input: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const explicit = input?.trim() || env.CODEBUDDY_YOLO_MODEL?.trim() || env.BUDDY_YOLO_MODEL?.trim();
  if (explicit) return resolvePathMaybeRelative(rootDir, expandHome(explicit));

  const visionTestsDir = path.join(os.homedir(), 'vision_tests');
  const candidates = [
    path.join(visionTestsDir, 'yolov8n.onnx'),
    path.join(visionTestsDir, 'yolov8n.pt'),
    path.join(rootDir, 'yolov8n.onnx'),
    path.join(rootDir, 'yolov8n.pt'),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return 'yolov8n.pt';
}

function resolveDevice(env: NodeJS.ProcessEnv): { device?: string } {
  const device = env.CODEBUDDY_YOLO_DEVICE?.trim() || env.BUDDY_YOLO_DEVICE?.trim();
  return device ? { device } : {};
}

function resolveOptionalOutputPath(rootDir: string, outputPath: string | undefined, fallback: string): string {
  const trimmed = outputPath?.trim();
  if (!trimmed) return fallback;
  return resolvePathMaybeRelative(rootDir, expandHome(trimmed));
}

function resolvePathMaybeRelative(rootDir: string, value: string): string {
  if (!value.includes('/') && !value.includes('\\')) return value;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
}

async function assertReadableFile(filePath: string, name: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`${name} is not a file: ${filePath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('is not a file')) throw error;
    throw new Error(`${name} not found: ${filePath}`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeNumber(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const numeric = value ?? fallback;
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return numeric;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values) return [];
  return values
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

function normalizeDetection(detection: ObjectDetectionItem): ObjectDetectionItem {
  const x1 = round(detection.box.x1);
  const y1 = round(detection.box.y1);
  const x2 = round(detection.box.x2);
  const y2 = round(detection.box.y2);
  return {
    label: detection.label,
    classId: detection.classId,
    confidence: round(detection.confidence, 4),
    box: {
      x1,
      y1,
      x2,
      y2,
      width: round(Math.max(0, x2 - x1)),
      height: round(Math.max(0, y2 - y1)),
    },
  };
}

function summarizeDetections(detections: ObjectDetectionItem[]): ObjectDetectionResult['summary'] {
  const countsByLabel: Record<string, number> = {};
  for (const detection of detections) {
    countsByLabel[detection.label] = (countsByLabel[detection.label] ?? 0) + 1;
  }
  return {
    count: detections.length,
    labels: Object.keys(countsByLabel).sort(),
    countsByLabel,
  };
}

function parsePythonJson(stdout: string): unknown {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep searching; some runtimes print warnings before the real payload.
    }
  }
  throw new Error(`YOLO runtime did not emit JSON output: ${stdout.slice(0, 500)}`);
}

function isYoloDetectionResponse(value: unknown): value is YoloDetectionResponse {
  if (!value || typeof value !== 'object') return false;
  const detections = (value as Record<string, unknown>).detections;
  return Array.isArray(detections);
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || randomUUID();
}

function appendCapped(current: string, addition: string): string {
  const next = current + addition;
  if (Buffer.byteLength(next, 'utf8') <= MAX_CHILD_OUTPUT_BYTES) return next;
  return next.slice(-MAX_CHILD_OUTPUT_BYTES);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const YOLO_PYTHON_SNIPPET = String.raw`
import json
import sys
import time

from ultralytics import YOLO

image_path = sys.argv[1]
model_path = sys.argv[2]
conf = float(sys.argv[3])
iou = float(sys.argv[4])
classes_arg = sys.argv[5]
device_arg = sys.argv[6]
max_det = int(sys.argv[7])
save_annotated = sys.argv[8] == "1"
annotated_path = sys.argv[9]

model = YOLO(model_path, task="detect")

classes = None
if classes_arg:
    names = model.names
    if isinstance(names, dict):
        name_to_id = {str(v).lower(): int(k) for k, v in names.items()}
    else:
        name_to_id = {str(v).lower(): i for i, v in enumerate(names)}
    classes = []
    for raw in classes_arg.split(","):
        token = raw.strip()
        if not token:
            continue
        if token.isdigit():
            classes.append(int(token))
            continue
        class_id = name_to_id.get(token.lower())
        if class_id is None:
            # Informal labels (e.g. curriculum "desk") are mapped in vision-train
            # before we get here. Skip leftovers instead of aborting the scene.
            continue
        classes.append(class_id)
    if not classes:
        classes = None

kwargs = {
    "source": image_path,
    "conf": conf,
    "iou": iou,
    "max_det": max_det,
    "verbose": False,
}
if classes is not None:
    kwargs["classes"] = classes
if device_arg:
    kwargs["device"] = device_arg

started = time.time()
result = model.predict(**kwargs)[0]
inference_ms = int((time.time() - started) * 1000)

detections = []
if result.boxes is not None:
    names = result.names
    for item in result.boxes:
        xyxy = [float(v) for v in item.xyxy[0].tolist()]
        class_id = int(item.cls[0].item())
        confidence = float(item.conf[0].item())
        if isinstance(names, dict):
            label = str(names.get(class_id, class_id))
        else:
            label = str(names[class_id]) if class_id < len(names) else str(class_id)
        detections.append({
            "label": label,
            "classId": class_id,
            "confidence": confidence,
            "box": {
                "x1": xyxy[0],
                "y1": xyxy[1],
                "x2": xyxy[2],
                "y2": xyxy[3],
                "width": max(0.0, xyxy[2] - xyxy[0]),
                "height": max(0.0, xyxy[3] - xyxy[1]),
            },
        })

if save_annotated and annotated_path:
    result.save(filename=annotated_path)

payload = {
    "detections": detections,
    "imageWidth": int(result.orig_shape[1]) if result.orig_shape else None,
    "imageHeight": int(result.orig_shape[0]) if result.orig_shape else None,
    "inferenceMs": inference_ms,
}
print(json.dumps(payload, separators=(",", ":")))
`;
