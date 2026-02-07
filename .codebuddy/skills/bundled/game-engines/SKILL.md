---
name: game-engines
version: 1.0.0
description: Unity and Godot game engine development with C# and GDScript via CLI and MCP servers
author: Code Buddy
tags: gamedev, unity, godot, csharp, gdscript, 3d, 2d, gaming
env:
  UNITY_PATH: ""
  GODOT_PATH: ""
---

# Game Engine Development: Unity & Godot

Develop games with Unity (C#) and Godot (GDScript) using command-line tools, editor automation, and MCP server integrations for asset management, scene editing, and build pipelines.

## Direct Control (CLI / API / Scripting)

### Unity CLI

```bash
# Unity paths
export UNITY_PATH="/Applications/Unity/Hub/Editor/2023.2.0f1/Unity.app/Contents/MacOS/Unity"
# Linux: /opt/unity/Editor/Unity
# Windows: "C:\Program Files\Unity\Hub\Editor\2023.2.0f1\Editor\Unity.exe"

# Create new Unity project
"$UNITY_PATH" -createProject /path/to/MyGame -quit

# Open Unity project
"$UNITY_PATH" -projectPath /path/to/MyGame

# Batch mode build (no GUI)
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -executeMethod BuildScript.BuildWindows

# Build for multiple platforms
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -buildTarget StandaloneWindows64 \
  -executeMethod BuildScript.Build

"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -buildTarget Android \
  -executeMethod BuildScript.BuildAndroid

# Import package
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -importPackage /path/to/package.unitypackage

# Export package
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -exportPackage Assets/MyFolder /path/to/output.unitypackage

# Run tests
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -runTests -testResults /path/to/results.xml

# License activation (CI/CD)
"$UNITY_PATH" -quit -batchmode \
  -serial SB-XXXX-XXXX-XXXX-XXXX-XXXX \
  -username "your@email.com" \
  -password "yourpassword"

# Return license
"$UNITY_PATH" -quit -batchmode -returnlicense

# Execute arbitrary C# method
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
  -executeMethod Namespace.ClassName.MethodName
```

### Unity Build Script (Editor/BuildScript.cs)

```csharp
using UnityEditor;
using UnityEngine;
using System.IO;

public class BuildScript
{
    static void BuildWindows()
    {
        string[] scenes = { "Assets/Scenes/MainMenu.unity", "Assets/Scenes/Game.unity" };
        string buildPath = "Builds/Windows/MyGame.exe";

        BuildPipeline.BuildPlayer(scenes, buildPath, BuildTarget.StandaloneWindows64, BuildOptions.None);
        Debug.Log($"Build completed: {buildPath}");
    }

    static void BuildAndroid()
    {
        string[] scenes = FindEnabledEditorScenes();
        string buildPath = "Builds/Android/MyGame.apk";

        PlayerSettings.Android.bundleVersionCode = GetVersionCode();
        PlayerSettings.bundleVersion = "1.0.0";

        BuildPipeline.BuildPlayer(scenes, buildPath, BuildTarget.Android, BuildOptions.None);
        Debug.Log($"Android build completed: {buildPath}");
    }

    static void BuildAllPlatforms()
    {
        BuildWindows();
        BuildAndroid();
        BuildiOS();
    }

    static string[] FindEnabledEditorScenes()
    {
        System.Collections.Generic.List<string> scenes = new System.Collections.Generic.List<string>();
        foreach (EditorBuildSettingsScene scene in EditorBuildSettings.scenes)
        {
            if (scene.enabled)
                scenes.Add(scene.path);
        }
        return scenes.ToArray();
    }

    static int GetVersionCode()
    {
        return System.DateTime.Now.Year * 10000 +
               System.DateTime.Now.Month * 100 +
               System.DateTime.Now.Day;
    }
}
```

### Unity Asset Processing

```csharp
// Assets/Editor/AssetProcessor.cs
using UnityEditor;
using UnityEngine;

public class AssetProcessor : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        TextureImporter importer = (TextureImporter)assetImporter;

        // Auto-configure sprites
        if (assetPath.Contains("Sprites"))
        {
            importer.textureType = TextureImporterType.Sprite;
            importer.spritePixelsPerUnit = 32;
            importer.filterMode = FilterMode.Point;
        }

        // Auto-configure UI textures
        if (assetPath.Contains("UI"))
        {
            importer.textureType = TextureImporterType.Sprite;
            importer.spritePixelsPerUnit = 100;
            importer.npotScale = TextureImporterNPOTScale.None;
        }
    }

    void OnPreprocessModel()
    {
        ModelImporter importer = (ModelImporter)assetImporter;

        // Default model settings
        importer.importAnimation = true;
        importer.importBlendShapes = true;
        importer.importCameras = false;
        importer.importLights = false;
    }

    static void OnPostprocessAllAssets(
        string[] importedAssets,
        string[] deletedAssets,
        string[] movedAssets,
        string[] movedFromAssetPaths)
    {
        foreach (string asset in importedAssets)
        {
            Debug.Log($"Imported: {asset}");
        }
    }
}
```

### Godot CLI

```bash
# Godot paths
export GODOT_PATH="/Applications/Godot.app/Contents/MacOS/Godot"
# Linux: /usr/bin/godot
# Windows: "C:\Program Files\Godot\godot.exe"

# Create new Godot project
mkdir MyGame
cd MyGame
"$GODOT_PATH" --path . --editor --quit

# Open Godot editor
"$GODOT_PATH" --path /path/to/MyGame --editor

# Run game
"$GODOT_PATH" --path /path/to/MyGame

# Run specific scene
"$GODOT_PATH" --path /path/to/MyGame res://scenes/Level1.tscn

# Export project (requires export preset)
"$GODOT_PATH" --path /path/to/MyGame --export "Windows Desktop" builds/windows/MyGame.exe
"$GODOT_PATH" --path /path/to/MyGame --export "Linux/X11" builds/linux/MyGame.x86_64
"$GODOT_PATH" --path /path/to/MyGame --export "Android" builds/android/MyGame.apk
"$GODOT_PATH" --path /path/to/MyGame --export "HTML5" builds/html5/index.html

# Export debug build
"$GODOT_PATH" --path /path/to/MyGame --export-debug "Windows Desktop" builds/debug/MyGame.exe

# Run tests
"$GODOT_PATH" --path /path/to/MyGame -s res://tests/run_tests.gd --quit

# Script mode (headless)
"$GODOT_PATH" --path /path/to/MyGame -s res://scripts/generate_assets.gd --quit

# Check script syntax
"$GODOT_PATH" --path /path/to/MyGame --check-only res://scripts/Player.gd

# Convert 3D scene to GLTF
"$GODOT_PATH" --path /path/to/MyGame --export-pack "Export Preset" output.pck

# Print available export presets
"$GODOT_PATH" --path /path/to/MyGame --export-list
```

### Godot Project Setup (project.godot)

```ini
[application]
config/name="My Awesome Game"
run/main_scene="res://scenes/MainMenu.tscn"
config/icon="res://icon.png"

[display]
window/size/width=1920
window/size/height=1080
window/size/resizable=true
window/stretch/mode="2d"
window/stretch/aspect="expand"

[rendering]
quality/driver/driver_name="GLES3"
vram_compression/import_etc=true
quality/shadows/filter_mode=2

[physics]
common/enable_pause_aware_picking=true
2d/default_gravity=980

[input]
move_left={
"deadzone": 0.5,
"events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":0,"alt":false,"shift":false,"control":false,"meta":false,"command":false,"pressed":false,"scancode":65,"unicode":0,"echo":false,"script":null)
 ]
}
```

### GDScript Examples

```gdscript
# Player.gd - Player controller
extends KinematicBody2D

export var speed = 200
export var jump_force = 400
export var gravity = 800

var velocity = Vector2()

func _physics_process(delta):
    # Horizontal movement
    var input_x = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
    velocity.x = input_x * speed

    # Gravity
    velocity.y += gravity * delta

    # Jump
    if is_on_floor() and Input.is_action_just_pressed("jump"):
        velocity.y = -jump_force

    # Move
    velocity = move_and_slide(velocity, Vector2.UP)

# GameManager.gd - Singleton autoload
extends Node

var score = 0
var level = 1
var player_health = 100

signal score_changed(new_score)
signal level_changed(new_level)

func add_score(amount):
    score += amount
    emit_signal("score_changed", score)

func next_level():
    level += 1
    emit_signal("level_changed", level)

func save_game():
    var save_file = File.new()
    save_file.open("user://savegame.save", File.WRITE)
    var save_data = {
        "score": score,
        "level": level,
        "health": player_health
    }
    save_file.store_line(to_json(save_data))
    save_file.close()

func load_game():
    var save_file = File.new()
    if not save_file.file_exists("user://savegame.save"):
        return

    save_file.open("user://savegame.save", File.READ)
    var save_data = parse_json(save_file.get_line())
    save_file.close()

    score = save_data.score
    level = save_data.level
    player_health = save_data.health

# AssetGenerator.gd - Procedural generation script
extends Node

func generate_tilemap(width, height):
    var tilemap = TileMap.new()
    tilemap.cell_size = Vector2(32, 32)

    for x in range(width):
        for y in range(height):
            if randf() > 0.7:
                tilemap.set_cell(x, y, 0)  # Wall tile
            else:
                tilemap.set_cell(x, y, 1)  # Floor tile

    return tilemap

func create_enemy_spawner(position, enemy_scene):
    var spawner = Node2D.new()
    spawner.position = position
    spawner.set_script(preload("res://scripts/EnemySpawner.gd"))
    spawner.enemy_scene = enemy_scene
    return spawner
```

### CI/CD Build Script

```bash
#!/bin/bash
# build_game.sh - Automated build for Unity and Godot

set -e

GAME_ENGINE=${1:-unity}  # unity or godot
PROJECT_PATH=${2:-.}

if [ "$GAME_ENGINE" = "unity" ]; then
    echo "Building Unity project..."

    # Activate license (CI environment)
    if [ -n "$UNITY_LICENSE" ]; then
        echo "$UNITY_LICENSE" | base64 -d > Unity_v2023.x.ulf
        "$UNITY_PATH" -quit -batchmode -nographics \
            -manualLicenseFile Unity_v2023.x.ulf
    fi

    # Build all platforms
    "$UNITY_PATH" -quit -batchmode -nographics \
        -projectPath "$PROJECT_PATH" \
        -executeMethod BuildScript.BuildAllPlatforms

    # Run tests
    "$UNITY_PATH" -quit -batchmode -nographics \
        -projectPath "$PROJECT_PATH" \
        -runTests -testResults tests/results.xml

    # Return license
    "$UNITY_PATH" -quit -batchmode -returnlicense

elif [ "$GAME_ENGINE" = "godot" ]; then
    echo "Building Godot project..."

    # Export for all platforms
    for preset in "Windows Desktop" "Linux/X11" "HTML5"; do
        echo "Exporting $preset..."
        "$GODOT_PATH" --path "$PROJECT_PATH" \
            --export "$preset" "builds/${preset// /_}/game"
    done

    # Run tests
    "$GODOT_PATH" --path "$PROJECT_PATH" \
        -s res://tests/run_tests.gd --quit
fi

echo "Build complete!"
```

## MCP Server Integration

Add this to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "unity": {
      "command": "npx",
      "args": ["-y", "@codergamesters/mcp-unity"],
      "env": {
        "UNITY_PROJECT_PATH": "/path/to/UnityProject",
        "UNITY_EDITOR_PATH": "/Applications/Unity/Hub/Editor/2023.2.0f1/Unity.app/Contents/MacOS/Unity"
      }
    },
    "godot": {
      "command": "npx",
      "args": ["-y", "@bradypp/godot-mcp"],
      "env": {
        "GODOT_PROJECT_PATH": "/path/to/GodotProject",
        "GODOT_EXECUTABLE_PATH": "/Applications/Godot.app/Contents/MacOS/Godot"
      }
    }
  }
}
```

### Unity MCP Tools

- **list_scenes** - List all scenes in the project with build index
- **get_scene** - Get scene hierarchy and GameObjects
- **create_gameobject** - Create GameObject with components in scene
- **modify_component** - Update component properties (Transform, Rigidbody, etc.)
- **list_assets** - List assets by type (prefabs, materials, scripts)
- **import_asset** - Import external asset into project
- **create_prefab** - Create prefab from GameObject
- **list_scripts** - List all C# scripts with namespaces
- **run_build** - Execute build for target platform
- **run_tests** - Execute Unity Test Framework tests
- **get_player_settings** - Get PlayerSettings (version, bundle ID, etc.)
- **set_player_settings** - Update PlayerSettings
- **install_package** - Install Unity package via Package Manager

### Godot MCP Tools

- **list_scenes** - List all .tscn scene files in project
- **get_scene** - Get scene tree structure with node types
- **create_node** - Add node to scene tree
- **modify_node** - Update node properties and scripts
- **list_resources** - List resources by type (.tres, .res files)
- **get_script** - Read GDScript file contents
- **edit_script** - Modify GDScript file
- **list_autoloads** - List singleton autoload scripts
- **export_project** - Export for platform using preset
- **run_tests** - Execute GDScript unit tests
- **get_project_settings** - Read project.godot settings
- **set_project_settings** - Update project.godot settings
- **import_asset** - Import asset and configure importer

### MCP Usage Examples

```typescript
// Unity - List all scenes
const scenes = await mcp.callTool('unity', 'list_scenes', {});
console.log(scenes.map(s => s.name));

