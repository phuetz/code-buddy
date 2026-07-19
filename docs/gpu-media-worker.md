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

On Darkstar, the worker itself is started with runner executables and allowed filesystem
roots. Runner arguments are JSON arrays so no command is interpreted by a shell. The
reference deployment keeps PanoWorld in WSL2 and Node on Windows:

```powershell
$env:CODEBUDDY_GPU_WORKER_TOKEN = '<secret-from-a-secret-store>'
$env:CODEBUDDY_PANOWORLD_RUNNER = 'C:\Windows\System32\wsl.exe'
$env:CODEBUDDY_PANOWORLD_RUNNER_ARGS = '["-d","Ubuntu-22.04","--","bash","/mnt/d/DEV/code-buddy-gpu-worker/scripts/gpu-runners/panoworld-wsl.sh"]'
$env:WSLENV = 'CODEBUDDY_GPU_JOB_REQUEST/p:CODEBUDDY_GPU_JOB_RESULT/p:CODEBUDDY_GPU_JOB_ID'
$env:CODEBUDDY_LONGCAT_RUNNER = 'C:\Windows\System32\wsl.exe'
$env:CODEBUDDY_LONGCAT_RUNNER_ARGS = '["-d","Ubuntu-22.04","--","bash","/mnt/d/DEV/code-buddy-gpu-worker/scripts/gpu-runners/longcat-wsl.sh"]'

buddy gpu-worker --host 100.73.222.64 --port 4310 `
  --root D:\DEV D:\LisaMedia --state-dir D:\CodeBuddyData\gpu-worker
```

Install either official checkpoint with a resumable download that checks both the
Hugging Face LFS byte size and SHA-256 before removing the `.partial` suffix. The
installer also seeds the runner's metadata-bound digest cache from that verification,
so the first reconstruction does not reread the multi-gigabyte checkpoint:

```bash
scripts/gpu-runners/download-panoworld-checkpoint.sh 1024
scripts/gpu-runners/download-panoworld-checkpoint.sh 2048
```

`scripts/gpu-runners/start-darkstar-worker.ps1` is the persistent Windows launcher used
by the reference Darkstar installation. It reads the bearer token from an ACL-restricted
file, enables only roots that exist, and never prints the token. The PanoWorld wrapper
pins the WSL Conda environment, CUDA architecture `8.6`, compiler paths and extension
cache before entering `panoworld-runner.py`.

Each runner receives the generated `request.json` as its final argument and writes its
JSON result manifest to `%CODEBUDDY_GPU_JOB_RESULT%`. Standard output/error are bounded
and persisted beside the job. The queue survives restarts; a job interrupted by a worker
restart is marked failed instead of silently re-executed.

Runners can publish live progress with `CODEBUDDY_PROGRESS <0..1> <message>` lines on
standard output. The worker parses split stream chunks safely, exposes the latest bounded
message through job status, and checkpoints logs at each progress transition. Failed jobs
include a bounded final runner diagnostic while the full logs remain on Darkstar.

The request path is also available as `%CODEBUDDY_GPU_JOB_REQUEST%`. This is required
for Windows-to-WSL runners because `WSLENV` translates `/p` path variables without
letting a shell reinterpret Windows backslashes.

The worker also injects `CODEBUDDY_GPU_ALLOWED_ROOTS_JSON` from its trusted `--root`
configuration. The PanoWorld runner canonicalizes the request, result, model,
checkpoint, input and output paths and fails closed if any of them resolves outside
those roots. The Windows launcher forwards this JSON through `WSLENV`; it is not taken
from the submitted payload.

## Protocol

The worker implements four JSON endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/capabilities` | Supported jobs, GPU state and queue depth |
| `POST` | `/v1/jobs` | Submit a validated job |
| `GET` | `/v1/jobs/:id` | Read status, progress and output manifest |
| `DELETE` | `/v1/jobs/:id` | Request cancellation |
| `GET` | `/v1/jobs/:id/artifacts/avatar.mp4` | Download a completed avatar video |

`/v1/capabilities` reports `protocolVersion: 1`; clients fail closed on an unknown
version instead of guessing a payload shape.

Avatar MP4 transfer uses the same bearer authentication. The worker serves only the
fixed `avatar.mp4` name from a successful job, resolves the canonical path back inside
that job directory, rejects empty files and caps responses at 512 MiB. The client checks
the declared and received lengths before exposing the bytes to a channel adapter. When
an avatar payload includes `channelTarget`, Code Buddy monitors the asynchronous job,
downloads the completed MP4 and publishes it to the same conversation/thread. Telegram
uses authenticated multipart upload (50 MiB Bot API limit); the Darkstar bearer URL is
never exposed to Telegram.

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
- `multi-1024`: one to five 1024×512 panoramas, with measured camera-to-world matrices.

Darkstar measurements on GPU 0 (RTX 3090, 24,576 MiB) established the production cap:

| Profile | Views | Elapsed | Observed peak VRAM | Decision |
|---|---:|---:|---:|---|
| `multi-1024` | 4 | 60.9 s | 16,346 MiB | safe |
| `multi-1024` | 5 | 58.6 s | 20,074 MiB | production maximum |
| `multi-1024` | 6 | 61.8 s | 23,826 MiB | experimental only; 750 MiB headroom |

Six views completed on the synthetic smoke scene, but the remaining memory margin is too
small for production scene variance and CUDA fragmentation. Both the public contract and
the isolated runner therefore reject more than five views.

The expected output manifest points to the 3DGS PLY, cameras, rendered panoramas, depth
maps, elapsed time and the verified checkpoint SHA-256. The result is spatial memory,
not semantic object understanding or a native Unreal mesh.

