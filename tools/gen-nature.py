# Blender 资产工厂 · 群系地标篇(nature.glb)
#   让每个群系一眼可辨:平原/林地有苔顶花岗岩露头,荒漠有红砂岩台地与巨兽骸骨,
#   灰烬荒原有玄武岩柱群,雪原有冰岩,沼泽有垂柳与扭曲枯木,林间有倒木与树桩、灌木丛。
#   每个对象原点在底面中心(Blender Z-up,导出 Y-up),材质名供游戏按群系换色:
#   rock moss snow sandstone sandband basalt ice bark wood leaf leafdark bone willow
# 用法: /usr/bin/python3 tools/gen-nature.py   (bpy 5.x 需 Python 3.13)
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, noise

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.9, metal=0.0, double=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if double:
        m.use_backface_culling = False
    return m


M = {
    'rock': mat('rock', (0.25, 0.24, 0.22), 0.95),
    'moss': mat('moss', (0.2, 0.26, 0.1), 0.95),
    'snow': mat('snow', (0.86, 0.9, 0.95), 0.8),
    'sandstone': mat('sandstone', (0.5, 0.23, 0.1), 0.95),
    'sandband': mat('sandband', (0.78, 0.5, 0.28), 0.95),
    'basalt': mat('basalt', (0.12, 0.11, 0.11), 0.9),
    'ice': mat('ice', (0.6, 0.78, 0.9), 0.3),
    'bark': mat('bark', (0.16, 0.12, 0.09), 0.95),
    'wood': mat('wood', (0.55, 0.42, 0.28), 0.9),
    'leaf': mat('leaf', (0.18, 0.3, 0.11), 0.9),
    'leafdark': mat('leafdark', (0.11, 0.2, 0.08), 0.9),
    'leaflight': mat('leaflight', (0.3, 0.4, 0.13), 0.9),
    'bone': mat('bone', (0.6, 0.55, 0.42), 0.75),
    'willow': mat('willow', (0.13, 0.19, 0.07), 0.9, double=True),
    'willowstrand': mat('willowstrand', (0.19, 0.26, 0.09), 0.9, double=True),
}


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in mats:
        ob.data.materials.append(M[m])
    bpy.context.collection.objects.link(ob)
    return ob


def flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


def decimate(ob, ratio):
    d = ob.modifiers.new('dec', 'DECIMATE')
    d.ratio = ratio


def rock_bm(rng, sx, sy, sz, freq=1.6, amp=0.32, sub=3, cap=None, cap_z=0.6, ox=0.0, oy=0.0, oz=0.0, bm=None):
    """噪声侵蚀的岩块;cap!=None 时法线朝上的面换成第二材质(苔/雪)"""
    bm = bm or bmesh.new()
    seed = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    ret = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    verts = ret['verts']
    for v in verts:
        n = noise.fractal(v.co * freq + seed, 1.0, 2.0, 3)
        v.co *= 1.0 + amp * n
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
        if v.co.z < -0.25 * sz:  # 底部压平,像从地里长出来
            v.co.z = -0.25 * sz
        v.co += Vector((ox, oy, oz + 0.25 * sz))
    bm.normal_update()
    if cap is not None:
        vs = set(verts)
        for f in bm.faces:
            if all(v in vs for v in f.verts):
                f.material_index = 1 if f.normal.z > cap_z else 0
    return bm


rng = random.Random(4242)

# ---------- 花岗岩露头 ×2(苔顶):平原/林地/丘陵的地标 ----------
for k in range(2):
    bm = None
    parts = [(3.2, 2.4, 2.2, 0, 0), (2.2, 1.8, 1.6, 2.6, 1.2), (1.6, 1.4, 1.1, -2.2, 1.6), (1.2, 1.0, 0.8, 0.8, -2.4)]
    if k == 1:
        parts = [(2.4, 2.2, 3.6, 0, 0), (1.8, 1.6, 2.2, 2.0, -0.6), (1.3, 1.2, 1.2, -1.6, 1.5)]
    for (sx, sy, sz, ox, oy) in parts:
        bm = rock_bm(rng, sx, sy, sz, cap=True, cap_z=0.62, ox=ox, oy=oy, bm=bm)
    ob = new_obj(f'Outcrop{k + 1}', bm, ['rock', 'moss'])
    flat(ob)
    decimate(ob, 0.35)

# ---------- 冰岩(雪顶):雪原 ----------
bm = None
for (sx, sy, sz, ox, oy) in [(2.2, 1.8, 2.8, 0, 0), (1.4, 1.2, 1.6, 1.8, 0.8), (1.0, 0.9, 1.0, -1.5, -0.9)]:
    bm = rock_bm(rng, sx, sy, sz, freq=1.2, amp=0.42, cap=True, cap_z=0.55, ox=ox, oy=oy, bm=bm)
