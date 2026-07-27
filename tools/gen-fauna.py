# Blender 资产工厂 · 动物篇:马(兼鹿)与狼
# 造型核心:身躯沿脊柱一条放样曲线(臀→腹→胸→颈→头→吻),细分取滑——真兽的剪影
# 部件契约(entities.js):
#   马腿枢轴 (±0.24, 0.85, ±0.62) 悬垂到 -0.85;狼腿枢轴 (±0.15, 0.5, ±0.32) 悬垂到 -0.5
#   材质槽: coat(主色)/dark(深色)/mane(鬃尾)/tack(鞍具)/antler(鹿角)/eye(眼)
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


def spine_loft(name, rings, mats, mat_of_ring, subdiv=2):
    """沿 -Y(前方)放样:rings=[(y, rx, rz, zc)] y=前后 rx=横宽 rz=竖高 zc=脊柱高度"""
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
        ring_of_face += [li] * SEG
    ring_of_face += [0, len(loops) - 2]
    for poly, li in zip(mesh.polygons, ring_of_face):
        poly.material_index = mat_of_ring(li)
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

# 身躯+颈+头+吻:一条脊柱放样
spine_loft('Body', [
    (-1.00, 0.16, 0.22, 1.10),   # 尾根
    (-0.85, 0.28, 0.33, 1.10),   # 臀
    (-0.45, 0.345, 0.40, 1.06),  # 腹
    (0.05, 0.35, 0.42, 1.08),    # 肚带
    (0.50, 0.31, 0.38, 1.14),    # 胸/肩
    (0.72, 0.20, 0.26, 1.30),    # 颈根
    (0.85, 0.145, 0.20, 1.55),   # 颈中
    (0.93, 0.125, 0.17, 1.78),   # 颈上
    (1.05, 0.115, 0.15, 1.90),   # 头
    (1.22, 0.08, 0.10, 1.86),    # 面
    (1.35, 0.065, 0.075, 1.80),  # 吻(深色)
], [coat, darkm], lambda li: 1 if li >= 9 else 0)
# 耳/眼
for s in (-1, 1):
    cone('Ear', 0.045, 0.15, 0.10 * s, -0.98, 2.02, darkm, rx=-0.25, rz=-s * 0.25)
    ball('EyeH', 0.030, 0.125 * s, -1.10, 1.90, eyem)
# 腿(游戏克隆四次;前后腿共用)
leg_loft('HorseLeg', [
    (0.05, 0.115, 0.13, 0),
    (-0.28, 0.075, 0.085, -0.01),  # 膝
    (-0.5, 0.048, 0.05, 0.005),    # 管
    (-0.66, 0.055, 0.058, -0.01),  # 球节
    (-0.78, 0.05, 0.052, 0),
    (-0.85, 0.058, 0.062, -0.008), # 蹄(深色)
], [coat, darkm], lambda li: 1 if li >= 3 else 0)
# 鬃:颈脊一条窄放样
spine_loft('Mane', [
    (0.52, 0.035, 0.10, 1.34),
    (0.70, 0.04, 0.13, 1.62),
    (0.85, 0.038, 0.12, 1.86),
    (0.98, 0.03, 0.09, 2.0),
], [mane], lambda li: 0, subdiv=1)
# 尾
spine_loft('Tail', [
    (-1.0, 0.05, 0.05, 1.10),
    (-1.15, 0.075, 0.08, 0.92),
    (-1.28, 0.06, 0.07, 0.68),
    (-1.32, 0.03, 0.03, 0.45),
], [mane], lambda li: 0, subdiv=1)
# 面斑(三成马显示)
ball('Blaze', 0.05, 0, -1.16, 1.92, white, sx=0.9, sy=1.6, sz=2.2)
# 鞍(骑乘时显示):鞍座+肚带
spine_loft('Saddle', [
    (-0.30, 0.36, 0.10, 1.42),
    (0.0, 0.38, 0.12, 1.44),
    (0.22, 0.36, 0.11, 1.46),
], [tack], lambda li: 0, subdiv=1)
# 鹿角(鹿显示):左右各一主干两叉
import mathutils
for s in (-1, 1):
    beam = cone('Antlers', 0.03, 0.55, 0.12 * s, -0.85, 2.25, antler, rx=-0.35, rz=-s * 0.55)
    beam.name = 'Antlers'
    for (dz, rz2) in ((0.16, 0.9), (0.34, 0.5)):
        t = cone('Antlers', 0.018, 0.26, 0.12 * s + s * 0.10, -0.83, 2.25 + dz, antler, rx=-0.2, rz=-s * rz2)
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

spine_loft('WolfBody', [
    (-0.58, 0.10, 0.13, 0.62),   # 尾根
    (-0.42, 0.20, 0.24, 0.60),   # 臀
    (-0.05, 0.235, 0.27, 0.58),  # 腹
    (0.30, 0.25, 0.28, 0.62),    # 胸(略耸)
    (0.45, 0.16, 0.18, 0.70),    # 颈
    (0.58, 0.14, 0.14, 0.78),    # 头
    (0.72, 0.09, 0.09, 0.75),    # 颊
    (0.86, 0.048, 0.048, 0.70),  # 吻(深色)
], [fur, dfur], lambda li: 1 if li >= 6 else 0)
for s in (-1, 1):
    cone('WolfEar', 0.05, 0.15, 0.09 * s, -0.52, 0.95, dfur, rx=-0.15, rz=-s * 0.2)
    ball('Eye', 0.026, 0.07 * s, -0.70, 0.82, eyew)
leg_loft('WolfLeg', [
    (0.03, 0.062, 0.07, 0),
    (-0.2, 0.045, 0.05, -0.008),
    (-0.36, 0.032, 0.035, 0.006),
    (-0.46, 0.038, 0.042, -0.012),  # 爪
], [fur, dfur], lambda li: 1 if li >= 2 else 0)
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
