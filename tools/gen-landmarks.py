# Blender 资产工厂 · 王国地标篇(landmarks.glb)
#   任务与剧情地点的建筑:石砌塔式风车(塔身 + 观风台 + 木构帽 + 尾杆)与格栅风帆、
#   黑石要塞(墙段 / 带缺口的墙段 / 角楼 / 门楼 / 塌了一半的塔楼)、断顶哨塔遗迹、回响之镜的石拱框
#   游戏端(world.js prepParts)按面重算法线(刻面)+ 平面投影 UV(1 单位 = 1 米),再按材质名配贴图:
#     stone 浅色砌石 / dstone 深色压顶与勒脚 / bstone 黑石 / wood 木梁 / plank 木板 / door 门板 /
#     roof 木瓦 / canvas 帆布 / iron 铁件 / slit 窗洞箭孔(暗色) / moss 青苔
#   原点:建筑在底面中心;风帆(MillSails)在轮毂中心,四片帆在 YZ 平面(游戏里绕 X 轴转)
#   Blender Z 为高、X 同游戏 X、-Y 为游戏 +Z(export_yup)
# 用法: /usr/bin/python3 tools/gen-landmarks.py   (bpy 5.x)
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(11)


def mat(name, color, rough=0.9, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


M = {k: mat(k, c, r, mt) for k, c, r, mt in (
    ('stone', (0.55, 0.53, 0.5), 0.92, 0), ('dstone', (0.35, 0.34, 0.32), 0.95, 0),
    ('bstone', (0.12, 0.12, 0.13), 0.95, 0), ('wood', (0.3, 0.2, 0.12), 0.88, 0),
    ('plank', (0.42, 0.3, 0.2), 0.9, 0), ('door', (0.35, 0.24, 0.15), 0.85, 0),
    ('roof', (0.25, 0.22, 0.2), 0.85, 0), ('canvas', (0.7, 0.64, 0.52), 0.95, 0),
    ('iron', (0.15, 0.15, 0.17), 0.45, 0.8), ('slit', (0.02, 0.02, 0.025), 1.0, 0),
    ('moss', (0.2, 0.26, 0.1), 0.95, 0),
)}
parts = []


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
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return link(ob, material)


def beam(a, b, w, material):
    """两点之间的方木(截面 w×w,一面朝上)"""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.scale = (w, w, d.length)
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


def mesh_obj(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return link(ob, material)


def lathe(name, prof, material, seg=12, phase=0.0):
    """绕 Z 的旋转体:prof=[(r, z)],自下而上;r=0 的端点收成一点"""
    verts, faces, rings = [], [], []
    for (r, z) in prof:
        if r < 1e-4:
            rings.append([len(verts)])
            verts.append((0, 0, z))
            continue
        ring = []
        for i in range(seg):
            a = i / seg * math.tau + phase
            ring.append(len(verts))
            verts.append((math.cos(a) * r, math.sin(a) * r, z))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        if len(A) == 1 and len(B) == 1:
            continue
        for i in range(seg):
            if len(A) == 1:
                faces.append((A[0], B[i], B[(i + 1) % seg])[::-1])
            elif len(B) == 1:
                faces.append((A[i], A[(i + 1) % seg], B[0]))
            else:
                faces.append((A[i], A[(i + 1) % seg], B[(i + 1) % seg], B[i]))
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    return mesh_obj(name, verts, faces, material)


def ring_wall(name, r_out, r_in, top_of, material, seg=28, z0=0.0, gap=None):
    """厚壁圆筒,顶沿高低不平:top_of(a) 给出方位角 a 处的墙顶高度;gap=(a0, a1, h) 在该方位开门洞(高 h)"""
    verts, faces = [], []
    cols = []
    for i in range(seg):
        a = i / seg * math.tau
        h = top_of(a)
        c, s = math.cos(a), math.sin(a)
        base = len(verts)
        verts += [(c * r_out, s * r_out, z0), (c * r_out, s * r_out, h), (c * r_in, s * r_in, h), (c * r_in, s * r_in, z0)]
        cols.append(base)
    for i in range(seg):
        A, B = cols[i], cols[(i + 1) % seg]
        a_mid = (i + 0.5) / seg * math.tau
        if gap and gap[0] <= a_mid <= gap[1]:
            # 门洞:墙只从门楣高度起
            continue
        faces.append((A + 0, B + 0, B + 1, A + 1))   # 外壁
        faces.append((A + 1, B + 1, B + 2, A + 2))   # 墙顶
        faces.append((A + 2, B + 2, B + 3, A + 3))   # 内壁
        faces.append((A + 3, B + 3, B + 0, A + 0))   # 底
    ob = mesh_obj(name, verts, faces, material)
    if gap:
        # 门楣以上的墙 + 门洞两侧的侧壁
        a0, a1, h = gap
        i0 = int(math.ceil(a0 / math.tau * seg - 0.5))
        i1 = int(math.floor(a1 / math.tau * seg - 0.5))
        for i in range(i0, i1 + 1):
            a, b = i / seg * math.tau, (i + 1) / seg * math.tau
            ht = min(top_of(a), top_of(b))
            if ht > h + 0.3:
                am = (a + b) / 2
                rm = (r_out + r_in) / 2
                box(2 * rm * math.sin(math.pi / seg) * 1.02, r_out - r_in, ht - h,
                    (math.cos(am) * rm, math.sin(am) * rm, (h + ht) / 2), material, rot=(0, 0, am + math.pi / 2))
    return ob


def finish(name, origin=False):
    global parts
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    for poly in ob.data.polygons:
        poly.use_smooth = False
    if origin:  # 原点放到包围盒底面中心(默认不挪:各建筑本就按底面中心建模,风车轮毂等挂点要与游戏端对齐)
        zs = [v.co.z for v in ob.data.vertices]
        xs = [v.co.x for v in ob.data.vertices]
        ys = [v.co.y for v in ob.data.vertices]
        off = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
        for v in ob.data.vertices:
            v.co -= off
    ob.location = (0, 0, 0)
    parts = []
    return ob


# ======================= 风车磨坊(塔式):石塔 + 观风台 + 木构帽 + 尾杆 =======================
TH, R0, R1 = 9.6, 3.5, 2.75
lathe('MillTower', [(R0, 0.6), (R1 + (R0 - R1) * 0.4, TH * 0.6), (R1, TH)], 'stone', seg=12, phase=math.pi / 12)
lathe('MillPlinth', [(R0 + 0.32, 0), (R0 + 0.22, 0.7), (R0 - 0.05, 0.75)], 'dstone', seg=12, phase=math.pi / 12)
r6 = R0 - (R0 - R1) * (6.0 / TH) * 1.0
lathe('MillBand', [(r6 + 0.06, 5.85), (r6 + 0.14, 5.95), (r6 + 0.14, 6.1), (r6 - 0.05, 6.15)], 'dstone', seg=12, phase=math.pi / 12)
lathe('MillCornice', [(R1 - 0.05, TH - 0.05), (R1 + 0.25, TH + 0.12), (R1 + 0.25, TH + 0.35), (R1 - 0.2, TH + 0.4)], 'dstone', seg=12, phase=math.pi / 12)
# 门(朝 -Y = 游戏 +Z 南侧,迎着来路)与石门框、门楣
rd = R0 - 0.08
box(1.25, 0.25, 2.1, (0, -rd, 1.75), 'door')
for sx in (-1, 1):
    box(0.28, 0.36, 2.4, (sx * 0.76, -rd + 0.02, 1.8), 'dstone')
box(1.85, 0.4, 0.34, (0, -rd + 0.02, 3.12), 'dstone')
box(1.6, 0.9, 0.12, (0, -rd - 0.35, 0.68), 'dstone')   # 门前石阶
for k in range(4):  # 门板上的铁箍
    box(1.1, 0.04, 0.06, (0, -rd - 0.14, 1.1 + k * 0.45), 'iron')
# 小窗(暗色窗洞 + 石窗台),错落在几层
for (a, z) in ((math.pi * 0.5, 3.4), (math.pi * 1.5, 7.9), (0.0, 4.6), (math.pi, 2.8), (math.pi * 1.2, 8.2), (math.pi * 0.25, 7.6)):
    rr = R0 - (R0 - R1) * (z / TH) + 0.02
    c, s = math.cos(a), math.sin(a)
    box(0.5, 0.18, 0.75, (c * rr, s * rr, z), 'slit', rot=(0, 0, a + math.pi / 2))
    box(0.72, 0.3, 0.1, (c * (rr + 0.06), s * (rr + 0.06), z - 0.42), 'dstone', rot=(0, 0, a + math.pi / 2))
# 观风台:一圈木板平台 + 斜撑 + 栏杆
G_Z = 6.15
for i in range(16):
    a = (i + 0.5) / 16 * math.tau
    rm = r6 + 0.75
    box(2 * rm * math.sin(math.pi / 16) + 0.1, 1.3, 0.12, (math.cos(a) * rm, math.sin(a) * rm, G_Z + 0.06), 'plank', rot=(0, 0, a + math.pi / 2))
for i in range(12):
    a = i / 12 * math.tau
    c, s = math.cos(a), math.sin(a)
    beam((c * (r6 - 0.05), s * (r6 - 0.05), G_Z - 1.1), (c * (r6 + 1.25), s * (r6 + 1.25), G_Z), 0.11, 'wood')
    rod((c * (r6 + 1.3), s * (r6 + 1.3), G_Z), (c * (r6 + 1.3), s * (r6 + 1.3), G_Z + 1.0), 0.05, 'wood', 5)
for i in range(12):
    a, b = i / 12 * math.tau, (i + 1) / 12 * math.tau
    rr = r6 + 1.3
    rod((math.cos(a) * rr, math.sin(a) * rr, G_Z + 0.98), (math.cos(b) * rr, math.sin(b) * rr, G_Z + 0.98), 0.04, 'wood', 5)
    rod((math.cos(a) * rr, math.sin(a) * rr, G_Z + 0.5), (math.cos(b) * rr, math.sin(b) * rr, G_Z + 0.5), 0.03, 'wood', 4)
# 木构帽:帽圈 + 木瓦葱头顶 + 宝珠
CZ = TH + 0.4
lathe('MillCapRing', [(R1 + 0.2, CZ), (R1 + 0.3, CZ + 0.1), (R1 + 0.3, CZ + 0.42), (R1 + 0.1, CZ + 0.45)], 'wood', seg=12)
lathe('MillCap', [(R1 + 0.32, CZ + 0.4), (R1 + 0.5, CZ + 0.55), (R1 + 0.3, CZ + 1.4), (R1 - 0.5, CZ + 2.3),
                  (1.2, CZ + 2.95), (0.5, CZ + 3.3), (0.0, CZ + 3.45)], 'roof', seg=12)
rod((0, 0, CZ + 3.4), (0, 0, CZ + 4.1), 0.05, 'iron', 6)
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.16, location=(0, 0, CZ + 3.75))
link(bpy.context.active_object, 'iron')
# 风轴箱(朝 -X 伸出)与轮毂
HUB = (-R1 - 0.85, 0, CZ + 1.0)
box(1.6, 1.0, 1.0, (-R1 - 0.1, 0, CZ + 1.0), 'plank')
box(1.7, 1.15, 0.14, (-R1 - 0.1, 0, CZ + 1.55), 'wood')
cyl(0.32, 0.5, (HUB[0] + 0.35, 0, HUB[2]), 'iron', 10, rot=(0, math.pi / 2, 0))
# 尾杆(帽后斜拖到地,转帽对风用)+ 两根斜撑 + 地上的绞盘轮
beam((R1 + 0.3, 0, CZ + 0.7), (R1 + 4.6, 0, 0.7), 0.24, 'wood')
for sy in (-1, 1):
    beam((R1 + 0.2, sy * 1.0, CZ + 0.3), (R1 + 2.6, 0, CZ * 0.42), 0.13, 'wood')
cyl(0.65, 0.14, (R1 + 4.75, 0, 0.72), 'wood', 12, rot=(math.pi / 2, 0, 0))
for k in range(4):
    a = k / 4 * math.pi
    beam((R1 + 4.75 + math.cos(a) * 0.6, 0, 0.72 + math.sin(a) * 0.6), (R1 + 4.75 - math.cos(a) * 0.6, 0, 0.72 - math.sin(a) * 0.6), 0.06, 'wood')
# 墙脚几袋面粉与一只木桶
for (x, y, s) in ((1.6, -3.6, 0.42), (2.2, -3.25, 0.36), (1.95, -3.75, 0.3)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=s, location=(x, y, s * 0.75))
    o = bpy.context.active_object
    o.scale = (1, 0.8, 0.85)
    link(o, 'canvas')
finish('Windmill')
print('Windmill hub(Blender) =', HUB)

# ---- 风帆:四片格栅帆,帆面绷着帆布(其中一片收了一半),轮毂在原点,帆在 YZ 平面 ----
for k in range(4):
    th = k * math.pi / 2 + math.pi / 4
    d = Vector((0, math.cos(th), math.sin(th)))
    p = Vector((0, -math.sin(th), math.cos(th)))   # 帆面在主杆的一侧(顺转向的后缘)
    beam(-d * 0.5, d * 6.7, 0.17, 'wood')           # 主杆
    beam(d * 1.25 + p * 1.45, d * 6.5 + p * 1.45, 0.07, 'wood')  # 外侧边杆
    beam(d * 1.25 + p * 0.1, d * 6.5 + p * 0.1, 0.06, 'wood')
    n = 10
    for j in range(n + 1):
        r = 1.25 + (6.5 - 1.25) * j / n
        beam(d * r + p * 0.0 + Vector((0.05, 0, 0)), d * r + p * 1.5 + Vector((0.05, 0, 0)), 0.05, 'wood')
    r_end = 6.3 if k != 2 else 3.6  # 一片帆布收起一半
    v = [tuple(Vector((-0.04, 0, 0)) + d * 1.35 + p * 0.15), tuple(Vector((-0.04, 0, 0)) + d * r_end + p * 0.15),
         tuple(Vector((-0.04, 0, 0)) + d * r_end + p * 1.4), tuple(Vector((-0.04, 0, 0)) + d * 1.35 + p * 1.4)]
    mesh_obj('Sail', v, [(0, 1, 2, 3)], 'canvas')
    if k == 2:  # 收起的帆布卷在边杆上
        rod(d * 3.7 + p * 1.4 + Vector((-0.08, 0, 0)), d * 6.3 + p * 1.4 + Vector((-0.08, 0, 0)), 0.12, 'canvas', 6)
cyl(0.42, 0.45, (0, 0, 0), 'iron', 10, rot=(0, math.pi / 2, 0))
for k in range(4):
    th = k * math.pi / 2
    beam((-0.05, 0, 0), (-0.05, math.cos(th) * 1.4, math.sin(th) * 1.4), 0.1, 'wood')  # 轮毂上的十字压条
finish('MillSails', origin=False)

# ======================= 黑石要塞:墙段 / 缺口墙段 / 角楼 / 门楼 / 塌塔 =======================
WL, WT, WH = 10.8, 1.7, 4.6   # 墙段长(八边形边长)、厚、高


def merlons(x0, x1, y, z, step=1.5, w=0.9, broken=()):
    n = int((x1 - x0) / step)
    for i in range(n + 1):
        if i in broken:
            continue
        x = x0 + (x1 - x0) * i / n
        box(w, 0.5, 0.85, (x, y, z + 0.42), 'bstone')


def fort_wall(name):
    # 墙身 + 外凸勒脚(底部收分) + 外侧垛口 + 内侧走道护栏 + 压顶条 + 两根扶壁 + 一排箭孔
    box(WL, WT, WH, (0, 0, WH / 2), 'bstone')
    box(WL + 0.02, WT + 0.7, 0.9, (0, 0, 0.45), 'dstone')
    box(WL + 0.02, WT + 0.25, 0.22, (0, 0, WH - 0.1), 'dstone')
    merlons(-WL / 2 + 0.5, WL / 2 - 0.5, -WT / 2 + 0.25, WH)
    box(WL, 0.25, 0.55, (0, WT / 2 - 0.12, WH + 0.27), 'bstone')
    for sx in (-1, 1):
        box(0.9, 0.7, WH - 0.6, (sx * WL * 0.22, -WT / 2 - 0.3, (WH - 0.6) / 2), 'bstone')
    for sx in (-0.38, 0.0, 0.38):
        box(0.16, 0.1, 0.9, (sx * WL, -WT / 2 - 0.02, WH * 0.6), 'slit')
    box(2.2, 0.06, 0.5, (-WL * 0.3, -WT / 2 - 0.36, 0.95), 'moss')
    finish(name)


def fort_wall_breach(name):
    # 塌掉的墙段:两头各剩一截参差的残墙,中间只剩墙基和一地落石(人能翻过去)
    rnd2 = random.Random(41)
    for sx in (-1, 1):
        x0 = sx * WL / 2
        for k in range(5):
            w = 0.62
            x = x0 - sx * (0.31 + k * 0.6)
            h = max(0.9, WH * (1.0 - k * 0.2) + rnd2.uniform(-0.5, 0.3))
            box(w, WT, h, (x, 0, h / 2), 'bstone')
        box(3.2, WT + 0.7, 0.9, (x0 - sx * 1.6, 0, 0.45), 'dstone')
    box(WL - 6.0, WT + 0.4, 0.35, (0, 0, 0.17), 'dstone')
    for k in range(12):
        rock(0.28 + rnd2.random() * 0.3, (rnd2.uniform(-2.6, 2.6), rnd2.uniform(-1.8, 1.8), 0.12), 'bstone', seed=60 + k, squash=0.55)
    box(1.4, 0.06, 0.6, (-WL * 0.4, -WT / 2 - 0.02, 1.1), 'moss')
    finish(name)


fort_wall('FortWall')
fort_wall_breach('FortWallB')

# 角楼:方塔(收分勒脚 + 箭孔 + 外挑垛口 + 黑木瓦四坡顶)
S, H = 4.4, 7.6
box(S, S, H, (0, 0, H / 2), 'bstone')
box(S + 0.6, S + 0.6, 1.0, (0, 0, 0.5), 'dstone')
box(S + 0.5, S + 0.5, 0.35, (0, 0, H + 0.1), 'dstone')
for k in range(4):
    a = k * math.pi / 2
    c, s = math.cos(a), math.sin(a)
    for t in (-1, 0, 1):
        box(0.85, 0.5, 0.8, (c * (S / 2 + 0.05) - s * t * 1.5, s * (S / 2 + 0.05) + c * t * 1.5, H + 0.68), 'bstone', rot=(0, 0, a + math.pi / 2))
    for z in (2.6, 5.2):
        box(0.16, 0.12, 0.85, (c * (S / 2 + 0.01), s * (S / 2 + 0.01), z), 'slit', rot=(0, 0, a + math.pi / 2))
lathe('TowerRoof', [(S * 0.62, H + 1.05), (S * 0.66, H + 1.15), (0.25, H + 4.2), (0.0, H + 4.3)], 'roof', seg=4, phase=math.pi / 4)
rod((0, 0, H + 4.2), (0, 0, H + 5.6), 0.05, 'wood', 5)
mesh_obj('Pennant', [(0, 0, H + 5.55), (0, 0, H + 5.0), (1.1, 0.05, H + 5.3)], [(0, 1, 2)], 'slit')
finish('FortTower')

# 门楼:两座方墩夹着拱门,门洞上一道垛口墙、吊起的铁闸、向内敞开的两扇包铁木门
GW, GD, GH = 3.4, 2.4, 4.0   # 门洞宽、门楼进深、拱脚高
PW = (WL - GW) / 2           # 两侧墩宽
for sx in (-1, 1):
    x = sx * (GW / 2 + PW / 2)
    box(PW, GD, 6.8, (x, 0, 3.4), 'bstone')
    box(PW + 0.4, GD + 0.5, 0.9, (x, 0, 0.45), 'dstone')
    box(PW + 0.3, GD + 0.3, 0.3, (x, 0, 6.85), 'dstone')
    for t in (-1, 1):
        box(0.85, 0.5, 0.8, (x + t * 1.05, -GD / 2 - 0.05, 7.4), 'bstone')
        box(0.85, 0.5, 0.8, (x + t * 1.05, GD / 2 + 0.05, 7.4), 'bstone')
    box(0.16, 0.1, 0.9, (x, -GD / 2 - 0.02, 4.4), 'slit')
# 拱:半圆拱石一圈 + 拱上墙
n = 9
for k in range(n):
    a0, a1 = k / n * math.pi, (k + 1) / n * math.pi
    am = (a0 + a1) / 2
    r = GW / 2 + 0.25
    box(0.55, GD + 0.06, 2 * r * math.sin(math.pi / n / 2) + 0.06,
        (math.cos(am) * r, 0, GH + math.sin(am) * r), 'dstone', rot=(0, math.pi / 2 - am, 0))
box(GW + 0.2, GD, 6.8 - GH - GW / 2 - 0.2, (0, 0, (6.8 + GH + GW / 2 + 0.2) / 2), 'bstone')
for sx in (-1, 1):  # 拱肩填墙
    box(0.6, GD, GW / 2 + 0.2, (sx * (GW / 2 - 0.05), 0, GH + (GW / 2 + 0.2) / 2 + 0.05), 'bstone')
for t in (-1, 0, 1):
    box(0.85, 0.5, 0.8, (t * 1.15, -GD / 2 - 0.05, 7.2), 'bstone')
# 吊起的铁闸(只露下沿)
for k in range(5):
    x = -GW / 2 + 0.35 + k * (GW - 0.7) / 4
    box(0.08, 0.08, 1.2, (x, -GD / 2 + 0.35, GH + 0.6), 'iron')
box(GW - 0.3, 0.08, 0.08, (0, -GD / 2 + 0.35, GH + 0.1), 'iron')
# 两扇门向内敞开
for sx in (-1, 1):
    hx = sx * (GW / 2 - 0.05)
    box(0.14, GW / 2 - 0.1, GH - 0.1, (hx - sx * 0.1, GD / 2 + GW / 4, (GH - 0.1) / 2), 'door')
    for z in (0.7, GH - 0.8):
        box(0.17, GW / 2 - 0.2, 0.12, (hx - sx * 0.1, GD / 2 + GW / 4, z), 'iron')
# 门楼两侧的火把座
for sx in (-1, 1):
    rod((sx * (GW / 2 + 0.45), -GD / 2 - 0.05, 2.6), (sx * (GW / 2 + 0.45), -GD / 2 - 0.45, 3.0), 0.04, 'iron', 4)
finish('FortGate')

# 塌了一半的圆塔:厚墙圆筒,一侧塌到只剩半人高,塌口落石成堆
rnd = random.Random(5)


def ruin_top(a):
    return max(1.4, 5.0 + 3.6 * math.cos(a - 0.6) + 0.9 * math.sin(a * 3.0 + 1.0) + rnd.uniform(-0.35, 0.35))


ring_wall('FortRuinWall', 2.9, 2.1, ruin_top, 'bstone', seg=24)
lathe('FortRuinBase', [(3.35, 0), (3.2, 0.8), (2.9, 0.9)], 'dstone', seg=24)
for k in range(10):
    a = -2.5 + rnd.uniform(-0.8, 0.8)
    r = 3.2 + rnd.uniform(0, 2.4)
    rock(0.3 + rnd.random() * 0.4, (math.cos(a) * r, math.sin(a) * r, 0.18), 'bstone', seed=80 + k)
for z in (2.4, 4.6):
    a = 0.6
    box(0.18, 0.12, 0.85, (math.cos(a) * 2.92, math.sin(a) * 2.92, z), 'slit', rot=(0, 0, a + math.pi / 2))
box(1.6, 0.06, 0.8, (2.9 * math.cos(-0.9), 2.9 * math.sin(-0.9), 1.0), 'moss', rot=(0, 0, -0.9 + math.pi / 2))
finish('FortRuin')

# ======================= 哨塔遗迹:断顶的圆石塔(拱门、窗洞、残存的楼板梁),周围散落塌下来的石块 =======================
rnd = random.Random(9)


def watch_top(a):
    return max(3.2, 7.0 + 2.4 * math.cos(a + 2.2) + 1.1 * math.sin(a * 4 + 0.4) + rnd.uniform(-0.5, 0.5))


ring_wall('WatchWall', 3.5, 2.75, watch_top, 'stone', seg=28, gap=(math.pi * 1.5 - 0.3, math.pi * 1.5 + 0.3, 2.7))
lathe('WatchBase', [(3.95, 0), (3.85, 0.7), (3.5, 0.8)], 'dstone', seg=28)
# 门洞拱石(朝 -Y = 游戏 +Z)
for k in range(7):
    a0 = k / 7 * math.pi
    am = a0 + math.pi / 14
    r = 0.95
    box(0.42, 0.85, 0.38, (math.cos(am) * r, -3.13, 1.75 + math.sin(am) * r), 'dstone', rot=(0, math.pi / 2 - am, 0))
# 一圈勒脚石带 + 两层残存窗洞
lathe('WatchBand', [(3.56, 3.6), (3.62, 3.75), (3.56, 3.9)], 'dstone', seg=28)
for (a, z) in ((0.3, 4.6), (2.0, 5.4), (3.6, 4.4), (5.2, 2.6)):
    box(0.45, 0.2, 0.9, (math.cos(a) * 3.5, math.sin(a) * 3.5, z), 'slit', rot=(0, 0, a + math.pi / 2))
# 残存的楼板梁(斜插在塔里)
beam((-2.6, 0.8, 4.2), (2.5, -0.3, 4.9), 0.22, 'wood')
beam((-2.4, -1.0, 4.3), (1.4, 1.9, 3.1), 0.2, 'wood')
# 塌下来的方石与碎块
for k in range(14):
    a = rnd.uniform(0, math.tau)
    r = 4.2 + rnd.uniform(0, 3.4)
    s = 0.35 + rnd.random() * 0.35
    if k % 2:
        box(s * 1.6, s, s * 0.9, (math.cos(a) * r, math.sin(a) * r, s * 0.4), 'stone', rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.2), rnd.uniform(0, 3)))
    else:
        rock(s, (math.cos(a) * r, math.sin(a) * r, s * 0.3), 'stone', seed=100 + k)
