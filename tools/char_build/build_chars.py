#!/usr/bin/env python3
"""
From-scratch stylized low-poly Caribbean characters (Blender 4.x).
Overlapping boxes → Boolean UNION → remesh → zone materials → painted face →
Rigify → Idle/Walk → GLB. No Quaternius / Face plates / kitbash.
"""
import bpy
import bmesh
import math
import os
import sys
import shutil
import addon_utils
from mathutils import Vector, Euler

OUT_DIR = os.environ.get("CHAR_OUT", "/workspace/app13-caribcrime/tools/char_build/out")
PUBLIC_DIR = os.environ.get("CHAR_PUBLIC", "/workspace/app13-caribcrime/public/assets/characters")
os.makedirs(OUT_DIR, exist_ok=True)

SKIN_M = (0.46, 0.29, 0.18)
SKIN_F = (0.52, 0.33, 0.20)
HAIR = (0.06, 0.04, 0.03)
TANK = (0.08, 0.40, 0.46)
CARGO = (0.34, 0.28, 0.14)
BOOTS = (0.15, 0.09, 0.06)
CROP = (0.80, 0.20, 0.24)
SHORTS = (0.18, 0.22, 0.40)
HEADBAND = (0.90, 0.58, 0.12)
WHITE = (0.97, 0.97, 0.97)
IRIS = (0.09, 0.06, 0.04)
LIP = (0.52, 0.22, 0.20)
BROW = (0.06, 0.04, 0.03)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for b in list(coll):
            coll.remove(b)


def ensure_addons():
    addon_utils.enable("rigify", default_set=True, persistent=True)
    addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)


def make_mat(name, color, rough=0.72):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = rough
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    mat.diffuse_color = (*color, 1.0)
    return mat


