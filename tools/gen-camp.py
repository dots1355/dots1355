# Blender 资产工厂 · 营地与路边篇(camp.glb)
#   荒野兴趣点与道路两旁的"生活痕迹":帐篷 / 篝火 / 木推车 / 石井 / 篱笆段 / 路灯柱 /
#   路牌 / 残垣 / 木箱堆 / 草垛 / 旗杆 / 断塔 / 路边神龛
#   每个对象原点在底面中心(Blender Z-up,导出 Y-up);同名材质全局复用,游戏端按名字认:
#   canvas canvasdark wood woodlight rope stone moss iron ember hay cloth glass straw
# 用法: /usr/bin/python3 tools/gen-camp.py   (bpy 5.x 需 Python 3.13)
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)


def mat(name, color, rough=0.9, metal=0.0, emit=None, double=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 2.0
    if double:
        m.use_backface_culling = False
    return m


M = {
    'canvas': mat('canvas', (0.4, 0.34, 0.24), 0.95, double=True),
    'canvasdark': mat('canvasdark', (0.06, 0.06, 0.07), 0.95, double=True),
    'wood': mat('wood', (0.33, 0.22, 0.13), 0.9),
    'woodlight': mat('woodlight', (0.34, 0.23, 0.13), 0.88),
    'rope': mat('rope', (0.6, 0.52, 0.36), 1.0),
    'stone': mat('stone', (0.2, 0.19, 0.17), 0.95),
    'moss': mat('moss', (0.22, 0.3, 0.12), 0.95),
    'iron': mat('iron', (0.18, 0.18, 0.2), 0.45, 0.8),
    'ember': mat('ember', (1.0, 0.45, 0.12), 0.6, emit=(1.0, 0.38, 0.08)),
    'hay': mat('hay', (0.52, 0.4, 0.15), 1.0),
    'cloth': mat('cloth', (0.55, 0.1, 0.1), 0.9, double=True),
    'glass': mat('glass', (1.0, 0.82, 0.45), 0.3, emit=(1.0, 0.7, 0.3)),
    'straw': mat('straw', (0.42, 0.32, 0.14), 1.0),
}

parts = []  # 当前对象的零件,finish() 时合并


def link(ob, material):
    ob.data.materials.clear()
    ob.data.materials.append(M[material])
    parts.append(ob)
    return ob


def box(sx, sy, sz, loc, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = (sx, sy, sz)
    return link(ob, material)


def cyl(r, h, loc, material, verts=8, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    return link(bpy.context.active_object, material)


def rod(a, b, r, material, verts=6):
    """两点之间的圆杆"""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return link(ob, material)


def rock(r, loc, material='stone', seed=0, squash=0.7):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=loc)
    ob = bpy.context.active_object
    rnd = random.Random(seed)
    for v in ob.data.vertices:
        v.co *= 0.8 + rnd.random() * 0.35
    ob.scale = (1, 0.85 + rnd.random() * 0.3, squash)
    return link(ob, material)


def finish(name, smooth=False):
    global parts
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    for poly in ob.data.polygons:
        poly.use_smooth = smooth
    # 原点放到底面中心
    zs = [v.co.z for v in ob.data.vertices]
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    off = Vector(((min(xs) + max(xs)) / 2 - ob.location.x, (min(ys) + max(ys)) / 2 - ob.location.y, min(zs) - ob.location.z))
    # 以 location 为参考把网格平移,使底面中心落在原点
    for v in ob.data.vertices:
        v.co -= off
    ob.location = (0, 0, 0)
    parts = []
    return ob


X = 0  # 各对象在 Blender 场景里排开摆放,导出后游戏按名字取用


# ---------------- 帐篷:A 字形帆布 + 门帘 + 撑杆 + 拉绳 ----------------
def tent(name, cloth):
    L, W, H = 3.2, 2.6, 2.1
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in [(-L / 2, -W / 2, 0), (L / 2, -W / 2, 0), (L / 2, 0, H), (-L / 2, 0, H),
                                     (-L / 2, W / 2, 0), (L / 2, W / 2, 0)]]
    bm.faces.new((vs[0], vs[1], vs[2], vs[3]))
    bm.faces.new((vs[3], vs[2], vs[5], vs[4]))
    # 后山墙封死,前山墙留门(两片半开的门帘)
    bm.faces.new((vs[1], vs[5], vs[2]))
    me = bpy.data.meshes.new(name + 'Cloth')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name + 'Cloth', me)
    bpy.context.collection.objects.link(ob)
    link(ob, cloth)
    # 门帘:前山墙两片三角,向外翻开
    for s in (-1, 1):
        bm = bmesh.new()
        a = bm.verts.new((-L / 2, 0, H))
        b = bm.verts.new((-L / 2, s * W / 2, 0))
        c = bm.verts.new((-L / 2 - 0.55, s * W * 0.18, 0))
        bm.faces.new((a, b, c))
        me = bpy.data.meshes.new(name + 'Flap')
        bm.to_mesh(me)
        bm.free()
        fo = bpy.data.objects.new(name + 'Flap', me)
        bpy.context.collection.objects.link(fo)
        link(fo, cloth)
    # 撑杆与脊梁
    rod((-L / 2 - 0.05, 0, 0), (-L / 2 - 0.05, 0, H + 0.25), 0.05, 'wood')
    rod((L / 2 + 0.05, 0, 0), (L / 2 + 0.05, 0, H + 0.25), 0.05, 'wood')
    rod((-L / 2 - 0.05, 0, H + 0.05), (L / 2 + 0.05, 0, H + 0.05), 0.035, 'wood')
    # 拉绳 + 地钉
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = (sx * L * 0.35, sy * W * 0.36, H * 0.55)
            b = (sx * L * 0.42, sy * (W / 2 + 0.9), 0.02)
            rod(a, b, 0.012, 'rope', 4)
            cyl(0.03, 0.25, (b[0], b[1], 0.08), 'wood', 4)
    # 帐内铺草
    box(L * 0.8, W * 0.7, 0.06, (0.1, 0, 0.03), 'straw')
    return finish(name)


