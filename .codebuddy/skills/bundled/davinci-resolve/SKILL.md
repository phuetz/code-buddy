---
name: davinci-resolve
version: 1.0.0
description: DaVinci Resolve video editing and color grading automation via Python DaVinciResolveScript API
author: Code Buddy
tags: video, editing, color-grading, resolve, python, post-production
env:
  RESOLVE_SCRIPT_API: ""
  RESOLVE_SCRIPT_LIB: ""
---

# DaVinci Resolve Automation

Automate DaVinci Resolve video editing, color grading, and rendering workflows using the Python DaVinciResolveScript API. Control timeline editing, media management, effects, and render queue.

## Direct Control (CLI / API / Scripting)

### Python DaVinciResolveScript API Setup

```python
import sys

# Add Resolve Python API to path
# macOS
sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/")

# Windows
sys.path.append("C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\")

# Linux
sys.path.append("/opt/resolve/Developer/Scripting/Modules/")

import DaVinciResolveScript as dvr_script

# Get Resolve instance
resolve = dvr_script.scriptapp("Resolve")
project_manager = resolve.GetProjectManager()
project = project_manager.GetCurrentProject()
media_pool = project.GetMediaPool()
```

### Project and Media Management

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
pm = resolve.GetProjectManager()

# List all projects
projects = pm.GetProjectListInCurrentFolder()
print(f"Projects: {projects}")

# Create new project
new_project = pm.CreateProject("MyProject")

# Load project
project = pm.LoadProject("MyProject")

# Get project settings
settings = project.GetSetting()
print(f"Frame rate: {project.GetSetting('timelineFrameRate')}")
print(f"Resolution: {project.GetSetting('timelineResolutionWidth')}x{project.GetSetting('timelineResolutionHeight')}")

# Set project settings
project.SetSetting("timelineFrameRate", "24")
project.SetSetting("timelineResolutionWidth", "1920")
project.SetSetting("timelineResolutionHeight", "1080")

# Media pool operations
media_pool = project.GetMediaPool()
root_folder = media_pool.GetRootFolder()

# Create bin
new_bin = media_pool.AddSubFolder(root_folder, "Footage")

# Import media
media_files = [
    "/path/to/clip1.mp4",
    "/path/to/clip2.mov",
    "/path/to/audio.wav"
]
clips = media_pool.ImportMedia(media_files)
print(f"Imported {len(clips)} clips")

# List clips in bin
clips_in_bin = new_bin.GetClipList()
for clip in clips_in_bin:
    print(f"Clip: {clip.GetName()}, Duration: {clip.GetClipProperty('Duration')}")
```

### Timeline Editing

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()
media_pool = project.GetMediaPool()

# Create timeline
timeline_name = "Sequence_01"
timeline = media_pool.CreateEmptyTimeline(timeline_name)

# Set current timeline
project.SetCurrentTimeline(timeline)

# Get clips from media pool
root_folder = media_pool.GetRootFolder()
clips = root_folder.GetClipList()

# Add clips to timeline
for i, clip in enumerate(clips):
    media_pool.AppendToTimeline([{
        "mediaPoolItem": clip,
        "startFrame": 0,
        "endFrame": int(clip.GetClipProperty("Frames")) - 1,
        "trackIndex": 1,  # Video track 1
        "recordFrame": i * 100  # Position in timeline
    }])

# Insert clip at playhead
current_timecode = timeline.GetCurrentTimecode()
media_pool.AppendToTimeline(clips[0])

# Timeline properties
print(f"Timeline name: {timeline.GetName()}")
print(f"Timeline FPS: {timeline.GetSetting('timelineFrameRate')}")
print(f"Duration: {timeline.GetEndFrame()} frames")

# Get timeline items (clips on timeline)
items = timeline.GetItemListInTrack("video", 1)
for item in items:
    print(f"Item: {item.GetName()}")
    print(f"  Start: {item.GetStart()}, End: {item.GetEnd()}")
    print(f"  Duration: {item.GetDuration()}")

    # Modify item
    item.SetClipColor("Blue")
    item.SetProperty("Pan", 0.5)
    item.SetProperty("Tilt", 0.5)
    item.SetProperty("ZoomX", 1.2)
```

### Color Grading and Effects

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()
timeline = project.GetCurrentTimeline()

# Get timeline item for color grading
items = timeline.GetItemListInTrack("video", 1)
clip = items[0]

# Get current page
current_page = resolve.GetCurrentPage()

# Switch to Color page
resolve.OpenPage("color")

# Apply LUT
clip.SetLUT(1, "/path/to/lut_file.cube")

# Add color correction
clip.SetProperty("Lift", [0.0, 0.0, 0.0, 0.0])
clip.SetProperty("Gamma", [1.0, 1.0, 1.0, 1.0])
clip.SetProperty("Gain", [1.0, 1.0, 1.0, 1.0])

# Adjust saturation and contrast
clip.SetProperty("Saturation", 1.2)
clip.SetProperty("Contrast", 1.1)

