import blenderproc as bproc  # noqa: E402 — MUST be line 1 (BlenderProc requires its import at the very top, before any docstring/comment)

"""
BlenderProc scene script — the "simulate" leg of Code Buddy's simulate->perceive
loop. Driven headless by `src/tools/vision/blender-render.ts` via:

    blenderproc run scripts/blenderproc/scene.py -- \
        --assets <dir> --out <dir> --count <n> [--seed N --width W --height H --devices CUDA,HIP]

For each scene it: picks a random subset of assets, drops them on a floor, lets
the physics settle (so occlusions/poses are REAL, not hoped-for), randomizes
camera + lighting (domain randomization), renders RGB, and writes a standard
COCO `coco_annotations.json` whose bounding boxes are PROJECTED FROM THE KNOWN
3D GEOMETRY — exact ground truth, a mathematical fact. That COCO file feeds
`coco-to-labels.ts` -> `buddy vision-train --coco`, which scores the robot's REAL
YOLO perception and surfaces where it's weak.

Asset convention (keeps category labels honest & matched to YOLO/COCO classes):
    <assets>/<coco_class>/*.glb|*.obj|*.blend      e.g.  assets/chair/ikea.glb
The immediate parent directory name IS the category (must be a COCO class name
the perceiver knows: person, chair, couch, tv, laptop, bottle, cup, ...).

GPU: tries CUDA then HIP (AMD) then falls back to CPU automatically, so this runs
on DARKSTAR's 3090s (fast) AND on the AMD box (slow but works). Setup on the GPU
host:  pip install blenderproc   (BlenderProc downloads its own Blender).
"""

import argparse
import glob
import os
import random
import sys

import numpy as np

# A small COCO class subset relevant to an indoor companion robot. category_id
# must be stable across a run; names must match what the perceiver (YOLO/COCO)
# emits so scoring lines up label-for-label.
COCO_CLASSES = [
    "person", "chair", "couch", "potted plant", "bed", "dining table", "tv",
    "laptop", "mouse", "keyboard", "cell phone", "book", "bottle", "cup", "backpack",
]
CLASS_ID = {name: i + 1 for i, name in enumerate(COCO_CLASSES)}  # 1-based, 0 = background


