"""
Build app13 male.glb / female.glb from OPNassetBUILDER hero meshes.

Source: https://app14.nextaura.us/assets/{male,female}-hero.gltf
(mirrored at /workspace/opn-chars/)

- Recolor skin/hair/cloth/eyes toward Belizean / Trinidadian refs
- Split skin faces into shorts + boots via primary joint weights
- Procedural Idle / Walk / Run on the 17-bone humanoid
- Rotate mesh 180° Y so facing matches Mixamo (-Z) and existing MODEL_YAW_OFFSET
"""
from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler, Vector, Matrix

SRC = {
    "male": "/workspace/opn-chars/male-hero.gltf",
    "female": "/workspace/opn-chars/female-hero.gltf",
}
OUT_DIR = "/workspace/app13-caribcrime/public/assets/characters"
WORK = "/workspace/app13-caribcrime/tools/opn_hero_build/out"

# Belize / Trinidad palette (linear-ish sRGB factors for Principled)
PALETTE = {
    "male": {
        "skin": (0.16, 0.09, 0.06, 1.0),
        "hair": (0.04, 0.025, 0.02, 1.0),
        "cloth": (0.93, 0.93, 0.91, 1.0),  # white tank
        "shorts": (0.32, 0.38, 0.20, 1.0),  # olive cargo
        "boots": (0.42, 0.30, 0.16, 1.0),  # tan
        "eyes": (0.06, 0.06, 0.08, 1.0),
        "backpack": (0.18, 0.16, 0.12, 1.0),
    },
    "female": {
        "skin": (0.18, 0.10, 0.07, 1.0),
        "hair": (0.05, 0.03, 0.02, 1.0),
        "cloth": (0.82, 0.10, 0.12, 1.0),  # red crop
        "shorts": (0.52, 0.45, 0.28, 1.0),  # khaki
        "boots": (0.40, 0.28, 0.15, 1.0),
        "eyes": (0.06, 0.06, 0.08, 1.0),
        "backpack": (0.12, 0.12, 0.14, 1.0),
    },
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_mat_color(mat, rgba, roughness=0.65, metallic=0.0):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = None
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED":
            bsdf = n
            break
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = rgba
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = rgba


def ensure_mat(name, rgba, roughness=0.65):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    set_mat_color(mat, rgba, roughness=roughness)
    return mat


def primary_joint(vert, obj):
    """Return armature bone name with highest weight for vertex, or None."""
    groups = obj.vertex_groups
    best_w, best_name = 0.0, None
    for g in vert.groups:
        if g.weight <= best_w:
            continue
        vg = groups[g.group]
        # strip possible object prefixes
        name = vg.name
        best_w, best_name = g.weight, name
    return best_name


def recolor_and_split(mesh_obj, sex):
    pal = PALETTE[sex]
    mesh = mesh_obj.data

    # Map existing slot names
    slot_by_name = {}
    for i, mat in enumerate(mesh.materials):
        if mat:
            slot_by_name[mat.name.split(".")[0].lower()] = i
            set_mat_color(
                mat,
                pal.get(mat.name.split(".")[0].lower(), pal["skin"]),
                roughness=0.55 if "skin" in mat.name.lower() else 0.7,
            )

    shorts = ensure_mat(f"{sex}_shorts", pal["shorts"], roughness=0.78)
    boots = ensure_mat(f"{sex}_boots", pal["boots"], roughness=0.82)
    # rename stock materials for clarity
    for mat in mesh.materials:
        if not mat:
            continue
        base = mat.name.split(".")[0].lower()
        if base == "skin":
            set_mat_color(mat, pal["skin"], roughness=0.58)
            mat.name = f"{sex}_skin"
        elif base == "hair":
            set_mat_color(mat, pal["hair"], roughness=0.85)
            mat.name = f"{sex}_hair"
        elif base == "cloth":
            set_mat_color(mat, pal["cloth"], roughness=0.72)
            mat.name = f"{sex}_cloth"
        elif base == "eyes":
            set_mat_color(mat, pal["eyes"], roughness=0.25)
            mat.name = f"{sex}_eyes"

    # Add shorts/boots slots
    if shorts.name not in [m.name for m in mesh.materials if m]:
        mesh.materials.append(shorts)
    if boots.name not in [m.name for m in mesh.materials if m]:
        mesh.materials.append(boots)

    idx = {m.name: i for i, m in enumerate(mesh.materials) if m}
    skin_idxs = {i for n, i in idx.items() if "skin" in n}
    shorts_i = idx[shorts.name]
    boots_i = idx[boots.name]

    # Need vertex heights in object space (Blender Z-up after import)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.mode_set(mode="OBJECT")

    # Precompute primary bone per vert
    prim = []
    for v in mesh.vertices:
        prim.append(primary_joint(v, mesh_obj))

    SHORT_BONES = {"thigh.L", "thigh.R", "hips"}  # knees stay skin → calves show under cargo shorts
    BOOT_BONES = {"ankle.L", "ankle.R"}

    for poly in mesh.polygons:
        if poly.material_index not in skin_idxs:
            continue
        bones = [prim[vi] for vi in poly.vertices]
        # majority vote
        from collections import Counter
        c = Counter(b for b in bones if b)
        if not c:
            continue
        top, _ = c.most_common(1)[0]
        zs = [mesh.vertices[vi].co.z for vi in poly.vertices]
        zavg = sum(zs) / len(zs)
        if top in BOOT_BONES or zavg < 0.22:
            poly.material_index = boots_i
        elif top in SHORT_BONES and zavg < 0.98:
            poly.material_index = shorts_i
        elif top == "hips" and zavg < 1.05:
            poly.material_index = shorts_i


def key_rot(pb, frame, euler_xyz_deg):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler(
        (
            math.radians(euler_xyz_deg[0]),
            math.radians(euler_xyz_deg[1]),
            math.radians(euler_xyz_deg[2]),
        ),
        "XYZ",
    )
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def key_loc(pb, frame, loc):
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)


