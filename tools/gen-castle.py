# Blender 资产工厂 · 城堡与武器篇
#   keep.glb — 天际式灰岩主堡(单位 22×13×14,游戏原位缩放):
#     阶梯式体量(大殿+中央高塔)/底部收分/垛口护墙/箭窗/大拱门/石带
#   weapons.glb — 铁剑 Sword / 巨剑 Greatsword / 短匕 Dagger / 猎弓 Bow
#     (刃开血槽、缠柄、铁护手;比例按游戏原盒剑长度)
# 用法: python3 tools/gen-castle.py
import bpy
import bmesh
import math
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


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


def box(name, sx, sy, sz, px, py, pz, material, ry=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(px, py, pz), rotation=(0, 0, ry))
    ob = bpy.context.active_object
    ob.name = name
    ob.dimensions = (sx, sy, sz)
    ob.data.materials.append(material)
    return ob


# ================= 主堡 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
stone = mat('stone', (0.34, 0.33, 0.32), 0.98)
dstone = mat('dstone', (0.24, 0.23, 0.23), 0.98)
woodm = mat('wood', (0.12, 0.09, 0.07), 0.9)

W, D, H = 22.0, 14.0, 13.0
# 大殿体量(底部收分:基座外扩)
box('Plinth', W + 1.6, D + 1.6, 2.2, 0, 0, 1.1, dstone)
box('Hall', W, D, H * 0.62, 0, 0, H * 0.31, stone)
# 中央高塔体量
box('Tower', W * 0.46, D * 0.7, H, 0, 0, H * 0.5, stone)
# 石带(层线)
for z in (H * 0.30, H * 0.58):
    box('Band', W + 0.5, D + 0.5, 0.35, 0, 0, z, dstone)
box('BandT', W * 0.46 + 0.5, D * 0.7 + 0.5, 0.35, 0, 0, H * 0.8, dstone)
# 大殿垛口(顶缘四周)
def crenellate(w, d, z, step=1.8):
    nx = int(w / step)
    for i in range(nx + 1):
        x = -w / 2 + i * (w / nx)
        box('Merlon', 0.9, 0.7, 1.0, x, -d / 2, z, stone)
        box('Merlon', 0.9, 0.7, 1.0, x, d / 2, z, stone)
    nz = int(d / step)
    for i in range(nz + 1):
        y = -d / 2 + i * (d / nz)
        box('Merlon', 0.7, 0.9, 1.0, -w / 2, y, z, stone)
        box('Merlon', 0.7, 0.9, 1.0, w / 2, y, z, stone)
crenellate(W, D, H * 0.62 + 0.5)
crenellate(W * 0.46, D * 0.7, H + 0.5)
# 箭窗(正面 -Y)
for x in (-W * 0.32, -W * 0.12, W * 0.12, W * 0.32):
    box('Slit', 0.5, 0.3, 2.2, x, -D / 2 - 0.05, H * 0.42, dstone)
for x in (-W * 0.15, W * 0.15):
    box('Slit', 0.5, 0.3, 2.0, x, -D * 0.35 - 0.05, H * 0.75, dstone)
# 大拱门(正面):门洞框 + 木门
box('Arch', 4.6, 0.8, 6.0, 0, -D / 2 - 0.2, 3.0, dstone)
box('Gate', 3.4, 0.4, 5.2, 0, -D / 2 - 0.45, 2.6, woodm)
# 合并
for ob in bpy.context.collection.objects:
    ob.select_set(True)
    for p in ob.data.polygons:
        p.use_smooth = False