// Unity - Create player GameObject
await mcp.callTool('unity', 'create_gameobject', {
  scene: 'Assets/Scenes/Game.unity',
  name: 'Player',
  components: [
    { type: 'Rigidbody', properties: { mass: 1.5, drag: 0.5 } },
    { type: 'CapsuleCollider', properties: { height: 2, radius: 0.5 } },
    { type: 'PlayerController', properties: { speed: 5, jumpForce: 10 } }
  ],
  position: { x: 0, y: 1, z: 0 }
});

// Unity - Build for Windows
await mcp.callTool('unity', 'run_build', {
  target: 'StandaloneWindows64',
  outputPath: 'Builds/Windows/MyGame.exe',
  development: false
});

// Godot - Create enemy node
await mcp.callTool('godot', 'create_node', {
  scene: 'res://scenes/Level1.tscn',
  parentPath: 'Root/Enemies',
  nodeType: 'KinematicBody2D',
  nodeName: 'Enemy',
  script: 'res://scripts/Enemy.gd',
  properties: {
    position: { x: 100, y: 200 },
    speed: 150
  }
});

// Godot - Edit player script
await mcp.callTool('godot', 'edit_script', {
  scriptPath: 'res://scripts/Player.gd',
  operation: 'insert',
  line: 15,
  content: `
func take_damage(amount):
    health -= amount
    if health <= 0:
        die()
`
});

