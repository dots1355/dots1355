# Blender 资产工厂 · 建筑与岩石篇
#   house.glb — 诺德式木架屋(单位尺寸 6×3.2×5,游戏按需缩放):
#     石基座 / 抹灰墙 / 深色梁架(角柱+横带+斜撑)/ 叠瓦屋顶带出檐 / 石烟囱 / 门窗框
#     材质名: plaster wood stone roof door
#   rocks.glb — 三块侵蚀岩(棱面平直着色,底部坐平;游戏取几何体入池自行调色)
# 用法: python3 tools/gen-props.py
import bpy
import bmesh
import random
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


def mat(name, color, rough=0.9):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def box(name, sx, sy, sz, px, py, pz, material, rx=0, ry=0, rz=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(px, py, pz), rotation=(rx, ry, rz))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx / 2 * 2 / 2 * 2, sy, sz)  # 见下:统一用 dimensions
    ob.dimensions = (sx, sy, sz)
    ob.data.materials.append(material)
    return ob


# ================= 房屋 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
plaster = mat('plaster', (0.40, 0.36, 0.29), 0.95)  # 风化灰泥
wood = mat('wood', (0.10, 0.08, 0.06), 0.9)  # 近黑梁木
stone = mat('stone', (0.35, 0.34, 0.33), 0.98)
roofm = mat('roof', (0.20, 0.16, 0.12), 0.92)  # 灰褐木瓦
door = mat('door', (0.14, 0.10, 0.07), 0.85)

W, D, H = 6.0, 5.0, 3.2          # 单位尺寸(Blender: x=宽 y=进深 z=高)
BASE = 0.5                        # 石基高
# 石基(略外扩)
box('Base', W + 0.24, D + 0.24, BASE, 0, 0, BASE / 2, stone)
# 墙体
box('Wall', W, D, H - BASE, 0, 0, BASE + (H - BASE) / 2, plaster)
# 角柱
for sx in (-1, 1):
    for sy in (-1, 1):
        box('Post', 0.18, 0.18, H - BASE, sx * (W / 2 - 0.02), sy * (D / 2 - 0.02), BASE + (H - BASE) / 2, wood)
# 横带(上下两道)
for z in (BASE + 0.1, H - 0.12):
    box('Band', W + 0.06, 0.14, 0.14, 0, -D / 2, z, wood)
    box('Band', W + 0.06, 0.14, 0.14, 0, D / 2, z, wood)
    box('Band', 0.14, D + 0.06, 0.14, -W / 2, 0, z, wood)
    box('Band', 0.14, D + 0.06, 0.14, W / 2, 0, z, wood)
# 正面斜撑(朝 -Y 是正面)
for sx in (-1, 1):
    box('Brace', 0.13, 0.1, 1.5, sx * (W / 4 + 0.55), -D / 2 - 0.01, BASE + 1.15, wood, ry=sx * 0.7)
# 门(正面中央)+ 门框
box('Door', 1.0, 0.08, 1.75, 0, -D / 2 - 0.05, BASE + 0.875, door)
box('Frame', 1.24, 0.12, 0.12, 0, -D / 2 - 0.04, BASE + 1.78, wood)
for sx in (-1, 1):
    box('Frame', 0.12, 0.12, 1.8, sx * 0.62, -D / 2 - 0.04, BASE + 0.9, wood)
# 窗(正面两扇 + 侧面各一)带框与窗台
def window(px, py, ry=0):
    box('Win', 0.7, 0.07, 0.7, px, py, BASE + 1.55, mat('glass', (0.12, 0.15, 0.18), 0.35), ry=ry)
    box('Sill', 0.9, 0.16, 0.1, px, py, BASE + 1.14, wood, ry=ry)
window(-W / 4 - 0.4, -D / 2 - 0.045)
window(W / 4 + 0.4, -D / 2 - 0.045)
# 屋顶:两坡叠瓦(逐排搭接的板条),出檐
import math
pitch = math.atan2(1.6, D / 2 + 0.35)
rows = 6
for side in (-1, 1):
    slope = math.hypot(D / 2 + 0.42, 1.7)
    for r in range(rows):
        t = r / rows
        y = side * (D / 2 + 0.38) * (1 - t) * 0.96
        z = H + t * 1.62
        row = box('Shingle', W + 0.55, slope / rows + 0.16, 0.09, 0, y, z, roofm)
        row.rotation_euler = (side * -pitch, 0, 0)
# 脊梁
box('Ridge', W + 0.6, 0.24, 0.18, 0, 0, H + 1.68, wood)
# 烟囱
box('Chimney', 0.5, 0.5, 1.6, W / 4, D / 6, H + 1.1, stone)
for ob in bpy.context.collection.objects:
    ob.select_set(True)
    for p in ob.data.polygons:
        p.use_smooth = False
