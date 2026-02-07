---
name: ableton-live
version: 1.0.0
description: Ableton Live music production automation via OSC protocol, MIDI, and Max for Live
author: Code Buddy
tags: music, audio, daw, production, osc, midi, max-for-live
env:
  ABLETON_OSC_HOST: "127.0.0.1"
  ABLETON_OSC_PORT: "11000"
---

# Ableton Live Automation

Automate Ableton Live music production workflows using OSC (Open Sound Control) protocol, MIDI scripting, and Max for Live devices. Control transport, clips, tracks, effects, and mixing.

## Direct Control (CLI / API / Scripting)

### OSC (Open Sound Control) Protocol

Ableton Live can be controlled via OSC using third-party tools like Connection Kit or LiveOSC.

#### Setup Connection Kit
1. Install Connection Kit Max for Live device
2. Configure OSC input/output ports (default: 11000)
3. Enable in Live preferences

```bash
# Install OSC client libraries
pip install python-osc

# Node.js
npm install osc-js
```

#### Python OSC Client

```python
from pythonosc import udp_client
from pythonosc import osc_message_builder
import time

# Create OSC client
client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Transport control
client.send_message("/live/song/start_playing", [])
time.sleep(5)
client.send_message("/live/song/stop_playing", [])

# Set tempo
client.send_message("/live/song/set/tempo", [120.0])

# Set time signature
client.send_message("/live/song/set/signature_numerator", [4])
client.send_message("/live/song/set/signature_denominator", [4])

# Jump to specific time
client.send_message("/live/song/set/current_song_time", [16.0])  # 16 beats

# Track control
track_id = 0  # First track

# Set track volume (0.0 to 1.0)
client.send_message(f"/live/track/{track_id}/set/volume", [0.8])

# Set track pan (-1.0 to 1.0)
client.send_message(f"/live/track/{track_id}/set/panning", [0.0])

# Mute/unmute track
client.send_message(f"/live/track/{track_id}/set/mute", [1])  # 1 = mute, 0 = unmute

# Solo track
client.send_message(f"/live/track/{track_id}/set/solo", [1])

# Arm track for recording
client.send_message(f"/live/track/{track_id}/set/arm", [1])

# Clip control
scene_id = 0  # First scene
clip_slot = 0

# Fire clip
client.send_message(f"/live/track/{track_id}/clip/{clip_slot}/fire", [])

# Stop clip
client.send_message(f"/live/track/{track_id}/clip/{clip_slot}/stop", [])

# Set clip name
client.send_message(f"/live/track/{track_id}/clip/{clip_slot}/set/name", ["MyClip"])

# Device parameter control
device_id = 0
param_id = 0

# Set device parameter (0.0 to 1.0)
client.send_message(f"/live/track/{track_id}/device/{device_id}/set/parameters/{param_id}", [0.5])

# Get device parameter value
client.send_message(f"/live/track/{track_id}/device/{device_id}/get/parameters/{param_id}", [])
```

#### JavaScript OSC Client (Node.js)

```javascript
const OSC = require('osc-js');

const osc = new OSC({
  plugin: new OSC.DatagramPlugin({
    open: { host: '127.0.0.1', port: 11001 },
    send: { host: '127.0.0.1', port: 11000 }
  })
});

osc.open();

// Play/stop transport
osc.send(new OSC.Message('/live/song/start_playing'));

setTimeout(() => {
  osc.send(new OSC.Message('/live/song/stop_playing'));
}, 5000);

// Set tempo
osc.send(new OSC.Message('/live/song/set/tempo', 128.0));

// Fire clip
osc.send(new OSC.Message('/live/track/0/clip/0/fire'));

// Set track volume
osc.send(new OSC.Message('/live/track/0/set/volume', 0.75));

// Listen for responses
osc.on('/live/*', (message) => {
  console.log('Received:', message.address, message.args);
});
```

### MIDI Scripting (Control Surface Scripts)

Ableton Live uses Python 2.7 for MIDI Remote Scripts.

```python
# Location: /Applications/Ableton Live.app/Contents/App-Resources/MIDI Remote Scripts/

from __future__ import with_statement
import Live
from _Framework.ControlSurface import ControlSurface
from _Framework.InputControlElement import MIDI_CC_TYPE, MIDI_NOTE_TYPE

class CustomController(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self.show_message("Custom Controller Loaded")

        # Access Live API
        self.song = self.song()
        self.application = Live.Application.get_application()

        # Listen to tempo changes
        self.song.add_tempo_listener(self._on_tempo_changed)

    def disconnect(self):
        self.song.remove_tempo_listener(self._on_tempo_changed)
        ControlSurface.disconnect(self)

    def _on_tempo_changed(self):
        tempo = self.song.tempo
        self.show_message(f"Tempo changed to: {tempo}")

    # Example: Map MIDI CC to track volume
    def setup_mixer_control(self):
        track = self.song.tracks[0]
        mixer_device = track.mixer_device

        # CC 7 controls volume
        # This is a simplified example
        mixer_device.volume.value = 0.8  # Set to 80%
```

