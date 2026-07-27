# Blender 资产工厂 · 人体篇:放样管体 + 细分曲面,产出与游戏动画枢轴逐位兼容的部件
# 部件契约(见 entities.js makeHumanoid):
#   Leg  局部原点=髋枢轴,几何向下悬垂到 -0.5(靴底);材质 [pants, boots]
#   Arm  局部原点=肩枢轴,几何向下到 -0.49(手);材质 [shirt, skin]
#   Torso 局部原点=躯干中心(游戏放 y0.78),含肩部;材质 [shirt]
#   Belt 腰带;材质 [boots](皮革同色)
#   Head 局部原点=头心(游戏放 y1.32),含眼鼻耳;材质 [skin, eye]
# Blender Z 轴为高,export_yup 转 glTF Y-up;Blender -Y 为脸朝向 → glTF +Z
# 用法: python3 tools/gen-human.py → assets/models/human.glb
import bpy
import bmesh
import math
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

SEG = 10


def mat(name, color, roughness=0.85):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = roughness
    return m


def loft(name, rings, mats, mat_of_ring, subdiv=2, close_top=True, close_bottom=True):
    """rings: [(z, rx, ry, dy)];放样成管,细分取滑,按环归属分材质"""
    bm = bmesh.new()
    loops = []
    for (z, rx, ry, dy) in rings:
        vs = []
        for i in range(SEG):
            a = i / SEG * math.pi * 2
            vs.append(bm.verts.new((math.cos(a) * rx, math.sin(a) * ry + dy, z)))
        loops.append(vs)
    faces = []
    for li in range(len(loops) - 1):
        a, b = loops[li], loops[li + 1]
        for i in range(SEG):
            f = bm.faces.new((a[i], a[(i + 1) % SEG], b[(i + 1) % SEG], b[i]))
            faces.append((f, li))
    if close_bottom:
        f = bm.faces.new(list(reversed(loops[0])))
        faces.append((f, 0))
    if close_top:
        f = bm.faces.new(loops[-1])
        faces.append((f, len(loops) - 2))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    for m in mats:
        ob.data.materials.append(m)
    for idx, (poly, li) in enumerate(zip(mesh.polygons, [x[1] for x in faces])):
        poly.material_index = mat_of_ring(li)
        poly.use_smooth = True
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = subdiv
    md.render_levels = subdiv
    bpy.context.collection.objects.link(ob)
    return ob


skin = mat('skin', (0.72, 0.53, 0.36), 0.65)
shirt = mat('shirt', (0.30, 0.42, 0.28), 0.9)
pants = mat('pants', (0.28, 0.22, 0.16), 0.92)
boots = mat('boots', (0.16, 0.12, 0.09), 0.6)
eye = mat('eye', (0.05, 0.04, 0.03), 0.3)

# ---- 腿(髋→膝→踝→靴,靴头前伸) ----
loft('Leg', [
    (0.02, 0.105, 0.115, 0),
    (-0.10, 0.100, 0.108, 0.005),
    (-0.22, 0.078, 0.085, 0.01),   # 膝
    (-0.30, 0.083, 0.09, 0.005),   # 小腿肚
    (-0.40, 0.055, 0.06, 0),       # 踝
    (-0.41, 0.085, 0.095, -0.015), # 靴口
    (-0.46, 0.088, 0.11, -0.045),  # 靴身(前伸=脸朝 -Y)
    (-0.50, 0.09, 0.13, -0.06),    # 靴底带鞋头
], [pants, boots], lambda li: 0 if li <= 4 else 1)

# ---- 臂(肩→肘→腕→手) ----
loft('Arm', [
    (0.03, 0.082, 0.082, 0),
    (-0.10, 0.070, 0.070, 0.004),
    (-0.20, 0.055, 0.055, 0.008),  # 肘
    (-0.28, 0.060, 0.060, 0.006),  # 前臂
    (-0.38, 0.044, 0.044, 0),      # 腕
    (-0.40, 0.052, 0.05, -0.008),  # 手掌
    (-0.47, 0.045, 0.055, -0.012), # 指部(拳形)
], [shirt, skin], lambda li: 0 if li <= 3 else 1)

# ---- 躯干(髋摆→腰→胸→肩→颈,含束腰下摆) ----
loft('Torso', [
    (-0.31, 0.255, 0.20, 0),   # 下摆(略宽)
    (-0.24, 0.235, 0.185, 0),
    (-0.10, 0.205, 0.165, 0),  # 腰
    (0.06, 0.255, 0.195, 0.01),  # 胸
    (0.20, 0.29, 0.185, 0.005),  # 肩
    (0.27, 0.20, 0.15, 0),
    (0.30, 0.09, 0.09, 0),     # 颈
], [shirt], lambda li: 0)

# ---- 腰带 ----
loft('Belt', [
    (-0.20, 0.245, 0.195, 0),
    (-0.12, 0.25, 0.20, 0),
], [boots], lambda li: 0, subdiv=1, close_top=False, close_bottom=False)

# ---- 头(颅顶→颧→颌收窄;眼窝/鼻/耳) ----
head = loft('Head', [
    (-0.19, 0.10, 0.10, 0.02),   # 颌尖(略前)
    (-0.13, 0.155, 0.15, 0.01),  # 颌
    (-0.02, 0.195, 0.185, 0),    # 颧
    (0.10, 0.20, 0.19, -0.005),  # 颅
    (0.19, 0.13, 0.13, -0.01),   # 顶
], [skin, eye], lambda li: 0)
# 鼻:小放样贴脸(脸朝 -Y)
loft('Nose', [
    (-0.075, 0.030, 0.02, -0.185),
    (-0.045, 0.036, 0.026, -0.20),
    (-0.02, 0.024, 0.02, -0.19),
], [skin], lambda li: 0, subdiv=1)
# 眼:两粒扁球
for sx in (-1, 1):
    bm = bmesh.new()
    ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.028)
    for v in ret['verts']:
        v.co.y *= 0.5
        v.co.x += 0.075 * sx
        v.co.y += -0.175
        v.co.z += 0.02
    mesh = bpy.data.meshes.new('Eye')
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new('Eye' + ('L' if sx < 0 else 'R'), mesh)
    ob.data.materials.append(eye)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.collection.objects.link(ob)
# 耳:两粒小球
for sx in (-1, 1):
    bm = bmesh.new()
    ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.038)
    for v in ret['verts']:
        v.co.x *= 0.5
        v.co.x += 0.19 * sx
        v.co.z += -0.02
    mesh = bpy.data.meshes.new('Ear')
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new('Ear' + ('L' if sx < 0 else 'R'), mesh)
    ob.data.materials.append(skin)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.collection.objects.link(ob)

path = os.path.join(OUT, 'human.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
total = sum(len(o.data.polygons) for o in bpy.context.collection.objects)
print(f'human.glb faces(细分前)≈{total} → {os.path.getsize(path) // 1024}KB')