// Godot - Export for web
await mcp.callTool('godot', 'export_project', {
  preset: 'HTML5',
  outputPath: 'builds/html5/index.html',
  debug: false
});
```

## Common Workflows

### 1. Unity - Automated Asset Import and Processing

```bash
#!/bin/bash
# import_assets.sh - Batch import and configure assets

UNITY_PROJECT="/path/to/UnityProject"
ASSETS_DIR="$UNITY_PROJECT/Assets/ImportQueue"

# Watch for new assets
inotifywait -m -r -e create "$ASSETS_DIR" | while read path action file; do
    echo "New asset detected: $file"

    # Trigger Unity import
    "$UNITY_PATH" -quit -batchmode -projectPath "$UNITY_PROJECT" \
        -executeMethod AssetImporter.ProcessNewAssets
done
```

```csharp
// Editor/AssetImporter.cs
using UnityEditor;
using UnityEngine;
using System.IO;

public class AssetImporter
{
    [MenuItem("Assets/Process Import Queue")]
    static void ProcessNewAssets()
    {
        string importPath = "Assets/ImportQueue";

        if (!Directory.Exists(importPath))
            return;

        string[] files = Directory.GetFiles(importPath, "*.*", SearchOption.AllDirectories);

        foreach (string file in files)
        {
            if (file.EndsWith(".meta")) continue;

            string assetPath = file.Replace("\\", "/");
            ProcessAsset(assetPath);
        }

        AssetDatabase.Refresh();
    }