for (a, w) in ((0.9, 1.8), (3.0, 1.4), (4.4, 2.0)):
    box(w, 0.06, 1.2, (math.cos(a) * 3.52, math.sin(a) * 3.52, 1.2), 'moss', rot=(0, 0, a + math.pi / 2))
finish('WatchRuin')

# ======================= 回响之镜:两级石台 + 两根方柱 + 半圆拱(镜面由游戏端补) =======================
box(3.6, 1.6, 0.3, (0, 0, 0.15), 'dstone')
box(3.0, 1.1, 0.3, (0, 0, 0.45), 'stone')
for sx in (-1, 1):
    box(0.55, 0.55, 2.3, (sx * 1.25, 0, 1.75), 'stone')
    box(0.7, 0.7, 0.22, (sx * 1.25, 0, 0.71), 'dstone')
    box(0.68, 0.68, 0.2, (sx * 1.25, 0, 2.95), 'dstone')
n = 11
for k in range(n):
    a0, a1 = k / n * math.pi, (k + 1) / n * math.pi
    am = (a0 + a1) / 2
    r = 1.25
    box(0.55, 0.55, 2 * r * math.sin(math.pi / n / 2) + 0.05, (math.cos(am) * r, 0, 3.05 + math.sin(am) * r), 'stone', rot=(0, math.pi / 2 - am, 0))
box(0.5, 0.62, 0.42, (0, 0, 3.05 + 1.25 + 0.05), 'dstone')  # 拱心石
box(1.0, 0.06, 0.6, (-1.25, -0.29, 1.0), 'moss')
finish('MirrorArch')

# ---------------- 导出 ----------------
names = sorted(o.name for o in bpy.data.objects)
print('objects:', names)
path = os.path.join(OUT, 'landmarks.glb')
# 只导出位置:游戏端按面重算法线、按平面投影生成 UV(顶点按位置共享,文件小一半多)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False,
                          export_normals=False)
print(f'landmarks.glb → {os.path.getsize(path) // 1024}KB')
for o in bpy.data.objects:
    print(o.name, len(o.data.polygons), 'faces')
print('DONE')