tent('Tent', 'canvas')
tent('TentDark', 'canvasdark')


# ---------------- 篝火:石圈 + 交叉柴堆 + 炭火芯 ----------------
for i in range(9):
    a = i / 9 * math.tau
    rock(0.24, (math.cos(a) * 0.75, math.sin(a) * 0.75, 0.12), 'stone', seed=i, squash=0.75)
for i in range(5):
    a = i / 5 * math.tau + 0.3
    rod((math.cos(a) * 0.55, math.sin(a) * 0.55, 0.06), (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.42), 0.055, 'wood', 6)
cyl(0.32, 0.12, (0, 0, 0.06), 'ember', 8)
finish('Campfire')

# ---------------- 木推车:车厢 + 双轮 + 车辕 + 一车草 ----------------
box(2.4, 1.3, 0.1, (0, 0, 0.75), 'woodlight')
for sy in (-1, 1):
    box(2.4, 0.07, 0.45, (0, sy * 0.62, 1.0), 'wood')
for sx in (-1, 1):
    box(0.07, 1.3, 0.45, (sx * 1.18, 0, 1.0), 'wood')
for sy in (-1, 1):
    w = cyl(0.55, 0.1, (0.15, sy * 0.78, 0.55), 'wood', 14, rot=(math.pi / 2, 0, 0))
    cyl(0.12, 0.16, (0.15, sy * 0.78, 0.55), 'iron', 8, rot=(math.pi / 2, 0, 0))
    for k in range(6):  # 辐条
        a = k / 6 * math.pi
        rod((0.15 + math.cos(a) * 0.5, sy * 0.78, 0.55 + math.sin(a) * 0.5),
            (0.15 - math.cos(a) * 0.5, sy * 0.78, 0.55 - math.sin(a) * 0.5), 0.03, 'wood', 4)
rod((0.15, -0.85, 0.55), (0.15, 0.85, 0.55), 0.05, 'iron', 6)  # 车轴
for sy in (-1, 1):
    rod((-1.2, sy * 0.35, 0.78), (-2.7, sy * 0.25, 0.5), 0.05, 'wood', 6)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1, location=(0.1, 0, 1.15))
hay = bpy.context.active_object
hay.scale = (1.05, 0.55, 0.4)
link(hay, 'hay')
finish('Cart')

# ---------------- 石井:圆井台 + 木架顶 + 摇把 + 吊桶 ----------------
for i in range(14):  # 一圈石块砌的井台
    a = i / 14 * math.tau
    for layer in range(3):
        aa = a + (layer % 2) * (math.tau / 28)
        box(0.42, 0.3, 0.26, (math.cos(aa) * 0.95, math.sin(aa) * 0.95, 0.14 + layer * 0.27), 'stone', rot=(0, 0, aa))