    static void ProcessAsset(string assetPath)
    {
        if (assetPath.Contains("Textures"))
        {
            TextureImporter importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            if (importer != null)
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.spritePixelsPerUnit = 32;
                importer.filterMode = FilterMode.Point;
                importer.SaveAndReimport();
            }

            // Move to organized folder
            string targetPath = assetPath.Replace("ImportQueue", "Sprites");
            AssetDatabase.MoveAsset(assetPath, targetPath);
        }
        else if (assetPath.EndsWith(".fbx") || assetPath.EndsWith(".obj"))
        {
            ModelImporter importer = AssetImporter.GetAtPath(assetPath) as ModelImporter;
            if (importer != null)
            {
                importer.importAnimation = true;
                importer.animationType = ModelImporterAnimationType.Generic;
                importer.SaveAndReimport();
            }

            string targetPath = assetPath.Replace("ImportQueue", "Models");
            AssetDatabase.MoveAsset(assetPath, targetPath);
        }

        Debug.Log($"Processed and moved: {assetPath}");
    }
}
```

### 2. Godot - Procedural Level Generation

```gdscript
# scripts/LevelGenerator.gd
extends Node

const ROOM_WIDTH = 20
const ROOM_HEIGHT = 15
const TILE_SIZE = 32

var tilemap
var rooms = []