### Max for Live API

Max for Live provides direct access to Live's API using JavaScript.

```javascript
// Max for Live JavaScript (js object)

// Get Live API objects
var liveSet = new LiveAPI("live_set");
var track = new LiveAPI("live_set tracks 0");

// Get tempo
liveSet.get("tempo");
// Returns: tempo 120.0

// Set tempo
liveSet.set("tempo", 128);

// Play/stop
liveSet.call("start_playing");
liveSet.call("stop_playing");

// Track operations
track.get("volume");
track.set("volume", 0.8);

track.get("panning");
track.set("panning", 0.0);

track.set("mute", 1);  // Mute
track.set("solo", 1);  // Solo

// Fire clip
var clipSlot = new LiveAPI("live_set tracks 0 clip_slots 0");
clipSlot.call("fire");

// Device control
var device = new LiveAPI("live_set tracks 0 devices 0");
device.get("parameters");

var param = new LiveAPI("live_set tracks 0 devices 0 parameters 0");
param.set("value", 64);

// Scene launch
var scene = new LiveAPI("live_set scenes 0");
scene.call("fire");

// Listen to property changes
track.property = "volume";
track.callback = function(args) {
    post("Volume changed to: " + args[1] + "\n");
};
```

### AbletonOSC (Alternative OSC Server)

```bash
# Install AbletonOSC
# Download from: https://github.com/ideoforms/AbletonOSC

# Start with command-line arguments
python ableton_osc.py --host 127.0.0.1 --port 11000
```

#### AbletonOSC Python Client

```python
from pythonosc import udp_client

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Extended API commands
# Query information
client.send_message("/live/query/song/tracks", [])
client.send_message("/live/query/song/scenes", [])
client.send_message("/live/query/track/0/devices", [])

# Create new track
client.send_message("/live/song/create_audio_track", [-1])  # -1 = at end

# Create new scene
client.send_message("/live/song/create_scene", [-1])

# Record enable
client.send_message("/live/song/set/session_record", [1])

# Overdub
client.send_message("/live/song/set/overdub", [1])

# Metronome
client.send_message("/live/song/set/metronome", [1])

# Quantization
client.send_message("/live/song/set/clip_trigger_quantization", [1])  # 1 bar
```

## MCP Server Integration

Add to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "ableton-live": {
      "command": "node",
      "args": ["/path/to/ableton-live-mcp-server/dist/index.js"],
      "env": {
        "ABLETON_OSC_HOST": "127.0.0.1",
        "ABLETON_OSC_PORT": "11000"
      }
    }
  }
}
```

### Available MCP Tools

- `ableton_transport_play` - Start playback
- `ableton_transport_stop` - Stop playback
- `ableton_transport_record` - Start/stop recording
- `ableton_set_tempo` - Set project tempo
- `ableton_fire_clip` - Trigger clip in track/scene
- `ableton_set_track_volume` - Set track volume
- `ableton_set_track_pan` - Set track panning
- `ableton_mute_track` - Mute/unmute track
- `ableton_solo_track` - Solo/unsolo track
- `ableton_arm_track` - Arm track for recording
- `ableton_set_device_param` - Set device parameter value
- `ableton_create_track` - Create new audio/MIDI track
- `ableton_launch_scene` - Launch entire scene

## Common Workflows

### 1. Automated Live Performance Controller

```python
from pythonosc import udp_client
import time
import random

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Performance script: Launch clips in sequence with variations
scenes = 8
tracks = 4

# Start playback
client.send_message("/live/song/start_playing", [])

for scene_id in range(scenes):
    print(f"Launching scene {scene_id}")

    # Fire all clips in scene
    for track_id in range(tracks):
        client.send_message(f"/live/track/{track_id}/clip/{scene_id}/fire", [])

        # Random volume variations
        volume = random.uniform(0.6, 1.0)
        client.send_message(f"/live/track/{track_id}/set/volume", [volume])

    # Wait for scene duration (e.g., 4 bars at 120 BPM = 8 seconds)
    time.sleep(8)

    # Transition effect: reduce volume on previous scene
    if scene_id > 0:
        for track_id in range(tracks):
            client.send_message(f"/live/track/{track_id}/clip/{scene_id - 1}/stop", [])

print("Performance complete")
client.send_message("/live/song/stop_playing", [])
```

### 2. Batch Audio Export

```python
from pythonosc import udp_client
import time

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Export each track as separate audio file
num_tracks = 8
song_length = 240.0  # seconds

