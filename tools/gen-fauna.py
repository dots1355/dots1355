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


# ================= 马 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
coat = mat('coat', (0.35, 0.24, 0.15), 0.8)
darkm = mat('dark', (0.22, 0.15, 0.10), 0.85)
mane = mat('mane', (0.12, 0.08, 0.06), 0.95)
tack = mat('tack', (0.30, 0.10, 0.09), 0.6)
antler = mat('antler', (0.65, 0.58, 0.45), 0.8)
eyem = mat('eye', (0.04, 0.03, 0.02), 0.3)
white = mat('blaze', (0.85, 0.83, 0.78), 0.85)

# 身躯+颈+头+吻:一条脊柱放样(深胸、收腹、长颈高昂、头部下颌有棱)
spine_loft('Body', [
    (-1.03, 0.15, 0.19, 1.37),   # 尾根(高挂在臀上)
    (-0.95, 0.27, 0.36, 1.2),    # 臀(圆)
    (-0.72, 0.33, 0.39, 1.2),    # 髋
    (-0.45, 0.34, 0.33, 1.23),   # 腰窝(收腹上提)
    (-0.1, 0.36, 0.39, 1.12),    # 腹
    (0.25, 0.345, 0.42, 1.12),   # 肚带
    (0.55, 0.29, 0.44, 1.18),    # 胸(深)+ 鬐甲
    (0.72, 0.21, 0.33, 1.42),    # 颈根(竖向厚)
    (0.84, 0.16, 0.25, 1.66),    # 颈中
    (0.95, 0.13, 0.19, 1.9),     # 颈上
    (1.03, 0.115, 0.155, 2.06),  # 项/喉
    (1.13, 0.12, 0.155, 2.08),   # 头(颊)
    (1.3, 0.095, 0.115, 1.98),   # 面
    (1.46, 0.075, 0.085, 1.87),  # 吻(深色)
], [coat, darkm], lambda li: 1 if li >= 12 else 0)
# 耳/眼
for s2 in (-1, 1):
    cone('Ear', 0.045, 0.17, 0.10 * s2, -1.04, 2.24, darkm, rx=-0.25, rz=-s2 * 0.25)
    ball('EyeH', 0.032, 0.125 * s2, -1.17, 2.1, eyem)
    ball('Nostril', 0.022, 0.05 * s2, -1.52, 1.86, eyem, sx=1, sy=0.6, sz=1.2)
# 腿(游戏克隆四次;前后腿共用):肌肉饱满的上段 → 膝/跗关节 → 细管骨 → 球节 → 系部 → 外撇的蹄
hoofm = mat('hoof', (0.08, 0.07, 0.06), 0.55)
leg_loft('HorseLeg', [
    (0.1, 0.13, 0.16, 0.0),
    (-0.05, 0.125, 0.155, 0.01),   # 前臂/股部肌肉
    (-0.2, 0.09, 0.11, 0.02),
    (-0.3, 0.066, 0.076, 0.0),
    (-0.36, 0.078, 0.088, -0.012), # 膝(跗)关节
    (-0.43, 0.054, 0.06, 0.0),     # 管骨
    (-0.6, 0.05, 0.056, 0.006),
    (-0.67, 0.064, 0.07, -0.012),  # 球节
    (-0.73, 0.05, 0.054, -0.024),  # 系部(前倾)
    (-0.78, 0.068, 0.072, -0.036), # 蹄冠
    (-0.85, 0.082, 0.086, -0.044), # 蹄底(外撇)
], [coat, darkm, hoofm], lambda li: 0 if li <= 3 else (1 if li <= 7 else 2))
# 鬃:颈脊一条窄放样
spine_loft('Mane', [
    (0.55, 0.035, 0.1, 1.42),
    (0.72, 0.042, 0.14, 1.68),
    (0.86, 0.04, 0.13, 1.94),
    (0.98, 0.034, 0.11, 2.12),
    (1.06, 0.03, 0.08, 2.2),
], [mane], lambda li: 0, subdiv=1)
# 尾
spine_loft('Tail', [
    (-1.0, 0.05, 0.05, 1.10),
    (-1.15, 0.075, 0.08, 0.92),
    (-1.28, 0.06, 0.07, 0.68),
    (-1.32, 0.03, 0.03, 0.45),
], [mane], lambda li: 0, subdiv=1)
# 面斑(三成马显示)
ball('Blaze', 0.05, 0, -1.32, 2.02, white, sx=0.9, sy=1.8, sz=2.2)
# 鞍(骑乘时显示):鞍座+肚带
spine_loft('Saddle', [
    (-0.30, 0.36, 0.10, 1.42),
    (0.0, 0.38, 0.12, 1.44),
    (0.22, 0.36, 0.11, 1.46),
], [tack], lambda li: 0, subdiv=1)
# 鹿角(鹿显示):左右各一主干两叉
import mathutils
for s in (-1, 1):
    beam = cone('Antlers', 0.03, 0.55, 0.12 * s, -1.0, 2.38, antler, rx=-0.35, rz=-s * 0.55)
    beam.name = 'Antlers'
    for (dz, rz2) in ((0.16, 0.9), (0.34, 0.5)):
        t = cone('Antlers', 0.018, 0.26, 0.12 * s + s * 0.10, -0.98, 2.38 + dz, antler, rx=-0.2, rz=-s * rz2)
        t.name = 'Antlers'
for ob in bpy.context.collection.objects:
    ob.select_set(True)
path = os.path.join(OUT, 'horse.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
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
