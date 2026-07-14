# GPU media worker (Darkstar)

Code Buddy keeps heavyweight CUDA runtimes outside the CLI and Cowork processes. The
`gpu_media_job` tool talks to one authenticated worker over HTTPS or a private/Tailscale
HTTP address.

## Configuration

```bash
export CODEBUDDY_GPU_WORKER_URL=http://100.73.222.64:4310
export CODEBUDDY_GPU_WORKER_TOKEN='use-a-random-secret-reference'
```

The token is sent only as `Authorization: Bearer …` and is never included in a job body
or tool result. Plain HTTP is rejected for public addresses. Prefer a Tailscale ACL that
only permits the Code Buddy host to reach the worker port.

## Protocol

The worker implements four JSON endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/capabilities` | Supported jobs, GPU state and queue depth |
| `POST` | `/v1/jobs` | Submit a validated job |
| `GET` | `/v1/jobs/:id` | Read status, progress and output manifest |
| `DELETE` | `/v1/jobs/:id` | Request cancellation |

Job states are `queued`, `running`, `succeeded`, `failed`, or `cancelled`. A worker must
serialize incompatible loads: PanoWorld and LongCat must not occupy the same RTX 3090 at
the same time.

## PanoWorld

Only the reconstruction component published by the PanoWorld authors is targeted. The
unpublished floorplan/style generator is not represented as available.

```json
{
  "kind": "panoworld_reconstruct",
  "payload": {
    "sceneId": "living-room",
    "profile": "single-2048",
    "panoramas": [
      {
        "imagePath": "D:\\captures\\living-room.jpg",
        "roomId": "living-room"
      }
    ],
    "outputDir": "D:\\DEV\\PanoWorld\\outputs\\living-room"
  }
}
```

Profiles are deliberately bounded:

- `single-2048`: one 2048×1024 panorama, identity pose permitted;
- `multi-1024`: one to six 1024×512 panoramas, with measured camera-to-world matrices.

The expected output manifest points to the 3DGS PLY, cameras, rendered panoramas, depth
maps, elapsed time and the verified checkpoint SHA-256. The result is spatial memory,
not semantic object understanding or a native Unreal mesh.

## LongCat avatar

LongCat is an asynchronous pixel-video renderer. Voice/text delivery must complete
without waiting for it; the MP4 can be added later to the same channel conversation.

```json
{
  "kind": "avatar_video_render",
  "payload": {
    "turnId": "telegram-1234",
    "audioPath": "D:\\lisa\\turn-1234.wav",
    "referenceImagePath": "D:\\lisa\\portrait.png",
    "prompt": "Lisa répond calmement face caméra.",
    "resolution": "480p",
    "channelTarget": {
      "channel": "telegram",
      "conversationId": "patrice"
    }
  }
}
```

The current contract intentionally rejects 720p. Before enabling the worker, adapt the
official loader so Whisper and UMT5 run on one rank, their embeddings are broadcast and
the encoders are unloaded before the INT8 DiT is loaded.

## Operational gates

1. Pin the upstream commit and record checkpoint hashes.
2. Load PyTorch pickle checkpoints only inside an isolated conversion environment.
3. Restrict all input/output paths to configured worker roots.
4. Use argument arrays, never a concatenated shell command.
5. Limit one task per GPU, expose progress, support cancellation and enforce timeouts.
6. Keep household scans local by default and delete temporary inputs explicitly.