# 合并为单对象多材质:一户人家只吃几次绘制调用
bpy.context.view_layer.objects.active = bpy.context.collection.objects[0]
bpy.ops.object.join()
bpy.context.active_object.name = 'House'
path = os.path.join(OUT, 'house.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'house.glb → {os.path.getsize(path) // 1024}KB')

def ball(name, r, px, py, pz, material, sx=1, sy=1, sz=1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=9, ring_count=6, location=(px, py, pz))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx, sy, sz)
    ob.data.materials.append(material)
    return ob


# ================= 市集道具:摊位 / 木桶 / 板条箱 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
wood2 = mat('wood', (0.16, 0.12, 0.09), 0.92)
plank = mat('plank', (0.24, 0.18, 0.12), 0.95)
canvas = mat('canvas', (0.52, 0.48, 0.40), 0.98)   # 未染帆布(诺德市集不用糖果篷)
ironb = mat('ironb', (0.18, 0.18, 0.20), 0.5)
sack = mat('sack', (0.38, 0.30, 0.20), 0.98)

# 摊位:板条柜台 + 立柱 + 下垂帆布篷(放样出中间的塌陷)+ 货物(麻袋/木箱)
for i in range(4):  # 柜台面四条板
    box('StallPlank', 2.4, 1.1 / 4 - 0.02, 0.08, 0, -0.55 + i * 0.275 + 0.14, 1.0, plank)
box('StallBody', 2.4, 1.05, 0.92, 0, 0, 0.48, wood2)
for sxx in (-1, 1):
    box('StallPost', 0.11, 0.11, 2.5, 1.12 * sxx, 0.42, 1.25, wood2)
# 帆布:横向 5 段放样,中段下垂
bm = bmesh.new()
rows = []
for i in range(6):
    x = -1.4 + i * (2.8 / 5)
    sag = -0.12 * math.sin(i / 5 * math.pi)
    a = bm.verts.new((x, 0.95, 2.5 + sag))
    b2 = bm.verts.new((x, -1.0, 1.9 + sag))
    rows.append((a, b2))
for i in range(5):
    bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
mesh = bpy.data.meshes.new('StallCanvas')
bm.to_mesh(mesh)
bm.free()
ob = bpy.data.objects.new('StallCanvas', mesh)
ob.data.materials.append(canvas)
bpy.context.collection.objects.link(ob)
# 货物:两只麻袋一只木箱
ball('StallSack', 0.24, -0.7, -0.1, 1.22, sack, sz=0.75)
ball('StallSack', 0.2, -0.25, 0.05, 1.2, sack, sz=0.7)
box('StallCrate', 0.5, 0.5, 0.4, 0.7, 0, 1.3, plank)
for ob2 in bpy.context.collection.objects:
    ob2.select_set(True)
    for p in ob2.data.polygons:
        p.use_smooth = ob2.name.startswith('StallSack')
bpy.context.view_layer.objects.active = bpy.context.collection.objects[0]
bpy.ops.object.join()
bpy.context.active_object.name = 'Stall'
# 木桶:鼓腹板条 + 双铁箍
bm = bmesh.new()
loops = []
for (z, r) in ((0, 0.30), (0.22, 0.35), (0.5, 0.37), (0.78, 0.35), (1.0, 0.30)):
    vs = [bm.verts.new((math.cos(a / 10 * math.pi * 2) * r, math.sin(a / 10 * math.pi * 2) * r, z)) for a in range(10)]
    loops.append(vs)
for li in range(len(loops) - 1):
    A, B = loops[li], loops[li + 1]
    for i in range(10):
        bm.faces.new((A[i], A[(i + 1) % 10], B[(i + 1) % 10], B[i]))
bm.faces.new(list(reversed(loops[0])))
bm.faces.new(loops[-1])
mesh = bpy.data.meshes.new('Barrel')
bm.to_mesh(mesh)
bm.free()
ob = bpy.data.objects.new('Barrel', mesh)
ob.data.materials.append(plank)
bpy.context.collection.objects.link(ob)
for z in (0.2, 0.8):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.355, minor_radius=0.022, major_segments=12, minor_segments=5, location=(0, 0, z))
    t = bpy.context.active_object
    t.name = 'BarrelHoop'
    t.data.materials.append(ironb)
for ob2 in bpy.context.collection.objects:
    ob2.select_set(ob2.name.startswith('Barrel'))
bpy.context.view_layer.objects.active = bpy.data.objects['Barrel']
bpy.ops.object.join()
bpy.context.active_object.name = 'Barrel'
path = os.path.join(OUT, 'props.glb')
# 只导出 Stall 与 Barrel
for ob2 in bpy.context.collection.objects:
    ob2.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'props.glb → {os.path.getsize(path) // 1024}KB')

# ================= 岩石 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
rockm = mat('rock', (0.5, 0.48, 0.46), 0.98)
rng = random.Random(42)
for i in range(3):
    bm = bmesh.new()
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
    for v in ret['verts']:
        # 分频扰动:大起伏 + 碎棱
        n = (rng.uniform(-0.22, 0.22) + rng.uniform(-0.1, 0.1))
        v.co *= (1 + n)
        if v.co.z < -0.5:
            v.co.z = -0.5  # 坐平
    mesh = bpy.data.meshes.new(f'Rock{i}')
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(f'Rock{i}', mesh)
    ob.location = (i * 3, 0, 0)
    ob.data.materials.append(rockm)
    for p in ob.data.polygons:
        p.use_smooth = False
    bpy.context.collection.objects.link(ob)
path = os.path.join(OUT, 'rocks.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'rocks.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