# Add effect (example: Gaussian Blur)
# Note: Effect names vary by Resolve version
resolve.GetCurrentPage()  # Ensure on Fusion or Edit page
clip.AddEffect("Blur")

# Get all effects on clip
effects = clip.GetFusionCompCount()
print(f"Number of Fusion comps: {effects}")
```

### Rendering and Export

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()

# Get render settings
render_settings = {
    "SelectAllFrames": True,
    "TargetDir": "/path/to/output",
    "CustomName": "MyRender",
    "UniqueFilenameStyle": 0,  # 0: Prefix, 1: Suffix
}

# Set render format
project.SetRenderSettings({
    "MarkIn": 0,
    "MarkOut": 1000,
    "TargetDir": "/renders/",
    "CustomName": "output",
    "Format": "mp4",
    "VideoCodec": "H264",
    "VideoQuality": "High",
    "AudioCodec": "AAC",
    "FrameRate": "24",
    "Resolution": "1920x1080"
})

# Add to render queue
project.AddRenderJob()

# Get render jobs
render_jobs = project.GetRenderJobList()
for job in render_jobs:
    print(f"Job: {job['JobName']}, Status: {job['Status']}")

# Start rendering
project.StartRendering()

# Check render status
while project.IsRenderingInProgress():
    status = project.GetRenderJobStatus(render_jobs[0]['JobId'])
    print(f"Rendering: {status['CompletionPercentage']}%")
    time.sleep(5)

# Delete render job
project.DeleteRenderJob(render_jobs[0]['JobId'])
```

### Batch Processing

```python
import DaVinciResolveScript as dvr_script
import os
import glob

resolve = dvr_script.scriptapp("Resolve")
pm = resolve.GetProjectManager()

# Create project for batch
project = pm.CreateProject("BatchProcess_Renders")
media_pool = project.GetMediaPool()

# Import all videos from folder
video_dir = "/path/to/videos"
video_files = glob.glob(os.path.join(video_dir, "*.mp4"))

for video_file in video_files:
    # Create timeline for each video
    basename = os.path.splitext(os.path.basename(video_file))[0]

    # Import clip
    clips = media_pool.ImportMedia([video_file])

    if clips:
        # Create timeline
        timeline = media_pool.CreateTimelineFromClips(basename, clips)

        if timeline:
            # Apply color correction preset
            project.SetCurrentTimeline(timeline)
            items = timeline.GetItemListInTrack("video", 1)

            for item in items:
                # Apply LUT
                item.SetLUT(1, "/path/to/standard.cube")

            # Add to render queue
            project.SetRenderSettings({
                "TargetDir": "/renders/processed",
                "CustomName": basename,
                "Format": "mp4"
            })
            project.AddRenderJob()

            print(f"Processed: {basename}")

# Render all jobs
project.StartRendering()
```

## MCP Server Integration

Add to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "davinci-resolve": {
      "command": "node",
      "args": ["/path/to/davinci-resolve-mcp/dist/index.js"],
      "env": {
        "RESOLVE_SCRIPT_API": "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/",
        "RESOLVE_SCRIPT_LIB": "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
      }
    }
  }
}
```

### Available MCP Tools

- `resolve_get_project` - Get current project info
- `resolve_create_timeline` - Create new timeline from clips
- `resolve_import_media` - Import media files to media pool
- `resolve_add_clips_to_timeline` - Add clips to timeline
- `resolve_set_timeline_property` - Modify timeline settings
- `resolve_apply_lut` - Apply LUT to clip
- `resolve_set_color_correction` - Apply color grading
- `resolve_add_marker` - Add marker to timeline
- `resolve_render_timeline` - Start render job
- `resolve_export_timeline` - Export timeline to various formats
- `resolve_execute_script` - Run custom Python script

## Common Workflows

### 1. Auto-Edit from Folder Structure

```python
import DaVinciResolveScript as dvr_script
import os

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()
media_pool = project.GetMediaPool()

# Folder structure: /project/scenes/scene01, scene02, etc.
project_dir = "/project"
scenes_dir = os.path.join(project_dir, "scenes")

# Create timeline
timeline = media_pool.CreateEmptyTimeline("AutoEdit")
project.SetCurrentTimeline(timeline)

# Process each scene folder
for scene_name in sorted(os.listdir(scenes_dir)):
    scene_path = os.path.join(scenes_dir, scene_name)

    if os.path.isdir(scene_path):
        # Create bin for scene
        scene_bin = media_pool.AddSubFolder(media_pool.GetRootFolder(), scene_name)

        # Import clips
        clips = []
        for file in sorted(os.listdir(scene_path)):
            if file.endswith(('.mp4', '.mov', '.mxf')):
                clips.append(os.path.join(scene_path, file))

        imported = media_pool.ImportMedia(clips)

        # Add to timeline in order
        for clip in imported:
            media_pool.AppendToTimeline([clip])

        print(f"Added scene: {scene_name}")