def make_idle(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones
    action = bpy.data.actions.new("Idle")
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action

    # Bones point roughly +Z (up). Character faces -Y in Blender.
    # Slight breath + arm hang.
    for f, breath, arm_drop in ((1, 0.0, 6.0), (40, 0.012, 8.0), (80, 0.0, 6.0)):
        if "hips" in pb:
            key_loc(pb["hips"], f, (0, 0, breath))
            key_rot(pb["hips"], f, (2, 0, 0))
        if "spine" in pb:
            key_rot(pb["spine"], f, (2.5 if breath else 1.0, 0, 0))
        if "chest" in pb:
            key_rot(pb["chest"], f, (1.5, 0, 0))
        for side, sign in (("L", 1), ("R", -1)):
            sh = f"shoulder.{side}"
            el = f"elbow.{side}"
            if sh in pb:
                # hang arms slightly forward/out
                key_rot(pb[sh], f, (arm_drop, 0, sign * 8))
            if el in pb:
                key_rot(pb[el], f, (12 + (2 if breath else 0), 0, 0))
        for side in ("L", "R"):
            th = f"thigh.{side}"
            if th in pb:
                key_rot(pb[th], f, (-3, 0, 0))

    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
        fc.modifiers.new(type="CYCLES")
    bpy.ops.object.mode_set(mode="OBJECT")
    action.name = "Idle"
    return action


def make_locomotion(arm, name, scale=1.0, frames=32):
    """Walk (scale=1) or Run (scale~1.6)."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones
    action = bpy.data.actions.new(name)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action

    # Cycle key poses. Positive thigh X swings leg toward -Y (forward) depending on rest.
    # Empirically for this OPN rig (bone +Z up): negative X on thigh = forward swing.
    half = frames // 2
    poses = [
        (1, 30 * scale, -24 * scale),
        (half // 2, 10 * scale, -8 * scale),
        (half, -24 * scale, 30 * scale),
        (half + half // 2, -8 * scale, 10 * scale),
        (frames, 30 * scale, -24 * scale),
    ]

    for f, L, R in poses:
        # legs
        for side, ang in (("L", L), ("R", R)):
            th = f"thigh.{side}"
            kn = f"knee.{side}"
            an = f"ankle.{side}"
            knee_bend = 20 * scale if ang > 0 else 38 * scale
            if f in (half // 2, half + half // 2):
                knee_bend = 45 * scale
            if th in pb:
                key_rot(pb[th], f, (-ang, 0, 0))  # invert: forward
            if kn in pb:
                key_rot(pb[kn], f, (knee_bend, 0, 0))
            if an in pb:
                key_rot(pb[an], f, (-ang * 0.2, 0, 0))
        # opposite arm swing
        for side, ang, sign in (("L", R, 1), ("R", L, -1)):
            sh = f"shoulder.{side}"
            el = f"elbow.{side}"
            if sh in pb:
                key_rot(pb[sh], f, (8 + abs(ang) * 0.35, 0, sign * 10))
            if el in pb:
                key_rot(pb[el], f, (18 + (8 if ang < 0 else 0) * scale, 0, 0))
        if "hips" in pb:
            bob = 0.0 if f in (1, half, frames) else 0.018 * scale
            key_loc(pb["hips"], f, (0, 0, bob))
            key_rot(pb["hips"], f, (4 * scale, 0, (2 if L > 0 else -2)))
        if "spine" in pb:
            key_rot(pb["spine"], f, (3 * scale, 0, (3 if L > 0 else -3)))
        if "chest" in pb:
            key_rot(pb["chest"], f, (2, 0, (-2 if L > 0 else 2)))

    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
        fc.modifiers.new(type="CYCLES")
    bpy.ops.object.mode_set(mode="OBJECT")
    action.name = name
    return action


def push_nla(arm, actions):
    if not arm.animation_data:
        arm.animation_data_create()
    ad = arm.animation_data
    while ad.nla_tracks:
        ad.nla_tracks.remove(ad.nla_tracks[0])
    for act in actions:
        track = ad.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, 1, act)
        strip.action = act
        strip.name = act.name
        strip.frame_end = 1 + (act.frame_range[1] - act.frame_range[0])
    ad.action = None


def rotate_root_180_y(arm, mesh_obj):
    """Make character face -Z in glTF (Mixamo convention) so MODEL_YAW_OFFSET=PI stays valid.
    After Blender import, character faces -Y. Export Y-up converts Blender -Y → glTF +Z.
    Rotating 180° around Z (up) in Blender makes face +Y → glTF -Z.
    """
    # Parent mesh already skinned to armature. Rotate armature object 180 around Z.
    arm.rotation_mode = "XYZ"
    arm.rotation_euler[2] = math.pi
    bpy.context.view_layer.update()
    # Apply to armature so bind pose / anims bake correctly
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export_glb(arm, mesh_obj, path, actions):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    push_nla(arm, actions)
    # Hide stray objects
    for o in bpy.data.objects:
        if o not in (arm, mesh_obj):
            o.hide_render = True
            o.hide_viewport = True
            o.select_set(False)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_def_bones=True,
        export_optimize_animation_size=True,
        export_yup=True,
        export_materials="EXPORT",
        export_texcoords=True,
        export_normals=True,
        export_skins=True,
        export_morph=False,
        export_nla_strips=False,
    )
    print("Exported", path, os.path.getsize(path))


def build_one(sex: str):
    clear_scene()
    src = SRC[sex]
    print(f"=== Import {src} ===")
    bpy.ops.import_scene.gltf(filepath=src)

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "Icosphere"]
    if not arms or not meshes:
        raise RuntimeError(f"Import failed for {sex}: arms={arms} meshes={meshes}")
    arm = arms[0]
    mesh_obj = meshes[0]

    recolor_and_split(mesh_obj, sex)
    rotate_root_180_y(arm, mesh_obj)

    idle = make_idle(arm)
    walk = make_locomotion(arm, "Walk", scale=1.0, frames=32)
    run = make_locomotion(arm, "Run", scale=1.55, frames=24)
    actions = [idle, walk, run]

    os.makedirs(WORK, exist_ok=True)
    out = os.path.join(WORK, f"{sex}.glb")
    export_glb(arm, mesh_obj, out, actions)
    return out


def main():
    outs = []
    for sex in ("male", "female"):
        outs.append(build_one(sex))
    # install into public
    os.makedirs(OUT_DIR, exist_ok=True)
    import shutil

    male = os.path.join(WORK, "male.glb")
    female = os.path.join(WORK, "female.glb")
    shutil.copy2(male, os.path.join(OUT_DIR, "male.glb"))
    shutil.copy2(female, os.path.join(OUT_DIR, "female.glb"))
    shutil.copy2(male, os.path.join(OUT_DIR, "player.glb"))
    print("Installed male/female/player into", OUT_DIR)
    for p in outs:
        print("OK", p, os.path.getsize(p))


if __name__ == "__main__":
    main()