cyl(0.85, 0.05, (0, 0, 0.55), 'iron', 16)  # 井里的黑水面
for sx in (-1, 1):
    rod((sx * 1.0, 0, 0.3), (sx * 1.0, 0, 2.3), 0.07, 'wood', 6)
rod((-1.15, 0, 1.75), (1.15, 0, 1.75), 0.06, 'wood', 8)  # 辘轳轴
rod((1.15, 0, 1.75), (1.15, 0.35, 1.55), 0.03, 'iron', 4)  # 摇把
box(2.5, 0.75, 0.06, (0, -0.32, 2.5), 'wood', rot=(0.55, 0, 0))  # 小坡顶(两片)
box(2.5, 0.75, 0.06, (0, 0.32, 2.5), 'wood', rot=(-0.55, 0, 0))
rod((0.3, 0, 1.75), (0.3, 0, 1.05), 0.01, 'rope', 4)
cyl(0.16, 0.26, (0.3, 0, 0.92), 'wood', 8, r2=0.2)
finish('Well')

# ---------------- 篱笆段(4m):两根桩 + 两道横栏 ----------------
for sx in (-1, 1):
    cyl(0.07, 1.25, (sx * 2.0, 0, 0.62), 'wood', 6)
    cyl(0.075, 0.1, (sx * 2.0, 0, 1.27), 'wood', 6, r2=0.0)
for z in (0.45, 0.95):
    rod((-2.05, 0, z), (2.05, 0, z + random.uniform(-0.04, 0.04)), 0.045, 'woodlight', 5)
finish('Fence')

# ---------------- 路灯柱:木柱 + 横臂 + 吊灯(玻璃自发光) ----------------
cyl(0.1, 3.2, (0, 0, 1.6), 'wood', 6)
box(0.32, 0.32, 0.3, (0, 0, 0.15), 'stone')
rod((0, 0, 2.95), (0.75, 0, 2.95), 0.045, 'wood', 5)
rod((0, 0, 2.6), (0.5, 0, 2.95), 0.03, 'wood', 4)
rod((0.7, 0, 2.95), (0.7, 0, 2.7), 0.01, 'iron', 4)
box(0.24, 0.24, 0.3, (0.7, 0, 2.52), 'glass')
cyl(0.17, 0.12, (0.7, 0, 2.72), 'iron', 4, r2=0.02, rot=(0, 0, math.pi / 4))
box(0.26, 0.26, 0.04, (0.7, 0, 2.36), 'iron')
finish('LanternPost')

# ---------------- 路牌:立柱 + 两块指向牌 ----------------
cyl(0.08, 2.4, (0, 0, 1.2), 'wood', 6)
for k, (z, yaw) in enumerate(((2.05, 0.3), (1.65, -1.9))):
    c, s = math.cos(yaw), math.sin(yaw)
    box(0.95, 0.06, 0.24, (c * 0.42, s * 0.42, z), 'woodlight', rot=(0, 0, yaw))
    # 箭头尖
    bm = bmesh.new()
    tip = [bm.verts.new((c * 0.9 - s * 0.0 + dx, s * 0.9 + dy, z + dz)) for dx, dy, dz in
           ((0, 0, 0.12), (0, 0, -0.12), (c * 0.2, s * 0.2, 0))]
    bm.faces.new(tip)
    me = bpy.data.meshes.new('SignTip')
    bm.to_mesh(me)
    bm.free()
    to = bpy.data.objects.new('SignTip', me)
    bpy.context.collection.objects.link(to)
    link(to, 'woodlight')
finish('Signpost')

# ---------------- 残垣:半截石墙 + 断拱 + 落石 ----------------
rnd = random.Random(3)
for i in range(7):
    h = 2.6 - abs(i - 2) * 0.45 + rnd.uniform(-0.3, 0.2)
    if h < 0.4:
        h = 0.4
    for j in range(int(h / 0.45)):
        box(0.72, 0.6, 0.42, (i * 0.74 - 2.2 + rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 0.22 + j * 0.44),
            'stone', rot=(0, 0, rnd.uniform(-0.05, 0.05)))
# 断拱:半个弧
for k in range(6):
    a = k / 10 * math.pi
    box(0.42, 0.55, 0.3, (-2.2 - 0.9 + math.cos(a) * 0.9, 0, 2.3 + math.sin(a) * 0.9), 'stone', rot=(0, -a + math.pi / 2, 0))
for k in range(6):
    rock(0.28 + rnd.random() * 0.2, (rnd.uniform(-2.5, 2.5), rnd.uniform(0.6, 1.6), 0.12), 'stone', seed=20 + k)