def parse_args(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--assets", required=True, help="assets root: <assets>/<coco_class>/*.glb")
    p.add_argument("--out", required=True, help="output dir (coco_annotations.json + images/)")
    p.add_argument("--count", type=int, default=8, help="number of scenes to render")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--devices", default="CUDA,HIP", help="GPU device types to try before CPU")
    return p.parse_args(argv)


def discover_assets(assets_root):
    """Return [(filepath, coco_class), ...] for every model under <assets>/<class>/."""
    found = []
    for cls in os.listdir(assets_root):
        cls_dir = os.path.join(assets_root, cls)
        if not os.path.isdir(cls_dir) or cls not in CLASS_ID:
            continue
        for ext in ("*.glb", "*.gltf", "*.obj", "*.blend"):
            for f in glob.glob(os.path.join(cls_dir, "**", ext), recursive=True):
                found.append((f, cls))
    return found


def load_asset(path):
    """Load one model file, returning the BlenderProc MeshObjects it produced."""
    lower = path.lower()
    if lower.endswith((".glb", ".gltf")):
        return _load_gltf(path)
    if lower.endswith(".blend"):
        # obj_types=["mesh"] → return the actual meshes (not container empties),
        # so category_id gets set on what's rendered.
        return bproc.loader.load_blend(path, obj_types=["mesh"])
    return bproc.loader.load_obj(path)  # .obj / .ply


def _load_gltf(path):
    import bpy
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
    return bproc.python.types.MeshObjectUtility.convert_to_meshes(new)


def configure_devices(devices):
    """Try the requested GPU device types; BlenderProc silently uses CPU if none."""
    try:
        bproc.renderer.set_render_devices(desired_gpu_device_type=[d.strip() for d in devices.split(",") if d.strip()])
    except Exception as e:  # noqa: BLE001 — never abort the render over device selection
        print(f"[scene.py] GPU device selection failed ({e}); falling back to CPU", file=sys.stderr)


def build_floor():
    floor = bproc.object.create_primitive("PLANE", scale=[4, 4, 1])
    floor.enable_rigidbody(active=False, collision_shape="BOX")
    floor.set_cp("category_id", 0)  # background
    return floor


def main():
    # BlenderProc puts the user args (after `--`) directly in sys.argv[1:]; a
    # direct `blender --python` invocation keeps the `--` separator. Handle both.
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse_args(argv)
    random.seed(args.seed)

    bproc.init()
    configure_devices(args.devices)
    bproc.camera.set_resolution(args.width, args.height)
    bproc.renderer.enable_segmentation_output(
        map_by=["category_id", "instance", "name"],
        default_values={"category_id": 0, "name": "none"},
    )

    catalog = discover_assets(args.assets)
    if not catalog:
        print(f"[scene.py] no assets under {args.assets}/<coco_class>/ — nothing to render", file=sys.stderr)
        sys.exit(2)

    floor = build_floor()

    for scene_idx in range(args.count):
        # Fresh scene: drop 1..5 random assets, physics-settle, randomize view+light.
        bproc.utility.reset_keyframes()  # clear accumulated camera poses from prior scenes
        placed = []
        n = random.randint(2, 5)
        max_obj = 6  # a .blend can expand to many meshes/LODs — keep the scene bounded
        for _ in range(n):
            if len(placed) >= max_obj:
                break
            path, cls = random.choice(catalog)
            try:
                objs = load_asset(path)
            except Exception as e:  # noqa: BLE001 — a bad asset skips, never aborts the batch
                print(f"[scene.py] skip asset {path}: {e}", file=sys.stderr)
                continue
            for o in objs:
                nm = o.get_name()
                # Drop duplicate level-of-detail meshes (…_LOD1/2/3) and respect the cap.
                if len(placed) >= max_obj or any(t in nm for t in ("LOD1", "LOD2", "LOD3")):
                    o.delete()
                    continue
                o.set_cp("category_id", CLASS_ID[cls])
                # Blender 4.2 + this BlenderProc build doesn't auto-assign the
                # object-index pass at render (segmaps came out all-0) — set it
                # explicitly to a unique per-object index so the pass is non-zero.
                o.blender_obj.pass_index = len(placed) + 1
                # Normalize to ~0.8 m (Poly Haven unit scale varies wildly), then sit
                # it on a bounded 3×3 grid on the floor (no physics = no explosion).
                bb = o.get_bound_box()
                md = float(max(bb.max(axis=0) - bb.min(axis=0)))
                if md > 1e-6:
                    o.set_scale([0.8 / md] * 3)
                slot = len(placed)
                gx = ((slot % 3) - 1) * 0.8 + random.uniform(-0.08, 0.08)
                gy = ((slot // 3) - 1) * 0.8 + random.uniform(-0.08, 0.08)
                o.set_rotation_euler([0, 0, random.uniform(0, 6.28)])
                o.set_location([gx, gy, 0.0])
                zmin = float(o.get_bound_box().min(axis=0)[2])
                o.set_location([gx, gy, -zmin + 0.002])  # rest the bottom on the floor
                placed.append(o)

        light = bproc.types.Light()
        light.set_type(random.choice(["POINT", "SUN", "AREA"]))
        light.set_location([random.uniform(-3, 3), random.uniform(-3, 3), random.uniform(3, 6)])
        light.set_energy(random.uniform(300, 1500))

        # Camera on a -Y arc, ~3.5 m out, height ~2 m, looking at the grid centre —
        # reliably frames the ±1 m grid (domain-randomized within a safe envelope).
        target = np.array([0.0, 0.0, 0.4])
        cam_loc = np.array([random.uniform(-1.2, 1.2), random.uniform(-4.0, -3.0), random.uniform(1.6, 2.6)])
        rot = bproc.camera.rotation_from_forward_vec(target - cam_loc)
        bproc.camera.add_camera_pose(bproc.math.build_transformation_mat(list(cam_loc), rot))

        data = bproc.renderer.render()
        bproc.writer.write_coco_annotations(
            args.out,
            instance_segmaps=data["instance_segmaps"],
            instance_attribute_maps=data["instance_attribute_maps"],
            colors=data["colors"],
            color_file_format="JPEG",
            append_to_existing_output=scene_idx > 0,
        )

        # Reset dynamic objects for the next scene (keep floor).
        for o in placed:
            o.delete()

    # BlenderProc names COCO categories by object name (ArmChair_01) and can
    # duplicate them across appends. Rewrite each to its COCO class (chair) so
    # downstream scoring matches the perceiver's labels, and dedup by id.
    import json
    coco_path = os.path.join(args.out, "coco_annotations.json")
    try:
        id_to_class = {v: k for k, v in CLASS_ID.items()}
        with open(coco_path, "r", encoding="utf-8") as f:
            coco = json.load(f)
        by_id = {}
        for c in coco.get("categories", []):
            if c.get("id") in id_to_class:
                c["name"] = id_to_class[c["id"]]
            by_id[c["id"]] = c
        coco["categories"] = [by_id[k] for k in sorted(by_id)]
        with open(coco_path, "w", encoding="utf-8") as f:
            json.dump(coco, f)
        print(f"[scene.py] normalized {len(coco['categories'])} COCO categories to class names")
    except Exception as e:  # noqa: BLE001
        print(f"[scene.py] COCO category post-process skipped: {e}", file=sys.stderr)

    print(f"[scene.py] wrote COCO for {args.count} scene(s) → {args.out}")


if __name__ == "__main__":
    main()
