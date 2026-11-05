# Blender 资产工厂 · 城堡与武器篇
#   keep.glb — 天际式灰岩主堡(单位 22×13×14,游戏原位放置):
#     阶梯式体量(大殿+中央高塔)/收分基座/阶梯扶壁/垛口 + 堞眼托架/深箭孔/尖拱窗/
#     前凸门楼(拱门 + 半升铁闸)/塔顶锥顶瞭望小塔;材质 stone dstone wood slit iron roof
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
# 坐标:Blender -Y 为正面(游戏 +Z,朝广场);局部原点在地面中心;单位 22×13×14(游戏原位放置)
# 体量:大殿 + 中央高塔;石材靠游戏里的平面投影贴图,这里给足结构:
#   收分基座 / 阶梯扶壁 / 层线石带 / 垛口 + 堞眼托架(machicolation)/ 深箭孔(暗色内衬 + 石框)/
#   中央塔尖拱窗 / 前凸门楼(拱门、半升铁闸、门楼垛口)
bpy.ops.wm.read_factory_settings(use_empty=True)
stone = mat('stone', (0.46, 0.45, 0.43), 0.98)
dstone = mat('dstone', (0.36, 0.35, 0.34), 0.98)
woodm = mat('wood', (0.12, 0.09, 0.07), 0.9)
slit = mat('slit', (0.02, 0.02, 0.025), 1.0)
ironm = mat('iron', (0.2, 0.2, 0.22), 0.5, 0.7)
roofk = mat('roof', (0.22, 0.24, 0.27), 0.85)

W, D, H = 22.0, 14.0, 13.0
HALL = H * 0.62
# 大殿体量(底部收分:基座外扩)
box('Plinth', W + 1.6, D + 1.6, 2.2, 0, 0, 1.1, dstone)
box('PlinthCap', W + 1.2, D + 1.2, 0.35, 0, 0, 2.3, dstone)
box('Hall', W, D, HALL, 0, 0, HALL / 2, stone)
# 中央高塔体量
TW, TD = W * 0.46, D * 0.7
box('Tower', TW, TD, H, 0, 0, H * 0.5, stone)
# 石带(层线)
for z in (H * 0.30,):
    box('Band', W + 0.5, D + 0.5, 0.35, 0, 0, z, dstone)
box('BandT', TW + 0.5, TD + 0.5, 0.35, 0, 0, H * 0.8, dstone)


def crenellate(w, d, z, step=1.8, skip_front=None):
    """垛口一圈 + 护墙;skip_front=(x0,x1) 时正面这段让给门楼"""
    box('Parapet', w + 0.5, 0.5, 0.8, 0, -d / 2 - 0.05, z - 0.65, stone)
    box('Parapet', w + 0.5, 0.5, 0.8, 0, d / 2 + 0.05, z - 0.65, stone)
    box('Parapet', 0.5, d + 0.5, 0.8, -w / 2 - 0.05, 0, z - 0.65, stone)
    box('Parapet', 0.5, d + 0.5, 0.8, w / 2 + 0.05, 0, z - 0.65, stone)
    nx = int(w / step)
    for i in range(nx + 1):
        x = -w / 2 + i * (w / nx)
        if not (skip_front and skip_front[0] < x < skip_front[1]):
            box('Merlon', 0.9, 0.55, 0.9, x, -d / 2 - 0.05, z + 0.2, stone)
        box('Merlon', 0.9, 0.55, 0.9, x, d / 2 + 0.05, z + 0.2, stone)
    nz = int(d / step)
    for i in range(nz + 1):
        y = -d / 2 + i * (d / nz)
        box('Merlon', 0.55, 0.9, 0.9, -w / 2 - 0.05, y, z + 0.2, stone)
        box('Merlon', 0.55, 0.9, 0.9, w / 2 + 0.05, y, z + 0.2, stone)


def machicolate(w, d, z, step=1.1, faces=('front', 'back', 'left', 'right')):
    """堞眼:护墙下一排外挑托架(读出"城堡"的关键剪影)"""
    for face in faces:
        L = w if face in ('front', 'back') else d
        n = int(L / step)
        for i in range(n + 1):
            u = -L / 2 + i * (L / n)
            if face == 'front':
                box('Corbel', 0.32, 0.6, 0.55, u, -d / 2 - 0.12, z, dstone)
            elif face == 'back':
                box('Corbel', 0.32, 0.6, 0.55, u, d / 2 + 0.12, z, dstone)
            elif face == 'left':
                box('Corbel', 0.6, 0.32, 0.55, -w / 2 - 0.12, u, z, dstone)
            else:
                box('Corbel', 0.6, 0.32, 0.55, w / 2 + 0.12, u, z, dstone)


