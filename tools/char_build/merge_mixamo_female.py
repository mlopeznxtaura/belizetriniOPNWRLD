"""Merge Mixamo Erika Archer + Idle/Walk → female.glb. Height may be Z-up; player.js corrects."""
import bpy
import os
import mathutils

OUT = "/workspace/app13-caribcrime/public/assets/characters/female.glb"
BASE = "/tmp/chars/mixamo/Erika_Archer.fbx"
IDLE = "/tmp/chars/mixamo/Standing_Idle_Female.fbx"
if not os.path.exists(IDLE):
    IDLE = "/tmp/chars/mixamo/Idle_Female.fbx"
WALK = "/tmp/chars/mixamo/Walking_Female.fbx"

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, use_anim=True)
    return (
        [o for o in bpy.data.objects if o not in before],
        [a for a in bpy.data.actions if a not in before_actions],
    )


def find_armature(objs=None):
    for o in (objs or bpy.data.objects):
        if o.type == "ARMATURE":
            return o
    return None


base_objs, base_actions = import_fbx(BASE)
arm = find_armature(base_objs)
assert arm
if arm.animation_data:
    arm.animation_data_clear()
for a in list(base_actions):
    bpy.data.actions.remove(a)

bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
for c in arm.children:
    c.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def steal_action(path, name):
    objs, actions = import_fbx(path)
    assert actions
    act_copy = actions[0].copy()
    act_copy.name = name
    for fc in act_copy.fcurves:
        if "location" in (fc.data_path or ""):
            for kp in fc.keyframe_points:
                kp.co[1] *= 0.01
                kp.handle_left[1] *= 0.01
                kp.handle_right[1] *= 0.01
    for o in list(objs):
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(actions):
        try:
            bpy.data.actions.remove(a)
        except Exception:
            pass
    return act_copy


idle = steal_action(IDLE, "Idle")
walk = steal_action(WALK, "Walk")
if not arm.animation_data:
    arm.animation_data_create()
while arm.animation_data.nla_tracks:
    arm.animation_data.nla_tracks.remove(arm.animation_data.nla_tracks[0])
for clip in (idle, walk):
    track = arm.animation_data.nla_tracks.new()
    track.name = clip.name
    strip = track.strips.new(clip.name, int(clip.frame_range[0]), clip)
    strip.action = clip
    strip.name = clip.name

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_nla_strips=True,
    export_force_sampling=True,
    export_apply=True,
    export_skins=True,
    export_yup=True,
)
print("WROTE", OUT, os.path.getsize(OUT))
