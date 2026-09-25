"""Normalize Marco Belizean/Trinidadian build_characters turnaround GLBs for app13.

Keep character standing on Blender +Z (native up). glTF export_yup maps
Blender Z-up -> glTF Y-up. Do NOT pre-rotate to Y or export double-converts.
Scale to ~1.7m, feet on z=0, recalc normals, binary GLB.

Source: build_characters.py iteration 2 (fingers + detail; static trimeshes, no skins/clips).
Prior iteration 1 sources: /workspace/marco-char-delta3/*_build.glb (provenance *_build.glb kept).
"""
import bpy
import shutil
from mathutils import Vector

TARGET_H = 1.7
OUT_DIR = "/workspace/app13-caribcrime/public/assets/characters"

JOBS = [
    (
        "/workspace/marco-char-delta4/male_belizean_build_v2.glb",
        f"{OUT_DIR}/male.glb",
        "male",
        f"{OUT_DIR}/male_belizean_build_v2.glb",
    ),
    (
        "/workspace/marco-char-delta4/female_trinidadian_build_v2.glb",
        f"{OUT_DIR}/female.glb",
        "female",
        f"{OUT_DIR}/female_trinidadian_build_v2.glb",
    ),
]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bounds(objs):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            mins = Vector(tuple(min(a, b) for a, b in zip(mins, w)))
            maxs = Vector(tuple(max(a, b) for a, b in zip(maxs, w)))
    return mins, maxs


def apply_sel(meshes):
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def ensure_z_up(meshes, label):
    """Blender glTF import usually yields Z-up; some files may already be Y-up in Blender.
    If tallest axis is Y (or X), rotate so standing height is on +Z before normalize.
    """
    mins, maxs = world_bounds(meshes)
    hx, hy, hz = (maxs - mins).x, (maxs - mins).y, (maxs - mins).z
    print(f"[{label}] pre-orient size X={hx:.3f} Y={hy:.3f} Z={hz:.3f}")
    if hz >= hx and hz >= hy:
        return  # already Z-up
    # Rotate so the tallest axis becomes +Z
    if hy >= hx and hy >= hz:
        # Y is up -> rotate -90° about X (Y -> Z)
        print(f"[{label}] Y-up detected; rotating -90° about X to Z-up")
        for o in meshes:
            o.rotation_euler.x -= 1.5707963267948966
    elif hx >= hy and hx >= hz:
        print(f"[{label}] X-up detected; rotating +90° about Y to Z-up")
        for o in meshes:
            o.rotation_euler.y += 1.5707963267948966
    bpy.context.view_layer.update()
    apply_sel(meshes)


def process(src, dst, label):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no meshes in {src}")

    # Drop empties — flatten so transforms live on meshes
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" and o.type != "CAMERA" and o.type != "LIGHT":
            for c in list(o.children):
                mw = c.matrix_world.copy()
                c.parent = None
                c.matrix_world = mw
            try:
                bpy.data.objects.remove(o, do_unlink=True)
            except Exception:
                pass

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    apply_sel(meshes)
    ensure_z_up(meshes, label)

    mins, maxs = world_bounds(meshes)
    hx, hy, hz = (maxs - mins).x, (maxs - mins).y, (maxs - mins).z
    print(f"[{label}] raw size X={hx:.3f} Y={hy:.3f} Z={hz:.3f} minZ={mins.z:.3f}")
    if hz < hx or hz < hy:
        raise RuntimeError(f"[{label}] expected Z-up after import, got size {hx,hy,hz}")

    # Head size note (detect oversized / wrong head)
    for o in meshes:
        if o.name.lower().startswith("head") and "wrap" not in o.name.lower():
            print(f"[{label}] head mesh dims={tuple(round(d, 4) for d in o.dimensions)} name={o.name}")

    scale = TARGET_H / hz
    for o in meshes:
        o.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    apply_sel(meshes)

    mins, maxs = world_bounds(meshes)
    dz = -mins.z
    for o in meshes:
        o.location.z += dz
    bpy.context.view_layer.update()
    apply_sel(meshes)

    for o in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")

    mins, maxs = world_bounds(meshes)
    print(
        f"[{label}] Blender FINAL H(z)={maxs.z-mins.z:.3f} minZ={mins.z:.3f} "
        f"size={(maxs-mins).x:.3f},{(maxs-mins).y:.3f},{(maxs-mins).z:.3f} meshes={len(meshes)}"
    )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_yup=True,
    )
    print(f"[{label}] wrote {dst}")


def main():
    for src, dst, label, provenance in JOBS:
        process(src, dst, label)
        shutil.copyfile(dst, provenance)
        print(f"provenance {dst} -> {provenance}")
    shutil.copyfile(f"{OUT_DIR}/male.glb", f"{OUT_DIR}/player.glb")
    print("copied male.glb -> player.glb")


if __name__ == "__main__":
    main()
