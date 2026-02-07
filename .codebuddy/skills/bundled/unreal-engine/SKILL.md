---
name: unreal-engine
version: 1.0.0
description: Unreal Engine automation via Remote Control API, Python scripting, and C++ automation
author: Code Buddy
tags: unreal, game-dev, 3d, automation, python, cpp, remote-control
env:
  UNREAL_ENGINE_PATH: ""
  UNREAL_PROJECT_PATH: ""
  UNREAL_REMOTE_CONTROL_URL: "http://localhost:30010"
---

# Unreal Engine Automation

Automate Unreal Engine workflows using the Remote Control API (HTTP/WebSocket), Python scripting in Editor, and C++ automation tests. Supports asset management, level editing, rendering, and build automation.

## Direct Control (CLI / API / Scripting)

### Remote Control HTTP API

The Remote Control API allows external applications to control Unreal Engine over HTTP.

```bash
# Enable Remote Control in Project Settings > Plugins > Remote Control API
# Default endpoint: http://localhost:30010/remote/control

# List all exposed properties
curl http://localhost:30010/remote/control/properties

# Get property value
curl -X PUT http://localhost:30010/remote/control/property \
  -H "Content-Type: application/json" \
  -d '{
    "objectPath": "/Game/Maps/MainLevel.MainLevel:PersistentLevel.StaticMeshActor_0",
    "propertyName": "ActorLocation",
    "access": "READ_ACCESS"
  }'

# Set property value
curl -X PUT http://localhost:30010/remote/control/property \
  -H "Content-Type: application/json" \
  -d '{
    "objectPath": "/Game/Maps/MainLevel.MainLevel:PersistentLevel.StaticMeshActor_0",
    "propertyName": "ActorLocation",
    "propertyValue": {"X": 100, "Y": 200, "Z": 50},
    "access": "WRITE_ACCESS"
  }'

# Call function
curl -X PUT http://localhost:30010/remote/control/function \
  -H "Content-Type: application/json" \
  -d '{
    "objectPath": "/Game/Blueprints/MyBlueprint.MyBlueprint_C",
    "functionName": "MyCustomFunction",
    "parameters": {"ParamName": "Value"}
  }'

# Search for objects
curl -X PUT http://localhost:30010/remote/control/search/objects \
  -H "Content-Type: application/json" \
  -d '{
    "query": "StaticMeshActor",
    "limit": 10
  }'
```

### Python Editor Scripting

```python
import unreal

# Asset management
asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()

# Find assets by class
assets = asset_registry.get_assets_by_class("StaticMesh", True)
for asset in assets:
    print(f"Asset: {asset.asset_name}, Path: {asset.package_name}")

# Load asset
asset_path = "/Game/Meshes/MyMesh"
static_mesh = unreal.load_asset(asset_path)

# Create new asset
factory = unreal.MaterialFactoryNew()
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
material = asset_tools.create_asset(
    asset_name="MyMaterial",
    package_path="/Game/Materials",
    asset_class=unreal.Material,
    factory=factory
)

# Level editing
editor_level_lib = unreal.EditorLevelLibrary()

# Spawn actor
actor_class = unreal.load_class(None, "/Game/Blueprints/MyActor.MyActor_C")
location = unreal.Vector(0, 0, 0)
rotation = unreal.Rotator(0, 0, 0)
actor = editor_level_lib.spawn_actor_from_class(actor_class, location, rotation)

# Get all actors in level
actors = editor_level_lib.get_all_level_actors()
for actor in actors:
    print(f"Actor: {actor.get_name()}, Class: {actor.get_class().get_name()}")

# Delete actor
editor_level_lib.destroy_actor(actor)

# Save level
unreal.EditorLoadingAndSavingUtils.save_current_level()

# Load level
unreal.EditorLoadingAndSavingUtils.load_map("/Game/Maps/TestLevel")
```

### Rendering and Movie Render Queue

```python
import unreal

# Setup Movie Render Queue
subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
queue = subsystem.get_queue()

# Create job
job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
job.sequence = unreal.load_asset("/Game/Cinematics/MainSequence")
job.map = unreal.SoftObjectPath("/Game/Maps/MainLevel")

# Configure render settings
config = job.get_configuration()

# Output settings
output_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
output_setting.output_directory = unreal.DirectoryPath("/Renders/")
output_setting.file_name_format = "{sequence_name}_{frame_number}"

# Image sequence output
img_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)

# Resolution
resolution_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
resolution_setting.output_resolution = unreal.IntPoint(1920, 1080)

# Anti-aliasing
aa_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
aa_setting.spatial_sample_count = 4
aa_setting.temporal_sample_count = 4

# Execute render
executor = unreal.MoviePipelinePIEExecutor()
subsystem.render_queue_with_executor(executor)
```