print("Auto-edit complete")
```

### 2. Batch Color Grading from CSV

```python
import DaVinciResolveScript as dvr_script
import csv

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()
timeline = project.GetCurrentTimeline()

# CSV format: clip_name, lift_r, lift_g, lift_b, gamma_r, gamma_g, gamma_b, gain_r, gain_g, gain_b
csv_file = "/path/to/color_grades.csv"

# Build color grade lookup
grades = {}
with open(csv_file, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        grades[row['clip_name']] = {
            'lift': [float(row['lift_r']), float(row['lift_g']), float(row['lift_b']), 0],
            'gamma': [float(row['gamma_r']), float(row['gamma_g']), float(row['gamma_b']), 0],
            'gain': [float(row['gain_r']), float(row['gain_g']), float(row['gain_b']), 0]
        }

# Apply grades to timeline clips
for track_num in range(1, timeline.GetTrackCount("video") + 1):
    items = timeline.GetItemListInTrack("video", track_num)

    for item in items:
        clip_name = item.GetName()

        if clip_name in grades:
            grade = grades[clip_name]
            item.SetProperty("Lift", grade['lift'])
            item.SetProperty("Gamma", grade['gamma'])
            item.SetProperty("Gain", grade['gain'])
            print(f"Applied grade to: {clip_name}")

print("Batch color grading complete")
```

### 3. Automated Dailies Creation

```python
import DaVinciResolveScript as dvr_script
import datetime

resolve = dvr_script.scriptapp("Resolve")
pm = resolve.GetProjectManager()

# Create dailies project
today = datetime.date.today().strftime("%Y-%m-%d")
project_name = f"Dailies_{today}"
project = pm.CreateProject(project_name)

media_pool = project.GetMediaPool()

# Import footage
footage_dir = "/Volumes/Production/Footage/today"
clips = media_pool.ImportMedia([footage_dir])

# Create timeline for each clip
for clip in clips:
    timeline = media_pool.CreateTimelineFromClips(clip.GetName(), [clip])

    if timeline:
        project.SetCurrentTimeline(timeline)

        # Add text overlay with metadata
        items = timeline.GetItemListInTrack("video", 1)
        for item in items:
            # Add marker with metadata
            item.AddMarker(
                frameId=item.GetStart(),
                color="Blue",
                name="Dailies Info",
                note=f"Shot: {clip.GetName()}\nDate: {today}\nReel: {clip.GetClipProperty('Reel Name')}"
            )

        # Render settings for dailies
        project.SetRenderSettings({
            "TargetDir": f"/Dailies/{today}",
            "CustomName": clip.GetName(),
            "Format": "mov",
            "VideoCodec": "DNxHR",
            "VideoQuality": "HQ",
            "AudioCodec": "Linear PCM"
        })
        project.AddRenderJob()

# Start rendering all dailies
project.StartRendering()
print(f"Dailies created for {today}")
```

### 4. Multi-Cam Sync and Edit

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()
media_pool = project.GetMediaPool()

# Import multi-cam clips
camera_clips = [
    "/footage/cam_a/clip001.mov",
    "/footage/cam_b/clip001.mov",
    "/footage/cam_c/clip001.mov",
    "/footage/audio/clip001.wav"
]

clips = media_pool.ImportMedia(camera_clips)

# Create multicam clip (sync by audio)
multicam_name = "MultiCam_Scene01"

# Note: API for multicam creation varies by Resolve version
# This is a conceptual example
timeline = media_pool.CreateTimelineFromClips(multicam_name, clips)

if timeline:
    # Set to multicam mode
    timeline.SetSetting("useMulticamEdit", "1")

    print(f"Multi-cam timeline created: {multicam_name}")
```

### 5. Export EDL/XML for Collaboration

```python
import DaVinciResolveScript as dvr_script

resolve = dvr_script.scriptapp("Resolve")
project = resolve.GetProjectManager().GetCurrentProject()

# Get all timelines
timeline_count = project.GetTimelineCount()

for i in range(1, timeline_count + 1):
    timeline = project.GetTimelineByIndex(i)
    timeline_name = timeline.GetName()

    # Export EDL
    edl_path = f"/exports/{timeline_name}.edl"
    success = timeline.Export(edl_path, resolve.EXPORT_EDL)
    print(f"Exported EDL: {edl_path}" if success else f"Failed to export: {timeline_name}")

    # Export Final Cut Pro XML
    xml_path = f"/exports/{timeline_name}.xml"
    success = timeline.Export(xml_path, resolve.EXPORT_FCP_XML)
    print(f"Exported XML: {xml_path}" if success else f"Failed to export XML: {timeline_name}")

    # Export AAF
    aaf_path = f"/exports/{timeline_name}.aaf"
    success = timeline.Export(aaf_path, resolve.EXPORT_AAF)
    print(f"Exported AAF: {aaf_path}" if success else f"Failed to export AAF: {timeline_name}")
```
