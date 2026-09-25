"""Side-by-side delta render: iter2 (build_v2) vs lowpoly, male + female rows,
front / 3/4 / side columns. One scene, one ortho camera, Workbench studio light.

  blender -b -P tools/marco_char_delta/render_compare.py
"""
import bpy, math
from mathutils import Vector

C = "/workspace/app13-caribcrime/public/assets/characters"
OUT = "/workspace/app13-caribcrime/tools/marco_char_delta/compare_iter2_vs_lowpoly.png"
ROWS = [
    ("MALE",   f"{C}/male_belizean_build_v2.glb",   f"{C}/male_belizean_lowpoly.glb"),
    ("FEMALE", f"{C}/female_trinidadian_build_v2.glb", f"{C}/female_trinidadian_lowpoly.glb"),
]
VIEWS = [("front", 0.0), ("3/4", 45.0), ("side", 90.0)]
COL_W, GROUP_GAP, ROW_H, LEFT = 1.05, 0.45, 2.25, 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene


def place(path, x, z, yaw_deg):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new("grp", None)
    scn.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    for o in new:
        for m in (o.data.materials if o.type == "MESH" else []):
            if m and m.use_nodes:
                b = m.node_tree.nodes.get("Principled BSDF")
                if b:
                    m.diffuse_color = tuple(b.inputs["Base Color"].default_value)
    root.location = (x, 0, z)
    root.rotation_euler = (0, 0, math.radians(yaw_deg))


def text(s, x, z, size=0.16, bold=False):
    cu = bpy.data.curves.new("t", "FONT"); cu.body = s; cu.size = size
    cu.align_x = "CENTER"; cu.align_y = "CENTER"
    try:
        cu.font = bpy.data.fonts.load("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    except Exception:
        pass
    ob = bpy.data.objects.new("t", cu); scn.collection.objects.link(ob)
    ob.location = (x, -1.0, z); ob.rotation_euler = (math.radians(90), 0, 0)
    mat = bpy.data.materials.new("txt"); mat.diffuse_color = (0.08, 0.08, 0.1, 1); cu.materials.append(mat)


def col_x(g, v):
    return LEFT + g * (3 * COL_W + GROUP_GAP) + v * COL_W + COL_W / 2


groups = ["ITER2 build_v2 (838b703)", "NEW lowpoly (this ship)"]
top = len(ROWS) * ROW_H
for r, (label, a, b) in enumerate(ROWS):
    z0 = (len(ROWS) - 1 - r) * ROW_H
    text(label, LEFT / 2, z0 + 0.95, 0.2, True)
    for g, path in enumerate((a, b)):
        for v, (vn, yaw) in enumerate(VIEWS):
            place(path, col_x(g, v), z0 + 0.12, yaw)
for g, gl in enumerate(groups):
    text(gl, (col_x(g, 0) + col_x(g, 2)) / 2, top + 0.5, 0.2, True)
    for v, (vn, _) in enumerate(VIEWS):
        text(vn, col_x(g, v), top + 0.2, 0.15)
# divider between groups
W = col_x(1, 2) + COL_W / 2 + 0.15
bpy.ops.mesh.primitive_plane_add(size=1, location=(col_x(0, 2) + COL_W / 2 + GROUP_GAP / 2, 0.8, top / 2 + 0.3))
d = bpy.context.object; d.scale = (0.012, top + 0.8, 1); d.rotation_euler = (math.radians(90), 0, 0)
dm = bpy.data.materials.new("div"); dm.diffuse_color = (0.55, 0.58, 0.62, 1); d.data.materials.append(dm)

H = top + 0.85
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam)
cam.data.type = "ORTHO"; cam.data.ortho_scale = W
cam.location = (W / 2, -12, H / 2 - 0.05); cam.rotation_euler = (math.radians(90), 0, 0)
scn.camera = cam
scn.render.resolution_x = 1600
scn.render.resolution_y = int(1600 * H / W)
scn.render.engine = "BLENDER_WORKBENCH"
sh = scn.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"
sh.show_cavity = True; sh.cavity_type = "WORLD"
sh.show_shadows = False; sh.show_backface_culling = False
scn.view_settings.view_transform = "Standard"
scn.render.film_transparent = False
w = bpy.data.worlds.new("w"); w.color = (0.94, 0.95, 0.97); scn.world = w
scn.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("COMPARE wrote", OUT, scn.render.resolution_x, scn.render.resolution_y)
