import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import type { CommercialGateReceipt } from './trailer-commercial-gate.js';

export const END_CARD_DURATION_SECONDS = 4;
export const END_CARD_SAFE_MARGIN_RATIO = 0.1;
export const END_CARD_MIN_CONTRAST = 4.5;
export const END_CARD_BACKGROUND = '#111827';
export const END_CARD_FOREGROUND = '#FFFFFF';
export const END_CARD_ACCENT = '#F5C451';

export interface EndCardTextBox {
  id: 'title' | 'author' | 'status' | 'cta' | 'url';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
}

export interface TrailerEndCardSpec {
  width: number;
  height: number;
  durationSeconds: number;
  safeMarginX: number;
  safeMarginY: number;
  background: string;
  boxes: EndCardTextBox[];
}

interface ProcessResult {
  code: number | null;
  stderr: string;
}

export interface TrailerEndCardDependencies {
  spawn?: typeof realSpawn;
  ffmpegBin?: string;
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const match = /^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/iu.exec(color);
  if (!match) throw new Error(`Invalid end-card color: ${color}`);
  return (
    0.2126 * linearChannel(Number.parseInt(match[1]!, 16)) +
    0.7152 * linearChannel(Number.parseInt(match[2]!, 16)) +
    0.0722 * linearChannel(Number.parseInt(match[3]!, 16))
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)]
    .sort((left, right) => right - left);
  return (high! + 0.05) / (low! + 0.05);
}

function overlaps(left: EndCardTextBox, right: EndCardTextBox): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

/** Mobile-safe end card: complete fields, >=4 s, >=4.5:1 and no overlaps. */
export function buildTrailerEndCardSpec(
  commercial: CommercialGateReceipt,
  dimensions: { width: number; height: number } = { width: 1920, height: 1080 },
): TrailerEndCardSpec {
  const { width, height } = dimensions;
  if (width < 640 || height < 640) throw new Error('End card requires at least 640x640');
  const marginX = Math.round(width * END_CARD_SAFE_MARGIN_RATIO);
  const marginY = Math.round(height * END_CARD_SAFE_MARGIN_RATIO);
  const usableWidth = width - marginX * 2;
  const titleHeight = Math.round(height * 0.13);
  const rowHeight = Math.round(height * 0.075);
  const gap = Math.round(height * 0.025);
  const contentHeight = titleHeight + rowHeight * 4 + gap * 4;
  const startY = Math.max(marginY, Math.round((height - contentHeight) / 2));
  const row = (
    id: EndCardTextBox['id'],
    text: string,
    index: number,
    fontSize: number,
    color = END_CARD_FOREGROUND,
  ): EndCardTextBox => ({
    id,
    text,
    x: marginX,
    y: startY + titleHeight + gap + index * (rowHeight + gap),
    width: usableWidth,
    height: rowHeight,
    fontSize,
    color,
  });
  const boxes: EndCardTextBox[] = [
    {
      id: 'title',
      text: commercial.title,
      x: marginX,
      y: startY,
      width: usableWidth,
      height: titleHeight,
      fontSize: Math.max(64, Math.round(height * 0.075)),
      color: END_CARD_FOREGROUND,
    },
    row('author', 'Patrice Huetz', 0, Math.max(42, Math.round(height * 0.044)), END_CARD_ACCENT),
    row('status', 'MANUSCRIT COMPLET · ÉDITION APPROUVÉE', 1, Math.max(32, Math.round(height * 0.032))),
    row('cta', commercial.cta, 2, Math.max(40, Math.round(height * 0.04))),
    row('url', commercial.url, 3, Math.max(30, Math.round(height * 0.03)), END_CARD_ACCENT),
  ];
  if (boxes.some((box) => !box.text.trim())) throw new Error('End card has an empty required field');
  if (boxes.some((box) =>
    box.x < marginX ||
    box.y < marginY ||
    box.x + box.width > width - marginX ||
    box.y + box.height > height - marginY
  )) {
    throw new Error('End card violates the mobile safe area');
  }
  if (boxes.some((left, index) => boxes.slice(index + 1).some((right) => overlaps(left, right)))) {
    throw new Error('End card text boxes overlap');
  }
  if (boxes.some((box) => contrastRatio(box.color, END_CARD_BACKGROUND) < END_CARD_MIN_CONTRAST)) {
    throw new Error('End card text contrast is below 4.5:1');
  }
  return {
    width,
    height,
    durationSeconds: END_CARD_DURATION_SECONDS,
    safeMarginX: marginX,
    safeMarginY: marginY,
    background: END_CARD_BACKGROUND,
    boxes,
  };
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/'/gu, '’')
    .replace(/:/gu, '\\:')
    .replace(/%/gu, '\\%')
    .replace(/\[/gu, '\\[')
    .replace(/\]/gu, '\\]')
    .replace(/,/gu, '\\,')
    .replace(/;/gu, '\\;');
}

export function buildEndCardVideoFilter(spec: TrailerEndCardSpec): string {
  return spec.boxes.map((box) => [
    `drawtext=text='${escapeDrawtext(box.text)}'`,
    `fontcolor=${box.color}`,
    `fontsize=${box.fontSize}`,
    `x=${box.x}+(w-${box.x * 2}-text_w)/2`,
    `y=${box.y}+(${box.height}-text_h)/2`,
    'shadowcolor=black@0.85',
    'shadowx=3',
    'shadowy=3',
  ].join(':')).join(',');
}

function runProcess(
  spawn: typeof realSpawn,
  command: string,
  args: string[],
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-100_000);
    });
    child.on('error', (error) => resolve({ code: null, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

export async function renderTrailerEndCard(
  commercial: CommercialGateReceipt,
  destinationInput: string,
  dependencies: TrailerEndCardDependencies = {},
): Promise<{ path: string; spec: TrailerEndCardSpec }> {
  const destination = path.resolve(destinationInput);
  const spec = buildTrailerEndCardSpec(commercial);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.tmp.mp4`,
  );
  const result = await runProcess(
    dependencies.spawn ?? realSpawn,
    dependencies.ffmpegBin ?? 'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=${spec.background}:s=${spec.width}x${spec.height}:r=30:d=${spec.durationSeconds}`,
      '-vf',
      buildEndCardVideoFilter(spec),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      temporary,
    ],
  );
  if (result.code !== 0) {
    await fs.rm(temporary, { force: true });
    throw new Error(`End-card render failed: ${result.stderr.trim().split('\n').slice(-5).join(' | ')}`);
  }
  await fs.rename(temporary, destination);
  return { path: destination, spec };
}