### Command-Line Build and Cook

```bash
# Package project
/path/to/UE5/Engine/Build/BatchFiles/RunUAT.sh BuildCookRun \
  -project="/path/to/MyProject.uproject" \
  -platform=Win64 \
  -configuration=Development \
  -build -cook -stage -pak \
  -archive -archivedirectory="/path/to/output"

# Cook content only
/path/to/UE5/Engine/Build/BatchFiles/RunUAT.sh BuildCookRun \
  -project="/path/to/MyProject.uproject" \
  -platform=Win64 \
  -cook -skipcook=false \
  -iterate

# Run automation tests
/path/to/UE5/Engine/Binaries/Linux/UnrealEditor \
  /path/to/MyProject.uproject \
  -ExecCmds="Automation RunTests MyTestSuite" \
  -unattended -nopause -NullRHI -log

# Generate project files
/path/to/UE5/Engine/Build/BatchFiles/Linux/GenerateProjectFiles.sh \
  -project="/path/to/MyProject.uproject"
```

### Blueprint Automation

```python
import unreal

# Load Blueprint
bp_path = "/Game/Blueprints/MyBlueprint"
bp_asset = unreal.load_asset(bp_path)
bp_class = bp_asset.generated_class()

# Get Blueprint graph
bp_graph = bp_asset.get_editor_property('ubergraph_pages')[0]

# Create new function
function_graph = unreal.BlueprintFactory().create_new_blueprint_function(
    blueprint=bp_asset,
    function_name="MyNewFunction"
)

# Add nodes programmatically (requires Blueprint API)
k2_node = unreal.EdGraphNode()
# ... node configuration

# Compile Blueprint
unreal.KismetSystemLibrary.compile_blueprint(bp_asset)

# Save Blueprint
unreal.EditorAssetLibrary.save_loaded_asset(bp_asset)
```

## MCP Server Integration

Add to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "unreal-engine": {
      "command": "node",
      "args": ["/path/to/unreal-mcp/dist/index.js"],
      "env": {
        "UNREAL_ENGINE_PATH": "/path/to/UE_5.4",
        "UNREAL_PROJECT_PATH": "/path/to/MyProject.uproject",
        "UNREAL_REMOTE_CONTROL_URL": "http://localhost:30010"
      }
    }
  }
}
```

### Available MCP Tools

- `unreal_get_actors` - List all actors in current level
- `unreal_spawn_actor` - Spawn actor from class or blueprint
- `unreal_set_property` - Set property on object via Remote Control
- `unreal_get_property` - Get property value from object
- `unreal_call_function` - Execute blueprint or C++ function
- `unreal_load_level` - Load specific level/map
- `unreal_save_level` - Save current level
- `unreal_import_asset` - Import FBX, OBJ, textures
- `unreal_execute_python` - Run Python script in Editor
- `unreal_start_render` - Start Movie Render Queue job
- `unreal_build_project` - Package/cook project

## Common Workflows

### 1. Automated Level Population

```python
import unreal
import random

# Setup
editor_lib = unreal.EditorLevelLibrary()
asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()

# Find static mesh assets
mesh_filter = unreal.ARFilter(
    class_names=["StaticMesh"],
    package_paths=["/Game/Environment/Props"]
)
mesh_assets = asset_registry.get_assets(mesh_filter)

# Spawn random props in grid
grid_size = 10
spacing = 500  # cm

for x in range(grid_size):
    for y in range(grid_size):
        # Random mesh
        mesh_asset = random.choice(mesh_assets)
        mesh = unreal.load_asset(mesh_asset.package_name)

        # Spawn static mesh actor
        location = unreal.Vector(x * spacing, y * spacing, 0)
        rotation = unreal.Rotator(0, random.uniform(0, 360), 0)

        actor = editor_lib.spawn_actor_from_object(mesh, location, rotation)
        actor.set_actor_scale3d(unreal.Vector(
            random.uniform(0.8, 1.2),
            random.uniform(0.8, 1.2),
            random.uniform(0.8, 1.2)
        ))

        print(f"Spawned {mesh_asset.asset_name} at {location}")

