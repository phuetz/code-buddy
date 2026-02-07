---
name: blender
version: 1.0.0
description: Blender 3D modeling, animation, and rendering automation via Python bpy scripting and CLI
author: Code Buddy
tags: 3d, modeling, animation, rendering, python, bpy, creative
env:
  BLENDER_PATH: ""
  BLENDER_ADDONS_PATH: ""
---

# Blender 3D Automation

Automate Blender 3D modeling, animation, rendering, and scene management using Python's bpy API and command-line rendering. Supports headless operation, batch processing, and procedural generation.

## Direct Control (CLI / API / Scripting)

### Command-Line Rendering

```bash
# Render single frame
blender scene.blend --background --render-frame 1

# Render animation range
blender scene.blend --background --render-anim --frame-start 1 --frame-end 120

# Render with custom output path
blender scene.blend --background --render-output /tmp/render_#### --render-anim

# Render specific scene
blender file.blend --background --scene "Scene.001" --render-frame 1

# Set render engine
blender scene.blend --background --engine CYCLES --render-frame 1
blender scene.blend --background --engine BLENDER_EEVEE --render-frame 1

# Use GPU for rendering
blender scene.blend --background --python-expr "import bpy; bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'CUDA'; bpy.context.scene.cycles.device = 'GPU'" --render-frame 1
```

### Python bpy Scripting

```python
import bpy
import math

# Create new cube
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "MyCube"

# Set material
mat = bpy.data.materials.new(name="RedMaterial")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (1, 0, 0, 1)
cube.data.materials.append(mat)

# Add keyframe animation
cube.location = (0, 0, 0)
cube.keyframe_insert(data_path="location", frame=1)
cube.location = (5, 0, 0)
cube.keyframe_insert(data_path="location", frame=120)

# Set render settings
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 120

# Render current frame
bpy.ops.render.render(write_still=True)

# Save blend file
bpy.ops.wm.save_as_mainfile(filepath="/path/to/output.blend")
```

### Execute Python Script in Blender

```bash
# Run Python script
blender --background --python script.py

# Run script with arguments
blender --background --python script.py -- arg1 arg2

# Run inline Python
blender --background --python-expr "import bpy; bpy.ops.mesh.primitive_cube_add()"

# Run script and save
blender scene.blend --background --python modify_scene.py --save
```

### Scene Manipulation

```python
import bpy

# List all objects
for obj in bpy.data.objects:
    print(f"{obj.name}: {obj.type}")

# Delete object by name
obj = bpy.data.objects.get("Cube")
if obj:
    bpy.data.objects.remove(obj, do_unlink=True)

# Import FBX/OBJ
bpy.ops.import_scene.fbx(filepath="/path/to/model.fbx")
bpy.ops.import_scene.obj(filepath="/path/to/model.obj")

# Export FBX/OBJ
bpy.ops.export_scene.fbx(filepath="/path/to/output.fbx", use_selection=False)
bpy.ops.export_scene.obj(filepath="/path/to/output.obj")

# Camera setup
camera_data = bpy.data.cameras.new(name="Camera")
camera_object = bpy.data.objects.new("Camera", camera_data)
bpy.context.scene.collection.objects.link(camera_object)
camera_object.location = (7.5, -6.5, 5.4)
camera_object.rotation_euler = (math.radians(63), 0, math.radians(46))
bpy.context.scene.camera = camera_object

# Lighting
light_data = bpy.data.lights.new(name="Light", type='SUN')
light_object = bpy.data.objects.new(name="Sun", object_data=light_data)
bpy.context.collection.objects.link(light_object)
light_object.location = (5, 5, 10)
light_data.energy = 2.0
```

### Geometry Nodes (Procedural)

```python
import bpy

# Add geometry nodes modifier
obj = bpy.context.active_object
modifier = obj.modifiers.new(name="GeometryNodes", type='NODES')

# Create node group
node_group = bpy.data.node_groups.new('MyNodeTree', 'GeometryNodeTree')
modifier.node_group = node_group

# Add input/output nodes
input_node = node_group.nodes.new('NodeGroupInput')
output_node = node_group.nodes.new('NodeGroupOutput')

# Add geometry nodes (e.g., subdivide)
subdivide_node = node_group.nodes.new('GeometryNodeSubdivisionSurface')
node_group.links.new(input_node.outputs[0], subdivide_node.inputs[0])
node_group.links.new(subdivide_node.outputs[0], output_node.inputs[0])
```

## MCP Server Integration

