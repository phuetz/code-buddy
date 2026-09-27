/**
 * `buddy screen` — capture / record / watch the screen or a window.
 *
 *   buddy screen capture [--out f.png] [--region WxH+x,y] [--display :0.0]
 *   buddy screen record  [--out f.mp4] [--fps N] [--duration S] [--region ...]
 *   buddy screen watch   [--interval S] [--ocr] [--max N] [--out journal.jsonl]
 *   buddy screen list-windows
 *
 * Built on src/capture (ScreenRecorder + ScreenWatcher). On Linux this uses
 * ffmpeg x11grab (X11 only — Wayland is detected and refused). `watch` is the
 * "know in real time what's on the machine" loop: it dedups idle frames and
 * (with --ocr) redacts secrets/PII via the fleet privacy-lint before printing.
 */
import type { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import type { CaptureRegion } from '../../capture/screen-recorder.js';

function parseRegion(spec?: string): CaptureRegion | undefined {
  if (!spec) return undefined;
  const m = /^(\d+)x(\d+)(?:\+(\d+),(\d+))?$/.exec(spec.trim());
  if (!m) throw new Error(`invalid --region "${spec}" (expected WxH or WxH+x,y)`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width <= 0 || height <= 0) {
    throw new Error(`invalid --region "${spec}" (width and height must be > 0)`);
  }
  const region: CaptureRegion = { width, height };
  if (m[3] !== undefined) {
    region.x = Number(m[3]);
    region.y = Number(m[4]);
  }
  return region;
}

/** Best-effort full-screen size from xrandr; falls back to 1920x1080. */
function screenSize(): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    execFile('xrandr', [], { timeout: 4000 }, (err, stdout) => {
      const m = err ? null : /current (\d+) x (\d+)/.exec(stdout);
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 });
    });
  });
}