func _ready():
    generate_dungeon(10)  # Generate 10 rooms

func generate_dungeon(num_rooms):
    tilemap = TileMap.new()
    tilemap.cell_size = Vector2(TILE_SIZE, TILE_SIZE)
    add_child(tilemap)

    # Generate rooms
    for i in range(num_rooms):
        var room = generate_room(i)
        rooms.append(room)

    # Connect rooms with corridors
    for i in range(rooms.size() - 1):
        create_corridor(rooms[i], rooms[i + 1])

    # Place enemies and items
    populate_dungeon()

    # Save generated level
    var scene = PackedScene.new()
    scene.pack(self)
    ResourceSaver.save("res://generated/Level_" + str(OS.get_unix_time()) + ".tscn", scene)

func generate_room(index):
    var x = (index % 3) * (ROOM_WIDTH + 5)
    var y = (index / 3) * (ROOM_HEIGHT + 5)

    # Create floor
    for i in range(ROOM_WIDTH):
        for j in range(ROOM_HEIGHT):
            tilemap.set_cell(x + i, y + j, 1)  # Floor tile

    # Create walls
    for i in range(ROOM_WIDTH):
        tilemap.set_cell(x + i, y, 0)  # Top wall
        tilemap.set_cell(x + i, y + ROOM_HEIGHT - 1, 0)  # Bottom wall

    for j in range(ROOM_HEIGHT):
        tilemap.set_cell(x, y + j, 0)  # Left wall
        tilemap.set_cell(x + ROOM_WIDTH - 1, y + j, 0)  # Right wall

    return Rect2(x, y, ROOM_WIDTH, ROOM_HEIGHT)