ob = new_obj('IceRock', bm, ['ice', 'snow'])
flat(ob)
decimate(ob, 0.3)

# ---------- 红砂岩台地:荒漠(分层收分,条带两色) ----------
bm = bmesh.new()
N = 9
rings = []
layers = [(0.0, 5.2), (1.6, 4.8), (2.0, 4.5), (3.8, 4.2), (4.2, 3.9), (6.2, 3.7), (6.6, 3.5), (8.4, 3.4), (9.0, 3.6), (9.3, 3.5)]
phase = [rng.uniform(0, 6.28) for _ in range(3)]
for li, (z, r) in enumerate(layers):
    ring = []
    for a in range(N):
        t = a / N * math.pi * 2
        rr = r * (1 + 0.12 * math.sin(3 * t + phase[0]) + 0.08 * math.sin(5 * t + phase[1]) + rng.uniform(-0.05, 0.05))
        ring.append(bm.verts.new((math.cos(t) * rr * 1.25, math.sin(t) * rr, z)))
    rings.append(ring)
for li in range(len(rings) - 1):
    A, B = rings[li], rings[li + 1]
    for i in range(N):
        f = bm.faces.new((A[i], A[(i + 1) % N], B[(i + 1) % N], B[i]))
        f.material_index = 1 if li % 3 == 1 else 0
top = bm.faces.new(rings[-1])
top.material_index = 1
ob = new_obj('Mesa', bm, ['sandstone', 'sandband'])
flat(ob)

# ---------- 玄武岩柱群:灰烬荒原 ----------
bm = bmesh.new()
for i in range(9):
    a = rng.uniform(0, 6.28)
    d = rng.uniform(0, 2.4) if i else 0
    h = rng.uniform(2.5, 7.5) if i else 8.5
    r = rng.uniform(0.45, 0.8)
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6, radius1=r, radius2=r * 0.92, depth=h)
    tilt = Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 1)).normalized()
    for v in ret['verts']:
        v.co.z += h / 2
        v.co += tilt * 0  # 保持竖直,靠高低错落出层次
        v.co.x += math.cos(a) * d + v.co.z * tilt.x
        v.co.y += math.sin(a) * d + v.co.z * tilt.y
ob = new_obj('Spires', bm, ['basalt'])
flat(ob)


# ---------- 管状放样:树干/树枝/骨头 ----------
def tube(bm, pts, radii, segs=6):
    rings = []
    for i, p in enumerate(pts):
        if i < len(pts) - 1:
            d = (pts[i + 1] - p).normalized()
        else:
            d = (p - pts[i - 1]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        w = d.cross(u).normalized()
        ring = [bm.verts.new(p + (u * math.cos(t) + w * math.sin(t)) * radii[i])
                for t in [k / segs * math.pi * 2 for k in range(segs)]]
        rings.append(ring)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(segs):
            bm.faces.new((A[k], A[(k + 1) % segs], B[(k + 1) % segs], B[k]))
    return rings


def branch(bm, rng, base, direction, length, r0, depth, wobble=0.35):
    pts, radii = [base], [r0]
    p = base.copy()
    d = direction.normalized()
    steps = 4
    for s in range(1, steps + 1):
        d = (d + Vector((rng.uniform(-wobble, wobble), rng.uniform(-wobble, wobble), rng.uniform(-0.15, 0.25)))).normalized()
        p = p + d * (length / steps)
        pts.append(p.copy())
        radii.append(r0 * (1 - s / steps * 0.85))
    tube(bm, pts, radii, 5 if depth else 6)
    if depth > 0:
        for k in range(2 if depth > 1 else 3):
            j = rng.randint(1, steps - 1)
            nd = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.1, 0.9)))
            branch(bm, rng, pts[j], nd, length * rng.uniform(0.45, 0.65), radii[j] * 0.7, depth - 1, wobble)


# ---------- 扭曲枯树:沼泽/灰烬 ----------
for k in range(2):
    bm = bmesh.new()
    r2 = random.Random(77 + k)
    branch(bm, r2, Vector((0, 0, -0.2)), Vector((r2.uniform(-0.2, 0.2), r2.uniform(-0.2, 0.2), 1)), 5.5 + k, 0.32, 2, 0.4)
    ob = new_obj(f'DeadTree{k + 1}', bm, ['bark'])
    flat(ob)