Add to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "blender": {
      "command": "npx",
      "args": ["-y", "@ahujasid/blender-mcp"],
      "env": {
        "BLENDER_PATH": "/usr/bin/blender"
      }
    }
  }
}
```

### Available MCP Tools

- `blender_execute_script` - Execute Python bpy script in Blender
- `blender_render_frame` - Render single frame or animation
- `blender_create_object` - Create primitive objects (cube, sphere, plane, etc.)
- `blender_modify_object` - Transform, scale, rotate objects
- `blender_set_material` - Apply materials and shaders
- `blender_add_keyframe` - Create animation keyframes
- `blender_import_model` - Import FBX, OBJ, STL, GLTF
- `blender_export_model` - Export to various formats
- `blender_list_objects` - Get scene object hierarchy
- `blender_get_scene_info` - Get render settings and scene data

## Common Workflows

### 1. Batch Render Multiple Scenes

```bash
# Render all scenes in a blend file
for scene in $(blender file.blend --background --python-expr "import bpy; print(','.join([s.name for s in bpy.data.scenes]))" | tail -1 | tr ',' '\n'); do
  blender file.blend --background --scene "$scene" --render-output "/renders/${scene}_####" --render-anim
done
```

```python
# Python version with progress
import bpy
import os

output_dir = "/renders"
os.makedirs(output_dir, exist_ok=True)

for scene in bpy.data.scenes:
    print(f"Rendering scene: {scene.name}")
    bpy.context.window.scene = scene
    scene.render.filepath = os.path.join(output_dir, f"{scene.name}_")
    bpy.ops.render.render(animation=True)
```

### 2. Procedural Asset Generation

```python
import bpy
import random

# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Generate random cubes
for i in range(10):
    x = random.uniform(-5, 5)
    y = random.uniform(-5, 5)
    z = random.uniform(0, 3)
    scale = random.uniform(0.5, 2.0)

    bpy.ops.mesh.primitive_cube_add(location=(x, y, z), scale=(scale, scale, scale))
    obj = bpy.context.active_object
    obj.name = f"Cube_{i:03d}"

    # Random color material
    mat = bpy.data.materials.new(name=f"Mat_{i}")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (
        random.random(), random.random(), random.random(), 1
    )
    obj.data.materials.append(mat)

# Save
bpy.ops.wm.save_as_mainfile(filepath="/tmp/procedural_scene.blend")
```

### 3. Camera Animation Sequence

```python
import bpy
import math

scene = bpy.context.scene
camera = scene.camera

# Circular camera path
center = (0, 0, 0)
radius = 10
height = 5
num_frames = 240

for frame in range(1, num_frames + 1):
    angle = (frame / num_frames) * 2 * math.pi
    x = center[0] + radius * math.cos(angle)
    y = center[1] + radius * math.sin(angle)
    z = center[2] + height

    camera.location = (x, y, z)
    camera.keyframe_insert(data_path="location", frame=frame)

    # Look at center
    direction = (center[0] - x, center[1] - y, center[2] - z)
    rot_quat = direction.to_track_quat('-Z', 'Y')
    camera.rotation_euler = rot_quat.to_euler()
    camera.keyframe_insert(data_path="rotation_euler", frame=frame)

scene.frame_end = num_frames
```

### 4. Batch Model Import and Render

```python
import bpy
import os
import glob

model_dir = "/path/to/models"
output_dir = "/path/to/renders"
os.makedirs(output_dir, exist_ok=True)

# Setup scene once
scene = bpy.context.scene
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.engine = 'CYCLES'

# Import and render each model
for model_path in glob.glob(os.path.join(model_dir, "*.fbx")):
    # Clear scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    # Import model
    bpy.ops.import_scene.fbx(filepath=model_path)

    # Center camera on object
    obj = bpy.context.selected_objects[0]
    bpy.ops.view3d.camera_to_view_selected()

    # Render
    model_name = os.path.splitext(os.path.basename(model_path))[0]
    scene.render.filepath = os.path.join(output_dir, f"{model_name}.png")
    bpy.ops.render.render(write_still=True)

    print(f"Rendered: {model_name}")
```

### 5. Material Library Application

```python
import bpy

# Load material library
with bpy.data.libraries.load("/path/to/materials.blend") as (data_from, data_to):
    data_to.materials = data_from.materials

# Apply material to selected objects
material_name = "GoldMetal"
mat = bpy.data.materials.get(material_name)

if mat:
    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            if len(obj.data.materials) > 0:
                obj.data.materials[0] = mat
            else:
                obj.data.materials.append(mat)
            print(f"Applied {material_name} to {obj.name}")
```