box(1.6, 0.5, 0.06, (-0.6, 0, 2.2), 'moss')
finish('Ruin')

# ---------------- 木箱堆 ----------------
for (x, y, z, s, r) in ((0, 0, 0.4, 0.8, 0.1), (0.85, 0.1, 0.35, 0.7, -0.2), (0.35, 0.05, 1.15, 0.7, 0.35)):
    box(s, s, s, (x, y, z), 'woodlight', rot=(0, 0, r))
    for dz in (-s * 0.42, s * 0.42):
        box(s * 1.02, s * 1.02, 0.06, (x, y, z + dz), 'wood', rot=(0, 0, r))
finish('Crates')

# ---------------- 草垛:圆顶草堆 + 一圈散草 ----------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=1.4, location=(0, 0, 0.7))
h = bpy.context.active_object
h.scale = (1, 1, 1.05)
for v in h.data.vertices:
    if v.co.z < -0.5:
        v.co.z = -0.5
    v.co.x *= 1 + random.uniform(-0.05, 0.05)
link(h, 'hay')
cyl(1.6, 0.12, (0, 0, 0.06), 'straw', 14)
rod((0, 0, 1.6), (0.15, 0.1, 2.3), 0.04, 'wood', 5)
finish('Haystack', smooth=True)

# ---------------- 旗杆:木杆 + 横档 + 垂旗 ----------------
cyl(0.07, 4.4, (0, 0, 2.2), 'wood', 6)
rod((0, -0.75, 4.1), (0, 0.75, 4.1), 0.035, 'wood', 5)
bm = bmesh.new()
cols, rows = 4, 6
grid = []
for r in range(rows + 1):
    row = []
    for c in range(cols + 1):
        y = -0.7 + c / cols * 1.4
        z = 4.05 - r / rows * 2.2
        x = 0.06 * math.sin(c * 1.3 + r * 0.9) + (0.25 if r == rows and c in (0, cols) else 0)
        row.append(bm.verts.new((x, y, z - (0.25 if r == rows and c == cols // 2 else 0))))
    grid.append(row)
for r in range(rows):
    for c in range(cols):
        bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
me = bpy.data.meshes.new('BannerCloth')
bm.to_mesh(me)
bm.free()
bo = bpy.data.objects.new('BannerCloth', me)
bpy.context.collection.objects.link(bo)
link(bo, 'cloth')
finish('Banner')

# ---------------- 断塔:石砌圆塔,上半截塌了,门洞 + 散落石块 ----------------
rnd = random.Random(11)
R = 2.2
for layer in range(14):
    n = 16
    for i in range(n):
        a = i / n * math.tau + (layer % 2) * (math.pi / n)
        top = 5.6 + 2.2 * math.sin(a * 1.0 + 0.6) + rnd.uniform(-0.4, 0.3)  # 塌口高低不平
        z = 0.25 + layer * 0.5
        if z > top:
            continue
        if layer < 4 and abs(math.atan2(math.sin(a), math.cos(a)) - 0) < 0.3:  # 门洞
            continue
        box(0.9, 0.55, 0.48, (math.cos(a) * R, math.sin(a) * R, z), 'stone', rot=(0, 0, a + math.pi / 2))
for k in range(9):
    rock(0.3 + rnd.random() * 0.3, (rnd.uniform(-4, 4), rnd.uniform(-4, 4), 0.15), 'stone', seed=40 + k)
box(1.9, 0.7, 0.08, (0, -R, 3.2), 'moss', rot=(1.2, 0, 0))
finish('BrokenTower')

# ---------------- 路边神龛:石基 + 小坡顶 + 供台蜡烛 ----------------
box(1.0, 0.7, 0.5, (0, 0, 0.25), 'stone')
box(0.8, 0.5, 0.9, (0, 0.05, 0.95), 'stone')
box(0.5, 0.06, 0.6, (0, -0.21, 0.98), 'iron')  # 龛洞(深色)
for s in (-1, 1):
    box(1.0, 0.75, 0.06, (s * 0.3, 0.05, 1.55), 'wood', rot=(0, s * 0.6, 0))
cyl(0.04, 0.16, (0.18, -0.3, 0.58), 'glass', 6)
cyl(0.04, 0.12, (-0.18, -0.3, 0.56), 'glass', 6)
finish('Shrine')

# ---------------- 导出 ----------------
names = sorted(o.name for o in bpy.data.objects)
print('objects:', names)
path = os.path.join(OUT, 'camp.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False)
print(f'camp.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