bpy.context.view_layer.objects.active = bpy.context.collection.objects[0]
bpy.ops.object.join()
bpy.context.active_object.name = 'Keep'
path = os.path.join(OUT, 'keep.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'keep.glb → {os.path.getsize(path) // 1024}KB')

# ================= 武器 =================
bpy.ops.wm.read_factory_settings(use_empty=True)
steel = mat('steel', (0.62, 0.64, 0.68), 0.35, 0.9)
iron = mat('iron', (0.35, 0.35, 0.38), 0.5, 0.85)
grip = mat('grip', (0.16, 0.11, 0.08), 0.95)
gold = mat('gold', (0.65, 0.5, 0.18), 0.4, 0.9)
bowwood = mat('bowwood', (0.24, 0.17, 0.11), 0.85)


def blade(name, length, width, thick, tip=0.18):
    """带血槽的剑刃:放样 6 环(刃根→刃身→收锋)"""
    bm = bmesh.new()
    half = width / 2
    prof = [(-half, 0), (-half * 0.55, thick / 2), (0, thick * 0.32), (half * 0.55, thick / 2),
            (half, 0), (half * 0.55, -thick / 2), (0, -thick * 0.32), (-half * 0.55, -thick / 2)]
    loops = []
    for (t, scale) in ((0, 1), (0.75, 0.92), (1 - tip, 0.8), (1, 0.05)):
        vs = [bm.verts.new((x * scale, y * scale, -t * length)) for (x, y) in prof]
        loops.append(vs)
    for li in range(len(loops) - 1):
        A, B = loops[li], loops[li + 1]
        for i in range(len(prof)):
            bm.faces.new((A[i], A[(i + 1) % len(prof)], B[(i + 1) % len(prof)], B[i]))
    bm.faces.new(list(reversed(loops[0])))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(steel)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.collection.objects.link(ob)
    return ob


def hilt(parent_name, guard_w, grip_len, pommel_r, gy=0):
    box(parent_name + 'Guard', guard_w, 0.05, 0.055, 0, 0, gy + 0.028, iron)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.028, depth=grip_len, vertices=8,
                                        location=(0, 0, gy + grip_len / 2 + 0.05))
    g = bpy.context.active_object
    g.name = parent_name + 'Grip'
    g.data.materials.append(grip)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=pommel_r, segments=8, ring_count=6,
                                         location=(0, 0, gy + grip_len + 0.09))
    p = bpy.context.active_object
    p.name = parent_name + 'Pommel'
    p.data.materials.append(gold)


def join_as(name):
    for ob in bpy.context.collection.objects:
        ob.select_set(ob.name.startswith(name))
    sel = [o for o in bpy.context.collection.objects if o.name.startswith(name)]
    bpy.context.view_layer.objects.active = sel[0]
    bpy.ops.object.join()
    bpy.context.active_object.name = name


# 铁剑(刃长 0.75,握持点在原点、刃朝 -Z:游戏中挂进手部枢轴后旋转即可)
blade('Sword', 0.72, 0.075, 0.03)
hilt('Sword', 0.2, 0.16, 0.035)
join_as('Sword')
# 巨剑
blade('Greatsword', 1.05, 0.1, 0.04)
hilt('Greatsword', 0.26, 0.26, 0.045)
join_as('Greatsword')
# 短匕
blade('Dagger', 0.34, 0.05, 0.02, tip=0.3)
hilt('Dagger', 0.12, 0.1, 0.024)
join_as('Dagger')
# 反曲猎弓:弓臂放样(上下对称弯曲)+ 缠柄 + 弦
bm = bmesh.new()
segs = 14
pts = []
for i in range(segs + 1):
    t = i / segs - 0.5           # -0.5..0.5
    z = t * 1.1
    y = -math.cos(t * math.pi) * 0.16 - abs(t) * 0.05  # 反曲
    pts.append((y, z))
loops = []
for (y, z) in pts:
    r = 0.02 * (1 - abs(z) * 0.9) + 0.008
    vs = [bm.verts.new((math.cos(a / 6 * math.pi * 2) * r, y + math.sin(a / 6 * math.pi * 2) * r, z)) for a in range(6)]
    loops.append(vs)
for li in range(len(loops) - 1):
    A, B = loops[li], loops[li + 1]
    for i in range(6):
        bm.faces.new((A[i], A[(i + 1) % 6], B[(i + 1) % 6], B[i]))
mesh = bpy.data.meshes.new('Bow')
bm.to_mesh(mesh)
bm.free()
ob = bpy.data.objects.new('Bow', mesh)
ob.data.materials.append(bowwood)
for p in ob.data.polygons:
    p.use_smooth = True
bpy.context.collection.objects.link(ob)
box('BowGrip', 0.05, 0.05, 0.16, 0, -0.21, 0, grip)
box('BowString', 0.006, 0.006, 1.06, 0, -0.02, 0, iron)
join_as('Bow')
path = os.path.join(OUT, 'weapons.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'weapons.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
