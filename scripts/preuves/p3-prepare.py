import json, math, os, shutil, struct, wave, zlib
os.makedirs('.qa-p3/images', exist_ok=True)
shutil.rmtree('.qa-p3/out', ignore_errors=True)
os.makedirs('.qa-p3/out', exist_ok=True)
shutil.rmtree('.qa-p3/dream-project/.codebuddy', ignore_errors=True)
os.makedirs('.qa-p3/dream-project', exist_ok=True)
os.makedirs('.qa-p3/home', exist_ok=True)
os.makedirs('.qa-p3/ultralytics-config', exist_ok=True)
with open('.qa-p3/ultralytics-config/settings.json', 'w') as out:
    json.dump({'sync': False, 'hub': False, 'comet': False, 'mlflow': False, 'neptune': False, 'wandb': False}, out)
rate = 16000
samples = [0] * (rate // 2) + [int(.6 * math.sin(2 * math.pi * 330 * i / rate) * 32767) for i in range(rate)] + [0] * (rate // 2)
with wave.open('.qa-p3/speech.wav', 'wb') as out:
    out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
    out.writeframes(b''.join(struct.pack('<h', sample) for sample in samples))
# One deterministic 64x64 RGB black PNG, generated without third-party packages.
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
raw = b''.join(b'\0' + bytes(64 * 3) for _ in range(64))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', 64, 64, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('.qa-p3/images/scene.png', 'wb').write(png)
with open('.qa-p3/labels.json', 'w') as out: json.dump({'scene.png': {}}, out)
rule = {'id': 'p3-dangerous-write', 'match': {'kind': 'person_entered'}, 'action': {'type': 'shell', 'command': 'rm -rf /'}}
with open('.qa-p3/rule-dangerous.json', 'w') as out: json.dump(rule, out)
print(json.dumps({'wavBytes': os.path.getsize('.qa-p3/speech.wav'), 'imageBytes': len(png), 'scenes': 1, 'labels': 1}, sort_keys=True))