def paint_face(name, skin, sex, size=512):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    px = [0.0] * (size * size * 4)
    sr, sg, sb = skin

    def setpx(x, y, r, g, b):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 4
            px[i:i+4] = [r, g, b, 1.0]

    def ell(cx, cy, rx, ry, r, g, b):
        for y in range(cy - ry - 1, cy + ry + 2):
            for x in range(cx - rx - 1, cx + rx + 2):
                if rx and ry and ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0:
                    setpx(x, y, r, g, b)

    def rect(x0, y0, x1, y1, r, g, b):
        for y in range(y0, y1):
            for x in range(x0, x1):
                setpx(x, y, r, g, b)

    for i in range(0, len(px), 4):
        px[i:i+4] = [sr, sg, sb, 1.0]
    ey = int(size * 0.60)
    for ex in (int(size*0.35), int(size*0.65)):
        ell(ex, ey, 20, 13, *WHITE)
        ell(ex, ey, 10, 10, *IRIS)
        ell(ex+3, ey+3, 3, 3, 0.95, 0.95, 0.95)
    by = ey + 20
    rect(int(size*0.26), by, int(size*0.44), by+6, *BROW)
    rect(int(size*0.56), by, int(size*0.74), by+6, *BROW)
    nx, ny = size//2, int(size*0.48)
    ell(nx, ny, 8, 13, sr*0.8, sg*0.8, sb*0.8)
    ell(nx-5, ny-7, 3, 2, sr*0.6, sg*0.6, sb*0.6)
    ell(nx+5, ny-7, 3, 2, sr*0.6, sg*0.6, sb*0.6)
    my = int(size*0.35)
    mw = 24 if sex == "female" else 18
    ell(size//2, my, mw, 7, *LIP)
    if sex == "male":
        for y in range(int(size*0.16), int(size*0.40)):
            for x in range(int(size*0.28), int(size*0.72)):
                dx = (x - size/2)/(size*0.18)
                dy = (y - size*0.27)/(size*0.12)
                if dx*dx + dy*dy < 1.0:
                    i = (y*size+x)*4
                    t = 0.42
                    px[i] = px[i]*(1-t)+0.05*t
                    px[i+1] = px[i+1]*(1-t)+0.03*t
                    px[i+2] = px[i+2]*(1-t)+0.02*t
    img.pixels = px
    img.pack()
    img.update()
    return img


def make_face_mat(name, skin, sex):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = paint_face(f"FaceTex_{sex}", skin, sex)
    tex.interpolation = "Closest"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.68
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.diffuse_color = (*skin, 1.0)
    return mat


def box(name, loc, scale):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def boolean_union(objects):
    """Union all objects into the first; return result."""
    base = objects[0]
    bpy.context.view_layer.objects.active = base
    for other in objects[1:]:
        mod = base.modifiers.new(name=f"Bool_{other.name}", type="BOOLEAN")
        mod.operation = "UNION"
        mod.solver = "EXACT"
        mod.object = other
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(other, do_unlink=True)
    base.name = "CharBody"
    return base


def build_body(sex="male"):
    skin_c = SKIN_M if sex == "male" else SKIN_F
    face = make_face_mat(f"FaceSkin_{sex}", skin_c, sex)
    skin = make_mat(f"Skin_{sex}", skin_c)
    hair = make_mat(f"Hair_{sex}", HAIR, 0.9)
    boots = make_mat(f"Boots_{sex}", BOOTS, 0.85)
    if sex == "male":
        shirt = make_mat("Tank_M", TANK)
        pants = make_mat("Cargo_M", CARGO)
        sw, cd, hw, hs = 0.46, 0.30, 0.38, 1.0
        hb = None
    else:
        shirt = make_mat("Crop_F", CROP)
        pants = make_mat("Shorts_F", SHORTS)
        hb = make_mat("Headband_F", HEADBAND, 0.5)
        sw, cd, hw, hs = 0.34, 0.24, 0.34, 0.96

    parts = []
    # Highly overlapping mannequin (~11+ core boxes + bridges)
    parts.append(box("Head", (0, 0, 1.62*hs), (0.22, 0.24, 0.24)))
    parts.append(box("Neck", (0, 0, 1.46*hs), (0.12, 0.12, 0.10)))
    if sex == "male":
        parts.append(box("Torso", (0, 0, 1.18*hs), (sw, cd, 0.32)))
        parts.append(box("Pelvis", (0, 0, 0.86*hs), (hw, 0.24, 0.18)))
    else:
        parts.append(box("Torso", (0, 0, 1.26*hs), (sw, cd, 0.18)))
        parts.append(box("Mid", (0, 0, 1.08*hs), (0.30, 0.20, 0.12)))
        parts.append(box("Pelvis", (0, 0, 0.88*hs), (hw, 0.22, 0.15)))

    ax = sw*0.5 + 0.08
    for sx, side in ((-1, "L"), (1, "R")):
        parts.append(box(f"Sh_{side}", (sx*(sw*0.55), 0, 1.38*hs), (0.14, 0.12, 0.12)))
        parts.append(box(f"UA_{side}", (sx*ax, 0.02, 1.22*hs), (0.11, 0.11, 0.24)))
        parts.append(box(f"FA_{side}", (sx*ax, 0.03, 0.92*hs), (0.09, 0.09, 0.20)))
        parts.append(box(f"H_{side}", (sx*ax, 0.04, 0.74*hs), (0.08, 0.10, 0.07)))
        parts.append(box(f"Hip_{side}", (sx*0.12, 0.0, 0.78*hs), (0.12, 0.14, 0.14)))
        parts.append(box(f"Th_{side}", (sx*0.14, 0.02, 0.55*hs), (0.13 if sex=="male" else 0.11, 0.14, 0.28)))
        parts.append(box(f"Shn_{side}", (sx*0.14, 0.03, 0.26*hs), (0.10, 0.11, 0.20)))
        parts.append(box(f"Ft_{side}", (sx*0.14, 0.07, 0.06), (0.11, 0.18, 0.09)))

    if sex == "male":
        parts.append(box("Hair", (0, -0.04, 1.76*hs), (0.23, 0.25, 0.14)))
        parts.append(box("Beard", (0, 0.12, 1.48*hs), (0.16, 0.07, 0.10)))
    else:
        parts.append(box("Bun", (0, -0.12, 1.80*hs), (0.18, 0.18, 0.14)))
        parts.append(box("BrL", (-0.14, -0.05, 1.52*hs), (0.06, 0.06, 0.18)))
        parts.append(box("BrR", (0.14, -0.05, 1.52*hs), (0.06, 0.06, 0.18)))
        parts.append(box("HB", (0, 0.04, 1.70*hs), (0.23, 0.24, 0.04)))

    body = boolean_union(parts)

    # Freeze world transforms so origin is world origin (feet near z=0)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Snap feet to z=0
    zs = [v.co.z for v in body.data.vertices]
    dz = -min(zs)
    for v in body.data.vertices:
        v.co.z += dz
    body.data.update()

    # Remesh for even topology
    rem = body.modifiers.new("Remesh", "REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = 0.032
    rem.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=rem.name)

    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.vertices_smooth(factor=0.4, repeat=3)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Record Z BEFORE any parenting
    zs = [v.co.z for v in body.data.vertices]
    print(f"[{sex}] z-range after remesh: {min(zs):.3f} .. {max(zs):.3f} tris={count_tris(body)}")

    assign_zones(body, sex, face, skin, shirt, pants, boots, hair, hb, hs)

    tri = count_tris(body)
    if tri > 18000:
        dec = body.modifiers.new("Decimate", "DECIMATE")
        dec.ratio = 15000 / tri
        bpy.ops.object.modifier_apply(modifier=dec.name)
        print(f"[{sex}] decimated to {count_tris(body)}")
    elif tri < 10000:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.subdivide(number_cuts=1)
        bpy.ops.object.mode_set(mode="OBJECT")
        # re-assign after subdiv (indices preserved usually)
        print(f"[{sex}] subdivided to {count_tris(body)}")

    sculpt(body, sex, hs)
    project_face_uv(body, hs)
    body.name = f"CharBody_{sex}"
    print(f"[{sex}] final tris={count_tris(body)} mats={[m.name for m in body.data.materials]}")
    from collections import Counter
    print(f"[{sex}] mat faces={dict(Counter(p.material_index for p in body.data.polygons))}")
    return body


def assign_zones(body, sex, face, skin, shirt, pants, boots, hair, hb, hs):
    body.data.materials.clear()
    mats = [face, skin, shirt, pants, boots, hair]
    if hb:
        mats.append(hb)
    for m in mats:
        body.data.materials.append(m)
    # Use absolute height bands from actual mesh extents
    zs = [v.co.z for v in body.data.vertices]
    zmin, zmax = min(zs), max(zs)
    h = zmax - zmin
    def t(z):
        return (z - zmin) / h if h else 0

    for poly in body.data.polygons:
        c = sum((body.data.vertices[vi].co for vi in poly.vertices), Vector()) / len(poly.vertices)
        tt = t(c.z)
        x, y = c.x, c.y
        # relative bands
        if tt > 0.92:  # top hair
            poly.material_index = 5
        elif sex == "female" and 0.88 < tt < 0.93 and abs(y) < 0.08:
            poly.material_index = 6 if hb else 5  # headband
        elif sex == "female" and tt > 0.78 and (y < -0.02 or abs(x) > 0.10):
            poly.material_index = 5  # braids/bun
        elif sex == "male" and tt > 0.78 and y > 0.06 and abs(x) < 0.18:
            poly.material_index = 5  # beard
        elif tt > 0.78:
            poly.material_index = 0  # face
        elif tt < 0.10:
            poly.material_index = 4  # boots
        elif sex == "male" and 0.55 < tt < 0.80 and abs(x) < 0.38:
            poly.material_index = 2  # tank
        elif sex == "female" and 0.68 < tt < 0.80 and abs(x) < 0.28:
            poly.material_index = 2  # crop
        elif sex == "female" and 0.58 < tt < 0.68 and abs(x) < 0.26:
            poly.material_index = 1  # midriff skin
        elif 0.28 < tt < 0.58 and abs(x) < 0.32:
            poly.material_index = 3  # shorts/cargo
        elif 0.28 < tt < 0.50:
            poly.material_index = 3
        else:
            poly.material_index = 1  # skin limbs


def sculpt(body, sex, hs):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    zs = [v.co.z for v in bm.verts]
    zmax = max(zs)
    for v in bm.verts:
        if v.co.z > zmax - 0.35:
            center = Vector((0, 0, zmax - 0.18))
            d = v.co - center
            if d.length > 1e-5:
                v.co = center + d.normalized() * (d.length * 0.45 + 0.18 * 0.55)
        if sex == "male" and 1.05*hs < v.co.z < 1.35*hs and abs(v.co.x) > 0.15:
            v.co.x *= 1.04
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(body.data)
    bm.free()


def project_face_uv(body, hs):
    bpy.context.view_layer.objects.active = body
    mesh = body.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
    except Exception:
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = mesh.uv_layers.active
    zs = [v.co.z for v in mesh.vertices]
    zmax = max(zs)
    head_cut = zmax - 0.40
    for poly in mesh.polygons:
        c = sum((mesh.vertices[vi].co for vi in poly.vertices), Vector()) / len(poly.vertices)
        if c.z < head_cut or c.y < -0.01:
            continue
        for li in poly.loop_indices:
            v = mesh.vertices[mesh.loops[li].vertex_index].co
            u = 0.5 + (v.x / 0.28) * 0.42
            vv = 0.25 + ((v.z - head_cut) / 0.45) * 0.60
            uv.data[li].uv = (max(0.02, min(0.98, u)), max(0.02, min(0.98, vv)))


def count_tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def align_metarig(metarig, body, sex):
    bbox = [body.matrix_world @ Vector(c) for c in body.bound_box]
    min_z = min(v.z for v in bbox)
    max_z = max(v.z for v in bbox)
    height = max_z - min_z
    bpy.context.view_layer.objects.active = metarig
    metarig.location = (0, 0, min_z)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = metarig.data.edit_bones
    head_bone, root = eb.get("spine.006"), eb.get("spine")
    if head_bone and root:
        m_h = (head_bone.tail - root.head).length
        if m_h > 1e-4:
            scale = height / m_h * 0.97
            bpy.ops.object.mode_set(mode="OBJECT")
            metarig.scale = (scale, scale, scale)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            bpy.ops.object.mode_set(mode="EDIT")
            eb = metarig.data.edit_bones

    def sb(name, head, tail):
        b = eb.get(name)
        if b:
            b.head, b.tail = Vector(head), Vector(tail)

    # Use actual mesh extents
    zs = [v.co.z for v in body.data.vertices]
    z0, z1 = min(zs), max(zs)
    h = z1 - z0
    def Z(t): return z0 + h * t
    arm_x = 0.42 if sex == "male" else 0.34
    sb("spine", (0, 0.02, Z(0.48)), (0, 0.02, Z(0.55)))
    sb("spine.001", (0, 0.02, Z(0.55)), (0, 0.02, Z(0.62)))
    sb("spine.002", (0, 0.01, Z(0.62)), (0, 0.01, Z(0.70)))
    sb("spine.003", (0, 0.0, Z(0.70)), (0, 0.0, Z(0.78)))
    sb("spine.004", (0, 0.0, Z(0.78)), (0, 0.0, Z(0.84)))
    sb("spine.005", (0, 0.0, Z(0.84)), (0, 0.0, Z(0.88)))
    sb("spine.006", (0, 0.0, Z(0.88)), (0, 0.0, Z(0.98)))
    for side, sx in (("L", 1), ("R", -1)):
        sb(f"shoulder.{side}", (sx*0.06, 0, Z(0.78)), (sx*arm_x*0.45, 0, Z(0.78)))
        sb(f"upper_arm.{side}", (sx*arm_x*0.45, 0, Z(0.76)), (sx*arm_x, 0.02, Z(0.58)))
        sb(f"forearm.{side}", (sx*arm_x, 0.02, Z(0.58)), (sx*arm_x, 0.04, Z(0.42)))
        sb(f"hand.{side}", (sx*arm_x, 0.04, Z(0.42)), (sx*arm_x, 0.08, Z(0.36)))
        sb(f"thigh.{side}", (sx*0.12, 0.01, Z(0.48)), (sx*0.13, 0.02, Z(0.26)))
        sb(f"shin.{side}", (sx*0.13, 0.02, Z(0.26)), (sx*0.13, 0.04, Z(0.06)))
        sb(f"foot.{side}", (sx*0.13, 0.04, Z(0.06)), (sx*0.13, 0.16, Z(0.02)))
        sb(f"toe.{side}", (sx*0.13, 0.16, Z(0.02)), (sx*0.13, 0.22, Z(0.02)))
        heel = eb.get(f"heel.02.{side}")
        if heel:
            heel.head = Vector((sx*0.13, -0.02, Z(0.01)))
            heel.tail = Vector((sx*0.19, -0.02, Z(0.01)))
    bpy.ops.object.mode_set(mode="OBJECT")


def generate_rig(metarig):
    bpy.context.view_layer.objects.active = metarig
    metarig.select_set(True)
    bpy.ops.pose.rigify_generate()
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and o != metarig and "meta" not in o.name.lower():
            return o
    return None


def bind_mesh(body, rig):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def key_rot(pb, frame, euler):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler(euler)
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def key_loc(pb, frame, loc):
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)


