import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  safeCameraKeyframePath,
  telegramVisionPhotoPath,
} from '../../src/sensory/camera-keyframe-policy.js';

const previousPhotoConsent = process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO;

afterEach(() => {
  if (previousPhotoConsent === undefined) {
    delete process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO;
  } else {
    process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO = previousPhotoConsent;
  }
});

describe('camera keyframe policy', () => {
  it('accepts only bounded image files whose real path stays in the camera spool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-spool-'));
    const outside = await mkdtemp(join(tmpdir(), 'camera-outside-'));
    const safe = join(root, 'frame.jpg');
    const text = join(root, 'frame.txt');
    const secret = join(outside, 'secret.jpg');
    const escape = join(root, 'escape.jpg');
    await writeFile(safe, Buffer.from([0xff, 0xd8, 0xff]));
    await writeFile(text, 'not an image path');
    await writeFile(secret, Buffer.from([0xff, 0xd8, 0xff]));
    await symlink(secret, escape);

    // The policy returns the REAL path (symlink defence); os.tmpdir() is itself a symlink on macOS.
    expect(await safeCameraKeyframePath(safe, { root })).toBe(await realpath(safe));
    expect(await safeCameraKeyframePath(text, { root })).toBeUndefined();
    expect(await safeCameraKeyframePath(secret, { root })).toBeUndefined();
    expect(await safeCameraKeyframePath(escape, { root })).toBeUndefined();
    expect(await safeCameraKeyframePath(safe, { root, maxBytes: 2 })).toBeUndefined();
  });

  it('requires separate explicit consent before a camera image may reach Telegram', () => {
    delete process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO;
    expect(telegramVisionPhotoPath('/spool/frame.jpg')).toBeUndefined();
    process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO = 'true';
    expect(telegramVisionPhotoPath('/spool/frame.jpg')).toBe('/spool/frame.jpg');
  });
});