crenellate(W, D, HALL + 0.5, skip_front=(-3.6, 3.6))
crenellate(TW, TD, H + 0.5)
machicolate(TW, TD, H - 0.55)

# 阶梯扶壁:大殿正面/背面/两侧,下宽上窄,顶部斜收
def buttress(x, y, nx, ny):
    for (h, out, wdt) in ((3.8, 1.0, 1.1), (6.4, 0.6, 0.85)):
        bx = x + nx * out / 2
        by = y + ny * out / 2
        if nx:
            box('Buttress', out, wdt, h, bx, by, h / 2, stone)
        else:
            box('Buttress', wdt, out, h, bx, by, h / 2, stone)
    # 斜收的盖石
    if nx:
        box('ButtCap', 0.75, 0.9, 0.5, x + nx * 0.42, y, 6.55, dstone, ry=-nx * 0.6)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y + ny * 0.42, 6.55), rotation=(ny * 0.6, 0, 0))
        ob = bpy.context.active_object
        ob.name = 'ButtCap'
        ob.scale = (0.9, 0.75, 0.5)
        ob.data.materials.append(dstone)


for x in (-W * 0.36, -W * 0.18, W * 0.18, W * 0.36):
    if abs(x) > 5.5:  # 正面中段让给门楼
        buttress(x, -D / 2, 0, -1)
    buttress(x, D / 2, 0, 1)
for y in (-D * 0.22, D * 0.22):
    buttress(-W / 2, y, -1, 0)
    buttress(W / 2, y, 1, 0)


# 箭孔:暗色内衬 + 上下石框(正面/背面/两侧,两层)
def arrow_slit(x, y, z, face, h=1.7):
    if face in ('front', 'back'):
        s = -1 if face == 'front' else 1
        box('Slit', 0.22, 0.12, h, x, y + s * 0.02, z, slit)
        box('SlitFrame', 0.6, 0.2, 0.18, x, y + s * 0.06, z + h / 2 + 0.06, dstone)
        box('SlitFrame', 0.6, 0.2, 0.18, x, y + s * 0.06, z - h / 2 - 0.06, dstone)
        box('SlitCross', 0.62, 0.12, 0.14, x, y + s * 0.02, z, slit)
    else:
        s = -1 if face == 'left' else 1
        box('Slit', 0.12, 0.22, h, x + s * 0.02, y, z, slit)
        box('SlitFrame', 0.2, 0.6, 0.18, x + s * 0.06, y, z + h / 2 + 0.06, dstone)
        box('SlitFrame', 0.2, 0.6, 0.18, x + s * 0.06, y, z - h / 2 - 0.06, dstone)
        box('SlitCross', 0.12, 0.62, 0.14, x + s * 0.02, y, z, slit)


for x in (-W * 0.27, -W * 0.09, W * 0.09, W * 0.27):
    if abs(x) > 4.5:
        arrow_slit(x, -D / 2, 4.6, 'front')
    arrow_slit(x, D / 2, 4.6, 'back')
for y in (-D * 0.1, D * 0.33):
    arrow_slit(-W / 2, y, 4.6, 'left')
    arrow_slit(W / 2, y, 4.6, 'right')
for x in (-TW * 0.28, TW * 0.28):
    arrow_slit(x, TD / 2, H * 0.68, 'back', 1.5)


# 中央塔:正面一对尖拱窗(深色玻璃 + 石框 + 拱心)
def lancet(x, y, z, w=0.9, h=2.1):
    box('Lancet', w, 0.12, h, x, y - 0.03, z, slit)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=w / 2, depth=0.12, location=(x, y - 0.03, z + h / 2),
                                        rotation=(math.pi / 2, 0, 0))
    a = bpy.context.active_object
    a.name = 'LancetArch'
    a.data.materials.append(slit)
    box('LancetSill', w + 0.4, 0.3, 0.16, x, y - 0.12, z - h / 2 - 0.08, dstone)
    for sx in (-1, 1):
        box('LancetJamb', 0.18, 0.2, h, x + sx * (w / 2 + 0.09), y - 0.06, z, dstone)
    box('LancetKey', 0.3, 0.22, 0.34, x, y - 0.08, z + h / 2 + w / 2 + 0.1, dstone)


