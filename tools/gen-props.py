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