The stable WSL entry point is `scripts/gpu-runners/codebuddy_runner.py`; it replaces
itself with the implementation process so termination signals are preserved. The
shipped runner rejects non-2:1 panoramas and enforces the selected profile's exact
2048×1024 or 1024×512 dimensions, requires measured camera-to-world
poses for `multi-1024`, creates the released RealSee3D directory format in the job
directory, records the pinned upstream commit, and writes the result manifest atomically.
It injects a process-local `sitecustomize` compatibility guard for the released
PyTorch 2.3.1 environment: PanoWorld uses its own RMSNorm implementation but references
the later `torch.nn.RMSNorm` symbol in an initialization type check. The upstream source
and checkpoint remain unchanged.

Checkpoint SHA-256 verification is complete on first use. A sidecar then caches the
digest together with byte size and nanosecond modification time; any file change
invalidates it, while unchanged 4–5 GiB weights avoid roughly one minute of redundant
disk reads per job. Manifests state whether the digest was `computed` or came from the
validated `stat-cache`.

Checkpoint verification and upstream commit resolution happen before the Pickle
checkpoint is loaded. Successful manifests contain `status: "succeeded"`; a SIGTERM or
SIGINT terminates the inference process group and atomically writes a
`status: "cancelled"` manifest carrying the same profile, commit and checkpoint digest.
If the inference process group ignores the graceful signal, the runner escalates to
SIGKILL after a bounded 10-second grace period.

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

The current contract intentionally rejects 720p. The released multi-GPU loader replicates
too much state for two 24 GiB cards, so it is not used by the Darkstar profile.

The reference Darkstar deployment uses a more conservative single-GPU profile. It loads
UMT5 and Whisper sequentially, returns their embeddings to CPU, then streams the official
INT8 DiT shards and distilled LoRA before rendering on GPU 0. This design is derived from
[community PR #115](https://github.com/meituan-longcat/LongCat-Video/pull/115), which is
useful but remains unmerged; Code Buddy owns a hardened adapter that removes shell-built
file and FFmpeg commands, verifies the checkpoint/model key set, stays on INT8 for Ampere
and reports stable progress phases. The adapter replaces the upstream eager dequantizing
linear layers one at a time with TorchAO 0.10 INT8 kernels before `torch.compile`; this
avoids both WSL2 system-memory fallback during denoising and a full-model BF16 conversion
peak.

Install the isolated Python environment and the selective 41.67 GiB checkpoint set in
WSL2. The downloader pins both official Hugging Face revisions, omits duplicate
FP16/FP32/Flax/PyTorch files and verifies every large LFS artifact by byte size and
SHA-256:

```bash
scripts/gpu-runners/setup-longcat-env.sh
scripts/gpu-runners/download-longcat-avatar.sh
```

The validated Darkstar profile renders 93 frames at 25 FPS (3.72 seconds). A real Lisa
portrait-and-French-voice smoke render completed all eight denoising steps in about
4 minutes 14 seconds before VAE decoding. The measured portrait used latent grid
`(24, 44, 34)`, peaked near 24.3 GiB on one RTX 3090, and produced a 544×704 H.264/AAC
MP4. Compile prewarming derives that grid from the actual oriented source image; using a
fixed landscape grid caused WSL2 PCI memory paging and is no longer permitted. Longer
source audio is reported as truncated in the result manifest rather than silently
presented as fully rendered. Video continuation remains disabled until its peak VRAM and
identity drift have been measured on Darkstar.

The runner also owns a fail-closed thermal guard. It reads the physical GPU selected by
`CUDA_VISIBLE_DEVICES` before startup and every three seconds during inference. The
Darkstar launcher sets `CODEBUDDY_GPU_MAX_TEMP_C=88`; startup is refused at or above that
limit, and two consecutive hot samples terminate the complete inference process group.
An unreadable sensor also stops the job. The limit may be configured only between 70 and
92 °C, so a deployment cannot accidentally turn the guard into an unbounded value. This
gate was added after a private pilot reached 95 °C on GPU 0; that attempt was cancelled
before an MP4 was produced and must not be treated as a valid quality sample.

The upstream saver assumes a GPL-enabled FFmpeg and tries to re-encode the already-H.264
intermediate with `libx264`. The isolated Conda build intentionally omits that encoder.
The hardened adapter therefore falls back to losslessly stream-copying the existing H.264
video while encoding only the AAC audio, then removes its temporary files.

The first profile targets clean Lisa TTS audio directly; the optional 67 MB vocal
separator is intentionally omitted. Music/mixed-audio isolation can be enabled later as
a distinct measured profile.

`start-darkstar-worker.ps1` does not advertise `avatar_video_render` merely because files
were downloaded. LongCat is enabled only when a successful real smoke render writes a
JSON `D:\CodeBuddyData\gpu-worker\longcat-ready` marker containing the exact runner,
upstream and two checkpoint revisions. The current hardened contract requires
`runnerVersion: "2"`; a stale or incompatible marker fails closed.
Removing the marker and restarting the scheduled task rolls the capability back without
affecting PanoWorld.

The scheduled-task launcher also waits up to 120 seconds for its configured Tailscale
address. This closes the reboot race where Windows launched the task before the private
interface was ready and left the worker stopped.

## Operational gates

1. Pin the upstream commit and record checkpoint hashes.
2. Load PyTorch pickle checkpoints only inside an isolated conversion environment.
3. Restrict all input/output paths to configured worker roots.
4. Use argument arrays, never a concatenated shell command.
5. Limit one task per GPU, expose progress, support cancellation, enforce timeouts and
   stop inference before a sustained over-temperature condition.
6. Keep household scans local by default and delete temporary inputs explicitly.