def make_idle(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    pb = rig.pose.bones
    action = bpy.data.actions.new("Idle")
    if not rig.animation_data:
        rig.animation_data_create()
    rig.animation_data.action = action
    for name in ("torso", "chest", "hips", "upper_arm_fk.L", "upper_arm_fk.R", "thigh_fk.L", "thigh_fk.R"):
        if name not in pb:
            continue
        b = pb[name]
        if "arm" in name:
            side = 1 if name.endswith(".L") else -1
            key_rot(b, 1, (math.radians(8), 0, math.radians(side*5)))
            key_rot(b, 40, (math.radians(11), 0, math.radians(side*5)))
            key_rot(b, 80, (math.radians(8), 0, math.radians(side*5)))
        elif "thigh" in name:
            key_rot(b, 1, (math.radians(-3), 0, 0))
            key_rot(b, 40, (math.radians(-5), 0, 0))
            key_rot(b, 80, (math.radians(-3), 0, 0))
        else:
            key_rot(b, 1, (0, 0, 0))
            key_rot(b, 40, (math.radians(2.5), 0, 0))
            key_rot(b, 80, (0, 0, 0))
            if name == "torso":
                key_loc(b, 1, (0, 0, 0))
                key_loc(b, 40, (0, 0, 0.014))
                key_loc(b, 80, (0, 0, 0))
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
        fc.modifiers.new(type="CYCLES")
    bpy.ops.object.mode_set(mode="OBJECT")
    action.name = "Idle"
    return action


def make_walk(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    pb = rig.pose.bones
    action = bpy.data.actions.new("Walk")
    if not rig.animation_data:
        rig.animation_data_create()
    rig.animation_data.action = action

    def B(*names):
        for n in names:
            if n in pb:
                return pb[n]
        return None

    thigh_l, thigh_r = B("thigh_fk.L"), B("thigh_fk.R")
    shin_l, shin_r = B("shin_fk.L"), B("shin_fk.R")
    arm_l, arm_r = B("upper_arm_fk.L"), B("upper_arm_fk.R")
    fa_l, fa_r = B("forearm_fk.L"), B("forearm_fk.R")
    torso = B("torso")
    foot_l, foot_r = B("foot_fk.L"), B("foot_fk.R")

    def leg(th, sh, ft, f, tx, sx):
        if th: key_rot(th, f, (math.radians(tx), 0, 0))
        if sh: key_rot(sh, f, (math.radians(sx), 0, 0))
        if ft: key_rot(ft, f, (math.radians(-tx*0.25), 0, 0))

    def arm(ua, fa, f, ux, fx, z):
        if ua: key_rot(ua, f, (math.radians(ux), 0, math.radians(z)))
        if fa: key_rot(fa, f, (math.radians(fx), 0, 0))

    for f, L, R in ((1, 30, -24), (8, 12, -10), (16, -24, 30), (24, -10, 12), (32, 30, -24)):
        ls = 18 if L > 0 else 38
        rs = 18 if R > 0 else 38
        if f in (8, 24):
            ls = rs = 42
        leg(thigh_l, shin_l, foot_l, f, L, ls)
        leg(thigh_r, shin_r, foot_r, f, R, rs)
        arm(arm_l, fa_l, f, -R*0.75, 22 if R > 0 else 36, 8)
        arm(arm_r, fa_r, f, -L*0.75, 22 if L > 0 else 36, -8)
        if torso:
            key_rot(torso, f, (math.radians(5), 0, math.radians(2 if L > 0 else -2)))
            key_loc(torso, f, (0, 0, 0.0 if f in (1, 16, 32) else 0.02))
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
        fc.modifiers.new(type="CYCLES")
    bpy.ops.object.mode_set(mode="OBJECT")
    action.name = "Walk"
    return action


def push_nla(rig, actions):
    if not rig.animation_data:
        rig.animation_data_create()
    ad = rig.animation_data
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


def export_glb(rig, body, path, actions):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    for o in bpy.data.objects:
        if "meta" in o.name.lower():
            o.hide_render = True
            o.hide_viewport = True
            o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    push_nla(rig, actions)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
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
    )
    print("Exported", path, os.path.getsize(path))


def build_character(sex="male"):
    clear_scene()
    ensure_addons()
    print(f"=== Building {sex} ===")
    body = build_body(sex)
    tri = count_tris(body)
    bpy.ops.object.armature_basic_human_metarig_add()
    metarig = bpy.context.active_object
    metarig.name = f"metarig_{sex}"
    align_metarig(metarig, body, sex)
    # Save unbound mesh snapshot for debug
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f"{sex}_mesh.blend"))
    rig = generate_rig(metarig)
    if not rig:
        raise RuntimeError("Rigify failed")
    print(f"[{sex}] rig={rig.name}")
    bind_mesh(body, rig)
    idle, walk = make_idle(rig), make_walk(rig)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f"{sex}.blend"))
    glb = os.path.join(OUT_DIR, f"{sex}.glb")
    export_glb(rig, body, glb, [idle, walk])
    pub = os.path.join(PUBLIC_DIR, f"{sex}.glb")
    shutil.copy2(glb, pub)
    if sex == "male":
        shutil.copy2(glb, os.path.join(PUBLIC_DIR, "player.glb"))
    print(f"[{sex}] DONE tris={tri}")
    return {"sex": sex, "tris": tri, "glb": pub, "bytes": os.path.getsize(pub)}


def main():
    ensure_addons()
    targets = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["male", "female"]
    results = [build_character(s) for s in targets if s in ("male", "female")]
    open(os.path.join(OUT_DIR, "build_summary.txt"), "w").write("\n".join(map(str, results)))
    print("DONE", results)


if __name__ == "__main__":
    main()