for x in (-3.9, 3.9):
    lancet(x, -TD / 2, H * 0.66)

# 门楼:正面凸出,两侧方柱 + 拱门 + 半升铁闸 + 顶部垛口与堞眼
GW, GD, GH = 6.4, 1.4, 9.6
gy = -D / 2 - GD / 2 + 0.2
box('Gatehouse', GW, GD + 0.4, GH, 0, gy, GH / 2, stone)
for sx in (-1, 1):
    box('GatePier', 1.4, GD + 0.9, GH + 0.4, sx * (GW / 2 - 0.5), gy - 0.15, (GH + 0.4) / 2, stone)
    box('GatePierCap', 1.6, GD + 1.1, 0.3, sx * (GW / 2 - 0.5), gy - 0.15, GH + 0.5, dstone)
gfront = gy - (GD + 0.4) / 2
# 拱门:暗色门洞 + 半圆拱 + 拱石
box('GateHole', 3.4, 0.2, 4.0, 0, gfront - 0.02, 2.0, woodm)  # 铁闸后的橡木大门
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=1.7, depth=0.2, location=(0, gfront - 0.02, 4.0),
                                    rotation=(math.pi / 2, 0, 0))
a = bpy.context.active_object
a.name = 'GateArch'
a.data.materials.append(woodm)
for i in range(9):  # 拱石一圈
    t = math.pi * i / 8
    box('Voussoir', 0.42, 0.3, 0.55, math.cos(t) * 2.05, gfront - 0.1, 4.0 + math.sin(t) * 2.05, dstone, ry=-(t - math.pi / 2))
for sx in (-1, 1):
    box('GateJamb', 0.5, 0.3, 4.0, sx * 1.95, gfront - 0.1, 2.0, dstone)
# 铁闸:半升(下缘离地 2.6m),竖条 + 横条
for i in range(7):
    x = -1.5 + i * 0.5
    box('Portcullis', 0.09, 0.09, 2.6, x, gfront - 0.16, 4.1, ironm)
    box('PortSpike', 0.07, 0.07, 0.25, x, gfront - 0.16, 2.72, ironm)
for z in (3.0, 3.8, 4.6, 5.3):
    box('Portcullis', 3.2, 0.09, 0.09, 0, gfront - 0.18, z, ironm)
# 门楼顶:堞眼托架 + 垛口
for i in range(8):
    x = -GW / 2 + 0.4 + i * (GW - 0.8) / 7
    box('Corbel', 0.32, 0.6, 0.55, x, gfront - 0.25, GH - 0.6, dstone)
box('GateParapet', GW + 0.3, 0.55, 0.9, 0, gfront - 0.3, GH + 0.1, stone)
for i in range(5):
    x = -GW / 2 + 0.6 + i * (GW - 1.2) / 4
    box('Merlon', 0.95, 0.55, 0.85, x, gfront - 0.3, GH + 0.95, stone)
# 门楼上方纹章石板
box('Crest', 1.6, 0.14, 1.9, 0, gfront - 0.06, 6.9, dstone)
box('CrestInner', 1.2, 0.08, 1.45, 0, gfront - 0.12, 6.9, slit)
# 中央塔顶:一座带锥顶的瞭望小塔(屋顶材质)
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=1.25, depth=2.6, location=(TW / 2 - 1.4, TD / 2 - 1.4, H + 1.6))
c = bpy.context.active_object
c.name = 'Turret'
c.data.materials.append(stone)
bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=1.6, depth=2.6, location=(TW / 2 - 1.4, TD / 2 - 1.4, H + 4.2))
c = bpy.context.active_object
c.name = 'TurretRoof'
c.data.materials.append(roofk)

# 合并(应用变换 → 单对象多材质;游戏里按材质拆件、按面重算法线)
for ob in bpy.context.collection.objects:
    ob.select_set(True)
bpy.context.view_layer.objects.active = bpy.context.collection.objects[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for ob in bpy.context.collection.objects:
    for p in ob.data.polygons:
        p.use_smooth = False
bpy.ops.object.join()
bpy.context.active_object.name = 'Keep'
path = os.path.join(OUT, 'keep.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                          export_texcoords=False, export_normals=False)
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
