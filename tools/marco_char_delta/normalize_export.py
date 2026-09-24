"""Normalize Marco Belizean/Trinidadian trimesh GLBs for app13.

Keep character standing on Blender +Z (native up). glTF export_yup maps
Blender Z-up -> glTF Y-up. Do NOT pre-rotate to Y or export double-converts.
Scale to ~1.7m, feet on z=0, recalc normals, binary GLB.
"""
import bpy
import shutil
from mathutils import Vector

TARGET_H = 1.7
OUT_DIR = "/workspace/app13-caribcrime/public/assets/characters"

JOBS = [
    ("/workspace/marco-char-delta/unzipped/male_belizean.glb", f"{OUT_DIR}/male.glb", "male"),
    ("/workspace/marco-char-delta/unzipped/female_trinidadian.glb", f"{OUT_DIR}/female.glb", "female"),
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


def process(src, dst, label):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no meshes in {src}")

    # Drop empties — flatten so transforms live on meshes
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" and o.type != "CAMERA" and o.type != "LIGHT":
            # unparent children keep transform
            for c in list(o.children):
                mw = c.matrix_world.copy()
                c.parent = None
                c.matrix_world = mw
            if o.name != "world" or True:
                try:
                    bpy.data.objects.remove(o, do_unlink=True)
                except Exception:
                    pass

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    apply_sel(meshes)

    mins, maxs = world_bounds(meshes)
    # Source is already Z-up (height along Z). Confirm.
    hx, hy, hz = (maxs - mins).x, (maxs - mins).y, (maxs - mins).z
    print(f"[{label}] raw size X={hx:.3f} Y={hy:.3f} Z={hz:.3f} minZ={mins.z:.3f}")
    if hz < hx or hz < hy:
        raise RuntimeError(f"[{label}] expected Z-up source, got size {hx,hy,hz}")

    scale = TARGET_H / hz
    for o in meshes:
        o.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    apply_sel(meshes)

    mins, maxs = world_bounds(meshes)
    # Feet on z=0 (Blender up)
    dz = -mins.z
    for o in meshes:
        o.location.z += dz
    bpy.context.view_layer.update()
    apply_sel(meshes)

    # Recalc normals outside
    for o in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")

    mins, maxs = world_bounds(meshes)
    print(f"[{label}] Blender FINAL H(z)={maxs.z-mins.z:.3f} minZ={mins.z:.3f} size={(maxs-mins).x:.3f},{(maxs-mins).y:.3f},{(maxs-mins).z:.3f}")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_yup=True,  # Blender Z-up -> glTF Y-up (correct once)
    )
    print(f"[{label}] wrote {dst}")


def main():
    for src, dst, label in JOBS:
        process(src, dst, label)
    shutil.copyfile(f"{OUT_DIR}/male.glb", f"{OUT_DIR}/player.glb")
    print("copied male.glb -> player.glb")


if __name__ == "__main__":
    main()