function defaultOut(ext: string): string {
  const dir = path.join(os.tmpdir(), 'codebuddy-screen');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${ext === 'mp4' ? 'recording' : 'frame'}-${Date.now()}.${ext}`);
}

export function registerScreenCommands(program: Command): void {
  const screen = program.command('screen').description('Capture, record, or watch the screen / a window');

  screen
    .command('capture')
    .description('Capture a single frame to an image file')
    .option('--out <file>', 'output image (png/jpg)')
    .option('--region <WxH+x,y>', 'sub-region, e.g. 800x600+100,50')
    .option('--display <d>', 'X11 display (default $DISPLAY)')
    .action(async (opts: { out?: string; region?: string; display?: string }) => {
      const { ScreenRecorder } = await import('../../capture/screen-recorder.js');
      const out = opts.out || defaultOut('png');
      const region = parseRegion(opts.region);
      const target = { ...(region ? { region } : { screenSize: await screenSize() }), ...(opts.display ? { display: opts.display } : {}) };
      await new ScreenRecorder().captureFrame(out, target);
      console.log(`Captured ${out}`);
    });

  screen
    .command('record')
    .description('Record screen video (Ctrl-C to stop, or --duration)')
    .option('--out <file>', 'output video (mp4)')
    .option('--fps <n>', 'frames per second', '15')
    .option('--duration <s>', 'stop after N seconds')
    .option('--region <WxH+x,y>', 'sub-region, e.g. 1280x720+0,0')
    .option('--display <d>', 'X11 display (default $DISPLAY)')
    .option('--codec <c>', 'libx264 (default) | h264_vaapi | av1_vaapi (GPU encode, lower CPU)')
    .option('--qp <n>', 'VAAPI quantizer (lower=better/bigger)')
    .option('--scale <w[xh]>', 'downscale before encode, e.g. 1280 or 1280x720')
    .action(async (opts: { out?: string; fps: string; duration?: string; region?: string; display?: string; codec?: string; qp?: string; scale?: string }) => {
      const { ScreenRecorder, hasVaapiDevice } = await import('../../capture/screen-recorder.js');
      const out = opts.out || defaultOut('mp4');
      const region = parseRegion(opts.region);
      const codec = (opts.codec as 'libx264' | 'h264_vaapi' | 'av1_vaapi' | undefined) ?? 'libx264';
      let scale: { width: number; height?: number } | undefined;
      if (opts.scale) {
        const [w, h] = opts.scale.split('x');
        scale = { width: Number(w), ...(h ? { height: Number(h) } : {}) };
      }
      if (codec === 'libx264' && hasVaapiDevice()) {
        console.log('tip: a VAAPI GPU encoder is available — add `--codec h264_vaapi` (faster, lower CPU) or `--codec av1_vaapi` (smaller files).');
      }
      const rec = new ScreenRecorder();
      rec.start(out, {
        fps: parseInt(opts.fps, 10) || 15,
        codec,
        ...(opts.qp ? { qp: parseInt(opts.qp, 10) } : {}),
        ...(scale ? { scale } : {}),
        ...(opts.duration ? { durationSec: parseInt(opts.duration, 10) } : {}),
        ...(region ? { region } : { screenSize: await screenSize() }),
        ...(opts.display ? { display: opts.display } : {}),
      });
      console.log(`Recording → ${out}${opts.duration ? ` (${opts.duration}s)` : ' (Ctrl-C to stop)'}`);
      const finish = async () => {
        await rec.stop();
        console.log(`\nSaved ${out}`);
        process.exit(0);
      };
      process.once('SIGINT', finish);
      if (opts.duration) {
        setTimeout(finish, (parseInt(opts.duration, 10) + 1) * 1000);
      }
    });

  screen
    .command('watch')
    .description('Watch the screen: periodic frames, idle-dedup, optional OCR + secret redaction')
    .option('--interval <s>', 'seconds between frames', '5')
    .option('--ocr', 'OCR changed frames (needs tesseract) and redact secrets/PII')
    .option('--repair', 'detect errors/stack traces on screen and localize the fault (implies --ocr)')
    .option('--max <n>', 'stop after N frames (default: until Ctrl-C)')
    .option('--out <file>', 'append observations/suggestions as JSONL to this file')
    .action(async (opts: { interval: string; ocr?: boolean; repair?: boolean; max?: string; out?: string }) => {
      const intervalMs = (parseInt(opts.interval, 10) || 5) * 1000;
      const maxFrames = opts.max ? parseInt(opts.max, 10) : Infinity;

      // Offload frame dedup to the codebuddy-captured Rust daemon (perceptual
      // hash — robust to lossy re-encode) when it's built; else JS sha1.
      const { getCapturedBridge } = await import('../../capture/captured-bridge.js');
      const bridge = getCapturedBridge();
      const fingerprint = bridge.isAvailable() ? (p: string) => bridge.phash(p) : undefined;
      if (fingerprint) console.log('using codebuddy-captured (Rust) for perceptual-hash dedup.');

      // --repair: screen → OCR → error detect → FaultLocalizer (AutoRepair engine).
      if (opts.repair) {
        const { ScreenErrorWatcher } = await import('../../capture/screen-error-watcher.js');
        let n = 0;
        const ew = new ScreenErrorWatcher({
          watcher: { intervalMs, ...(fingerprint ? { fingerprint } : {}) },
          onObservation: (obs) => {
            if (obs.changed && obs.text) console.log(`[CHANGED] ${obs.text.replace(/\s+/g, ' ').slice(0, 120)}`);
          },
          onSuggestion: (s) => {
            console.log(`\n⚠️  Error on screen (${s.error.pattern}) → likely fault:`);
            const faults = s.localization.faults.slice(0, 3);
            if (faults.length === 0) {
              console.log('   (no source location parsed from the text)');
            }
            for (const f of faults) {
              const pct = Math.round((f.suspiciousness ?? 0) * 100);
              console.log(`   ${f.location.file}:${f.location.startLine}  ${pct}%  ${f.message.replace(/\s+/g, ' ').slice(0, 90)}`);
            }
            const firstLine = (s.error.text.split('\n')[0] ?? s.error.text).slice(0, 80);
            console.log(`   → try:  buddy --prompt "fix ${faults[0]?.location.file ?? 'the error'} — ${firstLine}"\n`);
            if (opts.out) fs.appendFileSync(opts.out, JSON.stringify(s) + '\n');
          },
        });
        console.log(`Watching for errors every ${opts.interval}s → fault localization. Ctrl-C to stop.`);
        process.once('SIGINT', () => process.exit(0));
        const tick = async () => {
          try {
            await ew.tick();
          } catch (err) {
            console.error(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
          }
          if (++n >= maxFrames) process.exit(0);
          setTimeout(() => void tick(), intervalMs);
        };
        void tick();
        return;
      }

      const { ScreenWatcher } = await import('../../capture/screen-watcher.js');
      let n = 0;
      const watcher = new ScreenWatcher({
        intervalMs,
        ocr: Boolean(opts.ocr),
        ...(fingerprint ? { fingerprint } : {}),
        onObservation: (obs) => {
          const tag = obs.changed ? 'CHANGED' : 'idle';
          const line = obs.text
            ? `[${tag}] ${obs.redacted ? '(redacted) ' : ''}${obs.text.replace(/\s+/g, ' ').slice(0, 160)}`
            : `[${tag}] ${path.basename(obs.framePath)}`;
          console.log(line);
          if (opts.out) fs.appendFileSync(opts.out, JSON.stringify(obs) + '\n');
        },
      });
      console.log(`Watching every ${opts.interval}s${opts.ocr ? ' (OCR+redact)' : ''}${opts.out ? ` → ${opts.out}` : ''}. Ctrl-C to stop.`);
      // Drive ticks ourselves so --max and errors are visible.
      const tickOnce = async () => {
        try {
          await watcher.tick();
        } catch (err) {
          console.error(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        if (++n >= maxFrames) process.exit(0);
        setTimeout(() => void tickOnce(), (parseInt(opts.interval, 10) || 5) * 1000);
      };
      process.once('SIGINT', () => process.exit(0));
      void tickOnce();
    });

  screen
    .command('list-windows')
    .description('List open windows (X11, via xwininfo) for --region targeting')
    .action(async () => {
      execFile('xwininfo', ['-root', '-tree'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          console.error('xwininfo unavailable (install x11-utils), or not an X11 session.');
          process.exit(1);
          return;
        }
        const lines = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /0x[0-9a-f]+/.test(l) && /\d+x\d+\+\d+\+\d+/.test(l) && /"/.test(l));
        for (const l of lines.slice(0, 40)) {
          const geo = /(\d+x\d+\+\d+\+\d+)/.exec(l)?.[1] ?? '';
          const title = /"([^"]+)"/.exec(l)?.[1] ?? '';
          if (title) console.log(`${geo.padEnd(20)} ${title}`);
        }
      });
    });
}