# ---------- 垂柳:沼泽 ----------
# 粗短歪斜的主干分出三四根拱起的主枝;树冠是几团叠起来的圆穹(不是一张扁盘),
# 柳丝从整片树冠的下半截成帘垂下、一直垂到离地一米多——远看是一座垂着绿帘的穹顶,不像水母
bm = bmesh.new()
r3 = random.Random(9)
tube(bm, [Vector((0, 0, -0.2)), Vector((0.15, 0.05, 1.2)), Vector((0.35, 0.1, 2.4))], [0.46, 0.4, 0.32], 7)
limb_tips = []
for j in range(4):
    a = j * 1.6 + r3.uniform(-0.3, 0.3)
    d = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 1.0))
    p0 = Vector((0.35, 0.1, 2.3))
    pts, radii = [p0], [0.24]
    p = p0.copy()
    for s in range(1, 5):
        d = (d + Vector((0, 0, -0.12 * s))).normalized()  # 先上扬、再向外拱下
        p = p + d * 0.75
        pts.append(p.copy())
        radii.append(0.24 * (1 - s / 5 * 0.75))
    tube(bm, pts, radii, 6)
    limb_tips.append(pts)
ob_trunk = new_obj('WillowTrunk', bm, ['bark'])
flat(ob_trunk)
bm = bmesh.new()
domes = []
for pts in limb_tips:
    c = pts[3] + Vector((0, 0, 0.55))
    domes.append((c, r3.uniform(1.5, 1.9)))
domes.append((Vector((0.35, 0.1, 4.6)), 1.9))
for (c, R) in domes:
    ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    for v in ret['verts']:
        v.co.x *= R
        v.co.y *= R
        v.co.z *= R * 0.72
        v.co *= 1 + 0.18 * noise.noise(v.co * 1.4 + c)
        v.co += c
# 柳丝:从每团树冠的下沿一圈一圈垂下(内圈短、外圈长),条带略向外飘
for (c, R) in domes:
    for i in range(18):
        a = i / 18 * math.pi * 2 + r3.uniform(-0.12, 0.12)
        ring = r3.uniform(0.55, 0.95)
        out = Vector((math.cos(a), math.sin(a), 0))
        top_p = c + out * R * ring + Vector((0, 0, -R * 0.3 * ring))
        L = max(1.2, top_p.z - r3.uniform(0.9, 1.6))
        prev = None
        w = 0.2
        for s in range(5):
            t = s / 4
            p = top_p + out * (0.35 * math.sin(t * 1.3)) - Vector((0, 0, L * t))
            side = Vector((-out.y, out.x, 0)) * w * (1 - 0.55 * t)
            a1 = bm.verts.new(p - side)
            a2 = bm.verts.new(p + side)
            if prev:
                f = bm.faces.new((prev[0], prev[1], a2, a1))
                f.material_index = 1
            prev = (a1, a2)
ob_leaf = new_obj('WillowLeaf', bm, ['willow', 'willowstrand'])
flat(ob_leaf)
for ob in bpy.context.collection.objects:
    ob.select_set(ob.name in ('WillowTrunk', 'WillowLeaf'))
bpy.context.view_layer.objects.active = ob_trunk
bpy.ops.object.join()
bpy.context.active_object.name = 'Willow'

# ---------- 倒木(苔背)与树桩:林地 ----------
bm = bmesh.new()
pts = [Vector((-3.0 + i * 1.0, 0, 0.42 + 0.04 * math.sin(i))) for i in range(7)]
rings = tube(bm, pts, [0.42, 0.44, 0.43, 0.41, 0.4, 0.38, 0.36], 8)
bm.normal_update()
for f in bm.faces:
    f.material_index = 2 if f.normal.z > 0.6 else 0
c1 = bm.faces.new(list(reversed(rings[0])))
c2 = bm.faces.new(rings[-1])
c1.material_index = c2.material_index = 1
ob = new_obj('Log', bm, ['bark', 'wood', 'moss'])
flat(ob)

bm = bmesh.new()
rings = tube(bm, [Vector((0, 0, 0)), Vector((0, 0, 0.45)), Vector((0, 0, 0.8))], [0.62, 0.52, 0.5], 9)
cap = bm.faces.new(rings[-1])
cap.material_index = 1
for i in range(5):
    a = i / 5 * math.pi * 2 + 0.3
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=5, radius1=0.2, radius2=0.02, depth=1.2)
    for v in ret['verts']:
        v.co = Vector((v.co.z, v.co.y, v.co.x))  # 躺倒
        x, y = v.co.x, v.co.y
        v.co.x = math.cos(a) * (x + 0.75) - math.sin(a) * y
        v.co.y = math.sin(a) * (x + 0.75) + math.cos(a) * y
        v.co.z = v.co.z * 0.5 + 0.12 - (x + 0.6) * 0.15
