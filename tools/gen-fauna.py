# Blender 资产工厂 · 动物篇:马(兼鹿)与狼
# 造型核心:身躯沿脊柱一条放样曲线(臀→腹→胸→颈→头→吻),细分取滑——真兽的剪影
# 部件契约(entities.js):
#   马腿枢轴 (±0.24, 0.85, ±0.62) 悬垂到 -0.85;狼腿枢轴 (±0.15, 0.5, ±0.32) 悬垂到 -0.5
#   材质槽: coat(主色)/dark(深色)/mane(鬃尾)/tack(鞍具)/antler(鹿角)/eye(眼)/hoof(蹄,不染)
#   狼:fur(主色)/dfur(深色)/belly(浅色腹毛,不染)/nose
#   可选件独立命名: Saddle / Antlers / Blaze / Mane(游戏按需显隐与涂色)
# Blender Z=高、-Y=面朝 → glTF +Z 前方
import bpy
import bmesh
import math
import os
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
SEG = 10


def mat(name, color, rough=0.85):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def spine_loft(name, rings, mats, mat_of_ring, subdiv=2, mat_of_face=None):
    """沿 -Y(前方)放样:rings=[(y, rx, rz, zc)] y=前后 rx=横宽 rz=竖高 zc=脊柱高度;
    mat_of_face(li, i) 可按环 + 圈上位置分材质(例如腹部浅色)"""
    bm = bmesh.new()
    loops = []
    for (y, rx, rz, zc) in rings:
        vs = []
        for i in range(SEG):
            a = i / SEG * math.pi * 2
            vs.append(bm.verts.new((math.cos(a) * rx, -y, math.sin(a) * rz + zc)))
        loops.append(vs)
    for li in range(len(loops) - 1):
        A, B = loops[li], loops[li + 1]
        for i in range(SEG):
            bm.faces.new((A[i], A[(i + 1) % SEG], B[(i + 1) % SEG], B[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    for m in mats:
        ob.data.materials.append(m)
    ring_of_face = []
    for li in range(len(loops) - 1):
        ring_of_face += [(li, i) for i in range(SEG)]
    ring_of_face += [(0, -1), (len(loops) - 2, -1)]
    for poly, (li, i) in zip(mesh.polygons, ring_of_face):
        poly.material_index = mat_of_face(li, i) if (mat_of_face and i >= 0) else mat_of_ring(li)
        poly.use_smooth = True
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = subdiv
    bpy.context.collection.objects.link(ob)
    return ob


def leg_loft(name, rings, mats, mat_of_ring):
    """竖直腿放样:rings=[(z, rx, ry, dy)](dy 前后偏移,做出膝/球节)"""
    bm = bmesh.new()
    loops = []
    for (z, rx, ry, dy) in rings:
        vs = []
        for i in range(SEG):
            a = i / SEG * math.pi * 2
            vs.append(bm.verts.new((math.cos(a) * rx, math.sin(a) * ry - dy, z)))
        loops.append(vs)
    for li in range(len(loops) - 1):
        A, B = loops[li], loops[li + 1]
        for i in range(SEG):
            bm.faces.new((A[i], A[(i + 1) % SEG], B[(i + 1) % SEG], B[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    for m in mats:
        ob.data.materials.append(m)
    ring_of_face = []
    for li in range(len(loops) - 1):
        ring_of_face += [li] * SEG
    ring_of_face += [0, len(loops) - 2]
    for poly, li in zip(mesh.polygons, ring_of_face):
        poly.material_index = mat_of_ring(li)
        poly.use_smooth = True
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = 1
    bpy.context.collection.objects.link(ob)
    return ob


def cone(name, r, h, px, py, pz, material, rx=0, rz=0):
    bpy.ops.mesh.primitive_cone_add(radius1=r, depth=h, vertices=6, location=(px, py, pz), rotation=(rx, 0, rz))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(material)
    return ob


def ball(name, r, px, py, pz, material, sx=1, sy=1, sz=1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=10, ring_count=7, location=(px, py, pz))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx, sy, sz)
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def body_loft(name, rings, mats, mat_of_ring, subdiv=2, mat_of_face=None):
    """沿 -Y(前方)放样,截面上下不对称:rings=[(y, rx, rz_top, zc, rz_bottom)](背线平、腹线深)"""
    bm = bmesh.new()
    loops = []
    for (y, rx, rzt, zc, rzb) in rings:
        vs = []
        for i in range(SEG):
            a = i / SEG * math.pi * 2
            sz = math.sin(a)
            vs.append(bm.verts.new((math.cos(a) * rx, -y, sz * (rzt if sz > 0 else rzb) + zc)))
        loops.append(vs)
    for li in range(len(loops) - 1):
        A, B = loops[li], loops[li + 1]
        for i in range(SEG):
            bm.faces.new((A[i], A[(i + 1) % SEG], B[(i + 1) % SEG], B[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    for m in mats:
        ob.data.materials.append(m)
    ring_of_face = []
    for li in range(len(loops) - 1):
        ring_of_face += [(li, i) for i in range(SEG)]
    ring_of_face += [(0, -1), (len(loops) - 2, -1)]
    for poly, (li, i) in zip(mesh.polygons, ring_of_face):
        poly.material_index = mat_of_face(li, i) if (mat_of_face and i >= 0) else mat_of_ring(li)
        poly.use_smooth = True
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = subdiv
    bpy.context.collection.objects.link(ob)
    return ob


def tube(name, pts, radii, material, segs=8, subdiv=1, flat=1.0):
    """沿任意折线的圆管(截面垂直于走向,平行移动标架),radii 逐点;flat<1 把截面压成扁带(尾巴)"""
    bm = bmesh.new()
    P = [Vector(p) for p in pts]
    loops = []
    nrm = None
    for k, p in enumerate(P):
        d = (P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]).normalized()
        if nrm is None:
            nrm = d.cross(Vector((1, 0, 0)))
            if nrm.length < 1e-3:
                nrm = d.cross(Vector((0, 1, 0)))
            nrm.normalize()
        else:
            nrm = (nrm - d * nrm.dot(d)).normalized()
        bi = d.cross(nrm).normalized()
        ring = []
        for i in range(segs):
            a = i / segs * math.pi * 2
            ring.append(bm.verts.new(p + (bi * math.cos(a) * radii[k]) + (nrm * math.sin(a) * radii[k] * flat)))
        loops.append(ring)
    for A, B in zip(loops, loops[1:]):
        for i in range(segs):
            bm.faces.new((A[i], A[(i + 1) % segs], B[(i + 1) % segs], B[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True
    if subdiv:
        md = ob.modifiers.new('sub', 'SUBSURF')
        md.levels = subdiv
    bpy.context.collection.objects.link(ob)
    return ob


def card(name, top, bottom, material):
    """两排点之间的一条薄片(鬃毛):top/bottom 等长点列"""
    bm = bmesh.new()
    T = [bm.verts.new(p) for p in top]
    B = [bm.verts.new(p) for p in bottom]
    for i in range(len(T) - 1):
        bm.faces.new((T[i], T[i + 1], B[i + 1], B[i]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True
    bpy.context.collection.objects.link(ob)
    return ob


def join(name, obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    for o in obs:
        for md in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


# ================= 马 =================
# 体块:圆臀、深胸、平背,颈部粗壮前倾、头部下垂成楔形;前后腿各一套四段腿(前臂/腕/管骨/球节-系部-蹄;
# 后腿的跗关节向后折);鬃毛是顺颈脊披向一侧的发片,尾巴是下垂的扁管;马具(鞍座带前后鞍桥、鞍垫、肚带、
# 马镫、笼头与缰绳)整个算在 Saddle 里,没备鞍的马整组摘掉
bpy.ops.wm.read_factory_settings(use_empty=True)
coat = mat('coat', (0.35, 0.24, 0.15), 0.8)
darkm = mat('dark', (0.22, 0.15, 0.10), 0.85)
mane = mat('mane', (0.12, 0.08, 0.06), 0.95)
mane.use_backface_culling = False
tack = mat('tack', (0.07, 0.04, 0.025), 0.55)
blanket = mat('blanket', (0.24, 0.05, 0.04), 0.95)
ironm = mat('iron', (0.2, 0.2, 0.22), 0.4)
antler = mat('antler', (0.65, 0.58, 0.45), 0.8)
eyem = mat('eye', (0.03, 0.025, 0.02), 0.3)
white = mat('blaze', (0.85, 0.83, 0.78), 0.85)
hoofm = mat('hoof', (0.06, 0.05, 0.045), 0.55)

# (y 前后, 半宽, 上半径, 脊线中心高, 下半径)
BODY = [
    (-1.05, 0.12, 0.12, 1.5, 0.14),    # 尾根
    (-0.95, 0.27, 0.15, 1.47, 0.36),   # 臀尖
    (-0.74, 0.36, 0.17, 1.45, 0.52),   # 髋(臀部最圆)
    (-0.46, 0.37, 0.12, 1.46, 0.55),   # 腰
    (-0.12, 0.39, 0.13, 1.45, 0.56),   # 腹(最宽)
    (0.22, 0.37, 0.16, 1.45, 0.57),    # 肚带
    (0.48, 0.32, 0.24, 1.43, 0.58),    # 胸 + 鬐甲
    (0.66, 0.26, 0.28, 1.43, 0.46),    # 前胸
    (0.8, 0.19, 0.26, 1.56, 0.3),      # 颈根(粗)
    (0.94, 0.15, 0.2, 1.74, 0.2),      # 颈中
    (1.06, 0.125, 0.16, 1.9, 0.16),    # 颈上
    (1.15, 0.115, 0.14, 2.0, 0.15),    # 项(喉)
    (1.25, 0.13, 0.12, 1.97, 0.17),    # 颊(下颌宽深)
    (1.39, 0.1, 0.1, 1.87, 0.11),      # 面
    (1.52, 0.085, 0.085, 1.76, 0.09),  # 鼻梁
    (1.61, 0.08, 0.07, 1.7, 0.08),     # 吻(深色)
    (1.66, 0.055, 0.045, 1.67, 0.055), # 吻端
]
body_loft('Body', BODY, [coat, darkm], lambda li: 1 if li >= 15 else 0)
for s2 in (-1, 1):
    cone('Ear', 0.045, 0.18, 0.085 * s2, -1.11, 2.2, darkm, rx=-0.15, rz=-s2 * 0.22)
    ball('EyeH', 0.03, 0.118 * s2, -1.27, 2.03, eyem)
    ball('Nostril', 0.02, 0.045 * s2, -1.68, 1.68, eyem, sx=1, sy=0.6, sz=1.3)

# 腿:(z, 半宽, 半深, 前移);前腿直立、腕关节一个骨节;后腿跗关节向后折出尖
leg_loft('HorseLegF', [
    (0.26, 0.09, 0.12, 0.03),    # 上臂(藏进胸里)
    (0.04, 0.1, 0.135, 0.03),    # 前臂上端(肌肉,从胸下收进来)
    (-0.14, 0.082, 0.1, 0.01),
    (-0.29, 0.066, 0.075, 0.0),
    (-0.355, 0.078, 0.085, 0.012),  # 腕(膝)关节
    (-0.42, 0.054, 0.062, 0.0),     # 管骨
    (-0.6, 0.05, 0.058, 0.0),
    (-0.665, 0.064, 0.074, -0.012), # 球节
    (-0.725, 0.048, 0.054, 0.018),  # 系部(前倾)
    (-0.77, 0.064, 0.07, 0.036),    # 蹄冠
    (-0.85, 0.08, 0.086, 0.046),    # 蹄底
], [coat, darkm, hoofm], lambda li: 0 if li <= 3 else (1 if li <= 7 else 2))
leg_loft('HorseLegH', [
    (0.26, 0.1, 0.14, 0.06),     # 大腿(藏进臀里)
    (0.04, 0.11, 0.16, 0.0),     # 股部肌肉
    (-0.13, 0.086, 0.12, -0.06),
    (-0.25, 0.068, 0.085, -0.11),
    (-0.315, 0.074, 0.1, -0.135),   # 跗关节(向后的尖)
    (-0.38, 0.054, 0.068, -0.1),    # 管骨
    (-0.6, 0.05, 0.058, -0.075),
    (-0.665, 0.064, 0.074, -0.08),  # 球节
    (-0.725, 0.048, 0.054, -0.05),  # 系部
    (-0.77, 0.064, 0.07, -0.032),   # 蹄冠
    (-0.85, 0.08, 0.086, -0.022),   # 蹄底
], [coat, darkm, hoofm], lambda li: 0 if li <= 3 else (1 if li <= 7 else 2))

# 鬃:顺颈脊的一条发片,披向右侧,下缘参差;额前一撮额毛
N = 12
top, bot = [], []
for i in range(N + 1):
    t = i / N
    y = 0.6 + 0.55 * t
    z = 1.72 + 0.44 * t + 0.07 * math.sin(math.pi * t)
    top.append((0.0, -y, z + 0.02))
    drop = 0.2 + 0.07 * math.sin(t * 9.0) + 0.05 * (1 - t)
    bot.append((0.1 + 0.03 * math.sin(t * 7.0), -y + 0.03, z - drop))
m1 = card('Mane', top, bot, mane)
top2 = [(x - 0.012, y, z) for (x, y, z) in top]
bot2 = [(x - 0.07, y, z + 0.06) for (x, y, z) in bot]
m2 = card('Mane2', top2, bot2, mane)  # 另一侧薄薄一层,脊上不露缝
f1 = card('Forelock', [(-0.05, -1.13, 2.17), (0.05, -1.13, 2.17)], [(-0.03, -1.25, 2.02), (0.04, -1.24, 2.0)], mane)
join('Mane', [m1, m2, f1])

# 尾:从尾根先翘后垂的扁管,末端散开
tube('Tail', [(0, 1.04, 1.5), (0, 1.13, 1.45), (0, 1.2, 1.3), (0, 1.25, 1.08), (0, 1.26, 0.85), (0, 1.24, 0.62), (0, 1.22, 0.46)],
     [0.05, 0.075, 0.09, 0.1, 0.11, 0.1, 0.05], mane, segs=8, subdiv=1, flat=0.6)

# 面斑(三成马显示)
ball('Blaze', 0.05, 0, -1.43, 1.86, white, sx=0.8, sy=1.9, sz=2.6)

# 马具:鞍垫(盖过背、垂到肋下)+ 鞍座(前后鞍桥翘起)+ 两侧护腿皮 + 肚带 + 马镫 + 笼头与缰绳
sad = []
U, V = 9, 11
bmb = bmesh.new()
grid = []
for iu in range(U + 1):
    y = -0.48 + 0.82 * iu / U
    row = []
    for iv in range(V + 1):
        th = -2.0 + 4.0 * iv / V
        rx = 0.42
        if abs(th) <= math.pi / 2:
            x, z = rx * math.sin(th), 1.45 + 0.17 * math.cos(th)
        else:
            x, z = rx * math.sin(th), 1.45 + 0.58 * math.cos(th)
        row.append(bmb.verts.new((x * 1.04, -y, z + 0.03)))
    grid.append(row)
for iu in range(U):
    for iv in range(V):
        bmb.faces.new((grid[iu][iv], grid[iu + 1][iv], grid[iu + 1][iv + 1], grid[iu][iv + 1]))
meb = bpy.data.meshes.new('Blanket')
bmb.to_mesh(meb)
bmb.free()
ob = bpy.data.objects.new('Blanket', meb)
ob.data.materials.append(blanket)
bpy.context.collection.objects.link(ob)
sol = ob.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.025
sad.append(ob)
sad.append(body_loft('Seat', [
    (-0.36, 0.15, 0.06, 1.7, 0.05), (-0.3, 0.2, 0.1, 1.68, 0.06), (-0.18, 0.22, 0.06, 1.65, 0.06),
    (0.0, 0.21, 0.05, 1.64, 0.06), (0.14, 0.19, 0.06, 1.66, 0.06), (0.23, 0.15, 0.1, 1.7, 0.06), (0.28, 0.09, 0.06, 1.76, 0.05),
], [tack], lambda li: 0, subdiv=1))
for s2 in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s2 * 0.45, 0.02, 1.38))
    o = bpy.context.active_object
    o.scale = (0.025, 0.42, 0.36)
    o.rotation_euler = (0, s2 * 0.12, 0)
    o.data.materials.append(tack)
    sad.append(o)
    # 马镫皮带 + 马镫
    sad.append(tube('Leather', [(s2 * 0.44, 0.02, 1.6), (s2 * 0.47, 0.02, 1.2), (s2 * 0.47, 0.02, 1.04)], [0.012, 0.012, 0.012], tack, segs=4, subdiv=0, flat=0.4))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.012, major_segments=10, minor_segments=4,
                                     location=(s2 * 0.47, 0.02, 0.97), rotation=(0, math.pi / 2, 0))
    o = bpy.context.active_object
    o.scale = (1, 1.3, 1)
    o.data.materials.append(ironm)
    sad.append(o)
# 肚带
gir = []
for i in range(14):
    a = i / 14 * math.pi * 2
    sz = math.sin(a)
    gir.append((math.cos(a) * 0.425, -0.24, 1.45 + sz * (0.2 if sz > 0 else 0.63)))
gir.append(gir[0])
sad.append(tube('Girth', gir, [0.035] * len(gir), tack, segs=4, subdiv=0, flat=0.35))
# 笼头:鼻环、颊带、额带、项带;缰绳从衔口垂成弧线搭到鞍桥
nose = []
for i in range(13):
    a = i / 12 * math.pi * 2
    sz = math.sin(a)
    nose.append((math.cos(a) * 0.1, -1.5, 1.79 + sz * (0.1 if sz > 0 else 0.1)))
sad.append(tube('Nose', nose, [0.014] * len(nose), tack, segs=4, subdiv=0))
for s2 in (-1, 1):
    sad.append(tube('Cheek', [(s2 * 0.1, -1.5, 1.79), (s2 * 0.13, -1.3, 1.96), (s2 * 0.11, -1.14, 2.12)], [0.014] * 3, tack, segs=4, subdiv=0))
    sad.append(tube('Rein', [(s2 * 0.11, -1.56, 1.73), (s2 * 0.2, -1.2, 1.62), (s2 * 0.24, -0.8, 1.6), (s2 * 0.18, -0.4, 1.68), (s2 * 0.1, -0.27, 1.76)],
                    [0.01] * 5, tack, segs=4, subdiv=0))
sad.append(tube('Poll', [(-0.11, -1.14, 2.12), (0, -1.13, 2.19), (0.11, -1.14, 2.12)], [0.014] * 3, tack, segs=4, subdiv=0))
join('Saddle', sad)

# 鹿角(鹿显示):左右各一主干两叉,长在新的项部
for s in (-1, 1):
    beam = cone('Antlers', 0.03, 0.55, 0.1 * s, -1.08, 2.42, antler, rx=-0.35, rz=-s * 0.55)
    beam.name = 'Antlers'
    for (dz, rz2) in ((0.16, 0.9), (0.34, 0.5)):
        t = cone('Antlers', 0.018, 0.26, 0.1 * s + s * 0.10, -1.06, 2.42 + dz, antler, rx=-0.2, rz=-s * rz2)
        t.name = 'Antlers'
for ob in bpy.context.collection.objects:
    ob.select_set(True)
path = os.path.join(OUT, 'horse.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False)
print(f'horse.glb → {os.path.getsize(path) // 1024}KB')

# ================= 狼 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
fur = mat('fur', (0.32, 0.32, 0.35), 0.95)
dfur = mat('dfur', (0.20, 0.20, 0.23), 0.95)
eyew = mat('eyew', (1.0, 0.2, 0.13), 0.4)

belly = mat('belly', (0.62, 0.6, 0.56), 0.95)   # 浅色腹毛(不随毛色染)
nosem = mat('nose', (0.05, 0.05, 0.05), 0.4)
# 躯干:深胸耸肩、细腰;颈部一圈蓬起的颈毛;长吻;下半圈(腹、喉)浅色
spine_loft('WolfBody', [
    (-0.58, 0.1, 0.12, 0.62),    # 尾根
    (-0.45, 0.19, 0.23, 0.61),   # 臀
    (-0.18, 0.19, 0.22, 0.59),   # 细腰
    (0.12, 0.24, 0.3, 0.64),     # 胸(深)
    (0.32, 0.27, 0.32, 0.71),    # 肩 + 颈毛
    (0.45, 0.22, 0.25, 0.79),    # 颈(颈毛蓬)
    (0.57, 0.15, 0.15, 0.86),    # 颅
    (0.69, 0.12, 0.11, 0.82),    # 颊
    (0.84, 0.075, 0.07, 0.77),   # 吻
    (0.97, 0.05, 0.05, 0.75),    # 吻端(深色)
], [fur, dfur, belly], lambda li: 1 if li >= 8 else 0,
    mat_of_face=lambda li, i: 1 if li >= 8 else (2 if 1 <= li <= 6 and math.sin((i + 0.5) / SEG * 2 * math.pi) < -0.45 else 0))
for s2 in (-1, 1):
    cone('WolfEar', 0.065, 0.18, 0.095 * s2, -0.53, 1.02, dfur, rx=-0.12, rz=-s2 * 0.18)
    ball('Eye', 0.026, 0.075 * s2, -0.71, 0.88, eyew)
ball('Nose', 0.035, 0, -0.99, 0.77, nosem, sx=1.2, sy=0.8, sz=0.8)
# 颈毛:肩颈上半圈一层蓬起的深色毛(鬃),顺着身体向后披
spine_loft('Ruff', [
    (0.2, 0.2, 0.2, 0.78),
    (0.34, 0.28, 0.27, 0.79),
    (0.46, 0.24, 0.24, 0.84),
    (0.55, 0.16, 0.16, 0.89),
], [dfur], lambda li: 0, subdiv=1)
leg_loft('WolfLeg', [
    (0.04, 0.07, 0.086, 0),
    (-0.1, 0.062, 0.078, 0.0),      # 上段肌肉
    (-0.22, 0.04, 0.046, -0.006),   # 肘/跗
    (-0.36, 0.032, 0.036, 0.008),   # 下段
    (-0.42, 0.04, 0.046, -0.012),   # 掌
    (-0.47, 0.05, 0.062, -0.032),   # 爪(前伸)
], [fur, dfur], lambda li: 1 if li >= 3 else 0)
# 尾:蓬松斜垂
spine_loft('WolfTail', [
    (-0.58, 0.035, 0.035, 0.60),
    (-0.75, 0.06, 0.065, 0.48),
    (-0.92, 0.05, 0.055, 0.34),
    (-1.0, 0.02, 0.02, 0.26),
], [fur], lambda li: 0, subdiv=1)
for ob in bpy.context.collection.objects:
    ob.select_set(True)
path = os.path.join(OUT, 'wolf.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'wolf.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