func create_corridor(room1, room2):
    var start = room1.position + room1.size / 2
    var end = room2.position + room2.size / 2

    # Horizontal corridor
    var x_dir = 1 if end.x > start.x else -1
    for x in range(abs(end.x - start.x)):
        tilemap.set_cell(start.x + x * x_dir, start.y, 1)

    # Vertical corridor
    var y_dir = 1 if end.y > start.y else -1
    for y in range(abs(end.y - start.y)):
        tilemap.set_cell(end.x, start.y + y * y_dir, 1)

func populate_dungeon():
    var enemy_scene = preload("res://entities/Enemy.tscn")
    var item_scene = preload("res://entities/Item.tscn")

    for room in rooms:
        # Spawn 2-4 enemies per room
        for i in range(randi() % 3 + 2):
            var enemy = enemy_scene.instance()
            enemy.position = Vector2(
                (room.position.x + 1 + randi() % int(room.size.x - 2)) * TILE_SIZE,
                (room.position.y + 1 + randi() % int(room.size.y - 2)) * TILE_SIZE
            )
            add_child(enemy)

        # Spawn 1-2 items per room
        for i in range(randi() % 2 + 1):
            var item = item_scene.instance()
            item.position = Vector2(
                (room.position.x + 1 + randi() % int(room.size.x - 2)) * TILE_SIZE,
                (room.position.y + 1 + randi() % int(room.size.y - 2)) * TILE_SIZE
            )
            add_child(item)
```

### 3. Unity - Automated Testing Pipeline

```csharp
// Tests/PlayMode/GameplayTests.cs
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using System.Collections;

public class GameplayTests
{
    GameObject player;

    [SetUp]
    public void SetUp()
    {
        player = GameObject.Instantiate(Resources.Load<GameObject>("Prefabs/Player"));
    }

    [TearDown]
    public void TearDown()
    {
        Object.Destroy(player);
    }

    [UnityTest]
    public IEnumerator PlayerCanJump()
    {
        var controller = player.GetComponent<PlayerController>();
        var initialY = player.transform.position.y;

        controller.Jump();
        yield return new WaitForSeconds(0.5f);

        Assert.Greater(player.transform.position.y, initialY);
    }

    [Test]
    public void PlayerTakesDamage()
    {
        var health = player.GetComponent<Health>();
        var initialHealth = health.currentHealth;

        health.TakeDamage(10);

        Assert.AreEqual(initialHealth - 10, health.currentHealth);
    }

    [UnityTest]
    public IEnumerator EnemySpawnsCorrectly()
    {
        var spawner = new GameObject().AddComponent<EnemySpawner>();
        spawner.enemyPrefab = Resources.Load<GameObject>("Prefabs/Enemy");
        spawner.spawnInterval = 1f;

        spawner.StartSpawning();
        yield return new WaitForSeconds(1.5f);

        var enemies = GameObject.FindGameObjectsWithTag("Enemy");
        Assert.GreaterOrEqual(enemies.Length, 1);

        Object.Destroy(spawner.gameObject);
    }
}
```

```bash
# Run Unity tests in CI
"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
    -runTests -testPlatform PlayMode \
    -testResults tests/playmode_results.xml

"$UNITY_PATH" -quit -batchmode -projectPath /path/to/MyGame \
    -runTests -testPlatform EditMode \
    -testResults tests/editmode_results.xml