for track_id in range(num_tracks):
    print(f"Exporting track {track_id}")

    # Solo current track
    for t in range(num_tracks):
        if t == track_id:
            client.send_message(f"/live/track/{t}/set/solo", [1])
        else:
            client.send_message(f"/live/track/{t}/set/solo", [0])

    # Reset playback position
    client.send_message("/live/song/set/current_song_time", [0.0])

    # Start playback and record (manual: set recording output in Live)
    client.send_message("/live/song/start_playing", [])

    # Wait for song duration
    time.sleep(song_length)

    # Stop playback
    client.send_message("/live/song/stop_playing", [])

    time.sleep(2)  # Buffer time

print("Batch export complete (check Live's recording folder)")
```

### 3. Dynamic Mixing Automation

```python
from pythonosc import udp_client
import time
import math

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Create smooth fade in/out automation
track_id = 0
duration = 10.0  # seconds
steps = 100

# Fade in
print("Fading in...")
for i in range(steps):
    volume = (i / steps)
    client.send_message(f"/live/track/{track_id}/set/volume", [volume])
    time.sleep(duration / steps)

time.sleep(5)

# Fade out
print("Fading out...")
for i in range(steps):
    volume = 1.0 - (i / steps)
    client.send_message(f"/live/track/{track_id}/set/volume", [volume])
    time.sleep(duration / steps)

# LFO-style panning
print("Auto-panning...")
for i in range(200):
    pan = math.sin(i * 0.1)  # Oscillate between -1 and 1
    client.send_message(f"/live/track/{track_id}/set/panning", [pan])
    time.sleep(0.05)

# Reset
client.send_message(f"/live/track/{track_id}/set/volume", [0.8])
client.send_message(f"/live/track/{track_id}/set/panning", [0.0])
```

### 4. Generative Clip Launcher

```python
from pythonosc import udp_client
import random
import time

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Generative algorithm: randomly trigger clips
tracks = 4
scenes = 8
iterations = 50

client.send_message("/live/song/start_playing", [])

for i in range(iterations):
    # Random clip selection
    track_id = random.randint(0, tracks - 1)
    scene_id = random.randint(0, scenes - 1)

    # Fire clip
    client.send_message(f"/live/track/{track_id}/clip/{scene_id}/fire", [])
    print(f"Fired: Track {track_id}, Scene {scene_id}")

    # Random effect modulation
    device_id = 0
    param_id = random.randint(0, 3)
    param_value = random.uniform(0.0, 1.0)
    client.send_message(f"/live/track/{track_id}/device/{device_id}/set/parameters/{param_id}", [param_value])

    # Wait random interval (1-4 bars at 120 BPM)
    wait_time = random.uniform(2, 8)
    time.sleep(wait_time)

print("Generative session complete")
```

### 5. Sync with External Systems (MIDI Clock)

```python
from pythonosc import udp_client
import mido
import time

# Send MIDI clock synced with Ableton tempo
osc_client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Open MIDI output
midi_out = mido.open_output('IAC Driver Bus 1')  # Virtual MIDI port

# Get tempo from Ableton (assume 120 BPM)
# In real implementation, query Live for current tempo
tempo = 120.0
ppqn = 24  # Pulses per quarter note (MIDI standard)
interval = 60.0 / (tempo * ppqn)  # Time between clock ticks

# Start Ableton playback
osc_client.send_message("/live/song/start_playing", [])

# Send MIDI start
midi_out.send(mido.Message('start'))

# Send MIDI clock
try:
    while True:
        midi_out.send(mido.Message('clock'))
        time.sleep(interval)
except KeyboardInterrupt:
    # Stop on Ctrl+C
    osc_client.send_message("/live/song/stop_playing", [])
    midi_out.send(mido.Message('stop'))
    midi_out.close()
    print("Sync stopped")
```

### 6. Project State Snapshot and Restore

```python
from pythonosc import udp_client, osc_server, dispatcher
import json
import time

client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Capture current state
state = {
    "tempo": None,
    "tracks": []
}

# Note: This is conceptual - actual implementation requires bidirectional OSC
# You would need to query Live and parse responses

# Simplified example of state capture
num_tracks = 8

for track_id in range(num_tracks):
    track_state = {
        "id": track_id,
        "volume": 0.8,  # Would be queried from Live
        "panning": 0.0,
        "mute": False,
        "solo": False
    }
    state["tracks"].append(track_state)

state["tempo"] = 120.0

# Save state
with open("/tmp/ableton_state.json", "w") as f:
    json.dump(state, f, indent=2)

print("State captured")

# Restore state
with open("/tmp/ableton_state.json", "r") as f:
    restored_state = json.load(f)

# Apply state
client.send_message("/live/song/set/tempo", [restored_state["tempo"]])

for track in restored_state["tracks"]:
    client.send_message(f"/live/track/{track['id']}/set/volume", [track["volume"]])
    client.send_message(f"/live/track/{track['id']}/set/panning", [track["panning"]])
    client.send_message(f"/live/track/{track['id']}/set/mute", [1 if track["mute"] else 0])
    client.send_message(f"/live/track/{track['id']}/set/solo", [1 if track["solo"] else 0])

print("State restored")
```