ob = new_obj('Stump', bm, ['bark', 'wood'])
flat(ob)

# ---------- 灌木丛 ×2 ----------
# 十几团小叶簇拢成一蓬(底下一圈暗、顶上受光的偏黄绿):刻面小而碎,读起来是"一丛叶子",不是几颗绿宝石
for k in range(2):
    bm = bmesh.new()
    r4 = random.Random(31 + k)
    n_lumps = 13
    for i in range(n_lumps):
        a = r4.uniform(0, 6.28)
        d = r4.uniform(0, 1.0) * (1.0 if i > 2 else 0.35)
        rr = r4.uniform(0.34, 0.58) * (1.25 if i < 3 else 1.0)
        h = rr * 0.6 + (r4.uniform(0.35, 0.75) if i < 3 else r4.uniform(0.0, 0.45))
        ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rr)
        lv = set(ret['verts'])
        for v in ret['verts']:
            v.co *= 1 + 0.3 * noise.noise(v.co * 2.6 + Vector((i * 1.7, k * 3.1, 0)))
            v.co.z *= 0.82
            v.co += Vector((math.cos(a) * d, math.sin(a) * d, h))
        for f in bm.faces:
            if all(v in lv for v in f.verts):
                c = f.calc_center_median()
                # 朝天且偏高的面受光(亮叶),贴地的一圈与背阴面暗,其余常绿
                f.material_index = 2 if (f.normal.z > 0.45 and c.z > 0.75) else 1 if (c.z < 0.45 or f.normal.z < -0.3) else 0
    ob = new_obj(f'Bush{k + 1}', bm, ['leaf', 'leafdark', 'leaflight'])
    flat(ob)

# ---------- 巨兽肋骨:荒漠/龙骨之地 ----------
bm = bmesh.new()
spine = [Vector((-4.5 + i * 1.5, 0, 0.5 + 0.35 * math.sin(i * 0.6))) for i in range(7)]
tube(bm, spine, [0.32, 0.36, 0.38, 0.38, 0.36, 0.32, 0.26], 6)
for i in range(1, 6):
    for side in (-1, 1):
        pts = []
        base = spine[i]
        H = 3.4 - abs(i - 3) * 0.45
        for s in range(7):
            t = s / 6
            ang = t * math.pi * 0.95
            pts.append(base + Vector((0.25 * t, side * math.sin(ang) * 2.0, math.sin(ang * 0.5) * H - 0.2 * t)))
        tube(bm, pts, [0.2 * (1 - 0.6 * s / 6) for s in range(7)], 5)
# 头骨
ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
for v in ret['verts']:
    v.co.x *= 1.5
    v.co.y *= 0.9
    v.co.z *= 0.8
    v.co += Vector((5.6, 0, 0.75))
for side in (-1, 1):
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=6, radius1=0.22, radius2=0.03, depth=1.6)
    for v in ret['verts']:
        v.co.z += 0.8
        v.co = Vector((v.co.x * 0.9 + 5.2 - v.co.z * 0.5, v.co.y + side * 0.6 + side * v.co.z * 0.35, 1.2 + v.co.z * 0.55))
ob = new_obj('Ribcage', bm, ['bone'])
flat(ob)

# ---------- 山脊岩峰 ×2(雪顶):北境群山的山脊与陡崖(独立随机数,不影响上面各件的形状) ----------
crng = random.Random(9090)
for k in range(2):
    bm = None
    spires = [(1.9, 1.5, 6.2, 0, 0), (1.3, 1.1, 4.0, 1.7, 0.6), (1.1, 0.9, 2.6, -1.5, -0.4), (2.4, 2.0, 1.6, 0.3, 0.2)]
    if k == 1:
        spires = [(2.6, 1.6, 4.6, 0, 0), (1.5, 1.2, 6.8, -1.2, 0.5), (1.2, 1.0, 3.0, 2.0, -0.6), (2.8, 2.2, 1.4, 0.0, 0.3)]
    for (sx, sy, sz, ox, oy) in spires:
        bm = rock_bm(crng, sx, sy, sz, freq=1.3, amp=0.5, cap=True, cap_z=0.78, ox=ox, oy=oy, bm=bm)  # 只有朝天的小面积雪
    ob = new_obj(f'Crag{k + 1}', bm, ['rock', 'snow'])
    flat(ob)
    decimate(ob, 0.32)

# ---------- 导出 ----------
for ob in bpy.context.collection.objects:
    ob.select_set(True)
path = os.path.join(OUT, 'nature.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False)
names = sorted(o.name for o in bpy.context.collection.objects)
print('objects:', names)
print(f'nature.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