# Parse results
if grep -q "failures=\"0\"" tests/*.xml; then
    echo "All tests passed!"
else
    echo "Tests failed!"
    exit 1
fi
```

### 4. Cross-Platform Build and Deploy

```bash
#!/bin/bash
# deploy.sh - Build and deploy to multiple platforms

PROJECT_NAME="MyAwesomeGame"
VERSION="1.0.0"

# Unity builds
build_unity() {
    echo "Building Unity project..."

    # Windows
    "$UNITY_PATH" -quit -batchmode -projectPath . \
        -buildTarget StandaloneWindows64 \
        -executeMethod BuildScript.BuildWindows

    # macOS
    "$UNITY_PATH" -quit -batchmode -projectPath . \
        -buildTarget StandaloneOSX \
        -executeMethod BuildScript.BuildMac

    # Linux
    "$UNITY_PATH" -quit -batchmode -projectPath . \
        -buildTarget StandaloneLinux64 \
        -executeMethod BuildScript.BuildLinux

    # Android
    "$UNITY_PATH" -quit -batchmode -projectPath . \
        -buildTarget Android \
        -executeMethod BuildScript.BuildAndroid

    # WebGL
    "$UNITY_PATH" -quit -batchmode -projectPath . \
        -buildTarget WebGL \
        -executeMethod BuildScript.BuildWebGL
}

# Godot builds
build_godot() {
    echo "Building Godot project..."

    "$GODOT_PATH" --path . --export "Windows Desktop" \
        "builds/windows/${PROJECT_NAME}_${VERSION}.exe"

    "$GODOT_PATH" --path . --export "Linux/X11" \
        "builds/linux/${PROJECT_NAME}_${VERSION}.x86_64"

    "$GODOT_PATH" --path . --export "Mac OSX" \
        "builds/macos/${PROJECT_NAME}_${VERSION}.zip"

    "$GODOT_PATH" --path . --export "HTML5" \
        "builds/html5/index.html"
}

# Package builds
package_builds() {
    cd builds

    # Zip each platform
    for platform in windows linux macos; do
        if [ -d "$platform" ]; then
            zip -r "${PROJECT_NAME}_${VERSION}_${platform}.zip" "$platform"
        fi
    done

    cd ..
}

# Upload to itch.io
upload_itchio() {
    butler push builds/windows/${PROJECT_NAME}_${VERSION}.zip user/game:windows
    butler push builds/linux/${PROJECT_NAME}_${VERSION}.zip user/game:linux
    butler push builds/macos/${PROJECT_NAME}_${VERSION}.zip user/game:osx
    butler push builds/html5 user/game:html5
}

# Main
if [ "$1" = "unity" ]; then
    build_unity
elif [ "$1" = "godot" ]; then
    build_godot
else
    echo "Usage: ./deploy.sh [unity|godot]"
    exit 1
fi

package_builds
upload_itchio

echo "Deployment complete!"
```

### 5. Live Hot-Reload Development Setup

```gdscript
# addons/hot_reload/hot_reload.gd
tool
extends EditorPlugin

var file_watcher
var last_modified = {}

func _enter_tree():
    file_watcher = Timer.new()
    file_watcher.wait_time = 0.5
    file_watcher.connect("timeout", self, "_check_files")
    add_child(file_watcher)
    file_watcher.start()

    print("Hot Reload: Enabled")

func _exit_tree():
    if file_watcher:
        file_watcher.queue_free()

func _check_files():
    var scripts_to_reload = []

    # Check all GDScript files
    var dir = Directory.new()
    _scan_directory("res://", dir, scripts_to_reload)

    # Reload changed scripts
    for script_path in scripts_to_reload:
        print("Hot Reload: Reloading " + script_path)
        var script = load(script_path)

        # Find all instances using this script
        var root = get_tree().edited_scene_root
        if root:
            _reload_script_instances(root, script)

func _scan_directory(path, dir, scripts_to_reload):
    if dir.open(path) == OK:
        dir.list_dir_begin(true, true)
        var file_name = dir.get_next()

        while file_name != "":
            var full_path = path + "/" + file_name

            if dir.current_is_dir():
                _scan_directory(full_path, dir, scripts_to_reload)
            elif file_name.ends_with(".gd"):
                var file = File.new()
                var modified = file.get_modified_time(full_path)

                if not last_modified.has(full_path) or last_modified[full_path] < modified:
                    last_modified[full_path] = modified
                    scripts_to_reload.append(full_path)

            file_name = dir.get_next()

        dir.list_dir_end()

func _reload_script_instances(node, script):
    if node.get_script() == script:
        node.set_script(null)
        node.set_script(script)

    for child in node.get_children():
        _reload_script_instances(child, script)
```