# Save level
unreal.EditorLoadingAndSavingUtils.save_current_level()
```

### 2. Batch Material Assignment

```python
import unreal

# Load material
material = unreal.load_asset("/Game/Materials/M_Master")

# Get all static mesh actors
editor_lib = unreal.EditorLevelLibrary()
actors = editor_lib.get_all_level_actors()

for actor in actors:
    if isinstance(actor, unreal.StaticMeshActor):
        mesh_component = actor.static_mesh_component

        # Get number of material slots
        num_materials = mesh_component.get_num_materials()

        # Assign material to all slots
        for i in range(num_materials):
            mesh_component.set_material(i, material)

        print(f"Updated materials on {actor.get_name()}")

print("Material assignment complete")
```

### 3. Automated Rendering Pipeline

```python
import unreal
import os

# Configuration
sequences = [
    "/Game/Cinematics/Intro",
    "/Game/Cinematics/Gameplay",
    "/Game/Cinematics/Outro"
]
output_base = "/Renders"

subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
queue = subsystem.get_queue()

for seq_path in sequences:
    # Create job
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    job.sequence = unreal.load_asset(seq_path)
    job.map = unreal.SoftObjectPath("/Game/Maps/MainLevel")

    # Configure output
    config = job.get_configuration()
    output_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)

    seq_name = os.path.basename(seq_path)
    output_setting.output_directory = unreal.DirectoryPath(f"{output_base}/{seq_name}")
    output_setting.file_name_format = "{sequence_name}_{frame_number}"

    # PNG output
    config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)

    # 4K resolution
    output_setting.output_resolution = unreal.IntPoint(3840, 2160)

    # High quality AA
    aa_setting = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    aa_setting.spatial_sample_count = 8
    aa_setting.temporal_sample_count = 8

    print(f"Queued render: {seq_name}")

# Start rendering
executor = unreal.MoviePipelinePIEExecutor()
subsystem.render_queue_with_executor(executor)
print("Render queue started")
```

### 4. Remote Control Batch Updates

```bash
#!/bin/bash
# Update multiple actors via Remote Control API

UNREAL_URL="http://localhost:30010"

# Get all light actors
curl -s -X PUT "$UNREAL_URL/remote/control/search/objects" \
  -H "Content-Type: application/json" \
  -d '{"query": "Light", "limit": 100}' | jq -r '.objects[].path' | while read -r light_path; do

  # Set intensity to 5000
  curl -X PUT "$UNREAL_URL/remote/control/property" \
    -H "Content-Type: application/json" \
    -d "{
      \"objectPath\": \"$light_path\",
      \"propertyName\": \"Intensity\",
      \"propertyValue\": 5000.0,
      \"access\": \"WRITE_ACCESS\"
    }"

  echo "Updated light: $light_path"
done
```

### 5. Asset Validation and Reporting

```python
import unreal
import json

# Validation report
report = {
    "missing_materials": [],
    "missing_textures": [],
    "oversized_textures": [],
    "high_poly_meshes": []
}

asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()

# Check static meshes
mesh_filter = unreal.ARFilter(class_names=["StaticMesh"])
meshes = asset_registry.get_assets(mesh_filter)

for mesh_data in meshes:
    mesh = unreal.load_asset(mesh_data.package_name)

    # Check materials
    materials = mesh.get_editor_property('static_materials')
    for mat_slot in materials:
        if mat_slot.material_interface is None:
            report["missing_materials"].append(mesh_data.package_name)

    # Check poly count
    poly_count = mesh.get_num_triangles(0)
    if poly_count > 100000:
        report["high_poly_meshes"].append({
            "asset": mesh_data.package_name,
            "triangles": poly_count
        })

# Check textures
texture_filter = unreal.ARFilter(class_names=["Texture2D"])
textures = asset_registry.get_assets(texture_filter)

for tex_data in textures:
    texture = unreal.load_asset(tex_data.package_name)

    # Check size
    size_x = texture.get_editor_property('size_x')
    size_y = texture.get_editor_property('size_y')

    if size_x > 4096 or size_y > 4096:
        report["oversized_textures"].append({
            "asset": tex_data.package_name,
            "resolution": f"{size_x}x{size_y}"
        })

# Save report
with open("/tmp/asset_report.json", "w") as f:
    json.dump(report, f, indent=2)

print("Asset validation complete")
```
