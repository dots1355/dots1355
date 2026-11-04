# Blender 资产工厂 · 霜龙篇
#   dragon.glb — 天际式霜龙(骨架感强的放样躯干、膜翼、背棘、双角):
#     Body — 躯干(厚胸)+颈+头(上下颌、牙、眉骨、颊刺)+两段弯角+背棘+两节四肢与爪+尾鳍(合并单对象,多材质);
#            EyeL/EyeR 作为 Body 的子对象保留名字(游戏换发光材质)
#     WingL — 左翼:肩→肘→腕臂骨 + 四根指骨 + 扇贝边翼膜(root 在原点,向 +X 展开;游戏镜像出右翼,拍动=绕前轴旋转)
#   材质名: scale(背鳞,深青灰) belly(腹鳞,骨白) horn(角/棘/爪) membrane(翼膜,双面) eye(眼) tooth(牙)
#   坐标契约: Blender -Y 为前 → glTF +Z 为前;肩关节 Blender(±0.55,-1.8,1.35) → glTF(±0.55,1.35,1.8)
# 用法: python3 tools/gen-dragon.py
import bpy
import bmesh
import math
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


def mat(name, color, rough=0.85, double=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if double:
        m.use_backface_culling = False
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
scale_m = mat('scale', (0.075, 0.1, 0.13), 0.7)       # 背鳞:深青灰(线性色)
belly_m = mat('belly', (0.42, 0.44, 0.41), 0.85)      # 腹鳞:骨白(双色)
horn_m = mat('horn', (0.06, 0.05, 0.045), 0.6)
memb_m = mat('membrane', (0.12, 0.16, 0.2), 0.85, double=True)
eye_m = mat('eye', (0.55, 0.9, 1.0), 0.2)
tooth_m = mat('tooth', (0.86, 0.84, 0.76), 0.6)
N = 12


def loft(name, rings, top=scale_m, bottom=belly_m, cut=-0.35):
    """放样:rings = [(y前后, z高度, rx横径, rz竖径)],-Y 为前;下半圈(sin<cut)用腹鳞材质"""
    bm = bmesh.new()
    loops = []
    for (y, z, rx, rz) in rings:
        vs = [bm.verts.new((math.cos(a / N * 2 * math.pi) * rx, y,
                            z + math.sin(a / N * 2 * math.pi) * rz)) for a in range(N)]
        loops.append(vs)
    faces = []
    for i in range(len(loops) - 1):
        A, B = loops[i], loops[i + 1]
        for j in range(N):
            f = bm.faces.new((A[j], A[(j + 1) % N], B[(j + 1) % N], B[j]))
            faces.append(math.sin((j + 0.5) / N * 2 * math.pi) < cut)
    bm.faces.new(list(reversed(loops[0])))
    faces.append(False)
    bm.faces.new(loops[-1])
    faces.append(False)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(top)
    ob.data.materials.append(bottom)
    for p, low in zip(ob.data.polygons, faces):
        p.material_index = 1 if low else 0
        p.use_smooth = True
    bpy.context.collection.objects.link(ob)
    return ob


def cone(name, r1, r2, depth, loc, rot, material, verts=6):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    c = bpy.context.active_object
    c.name = name
    c.data.materials.append(material)
    return c


def bone_between(name, a, b, r1, r2, material, verts=6):
    from mathutils import Vector
    A, B = Vector(a), Vector(b)
    v = B - A
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=v.length, vertices=verts, location=(A + B) / 2)
    c = bpy.context.active_object
    c.name = name
    c.rotation_mode = 'QUATERNION'
    c.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(v.normalized())
    c.data.materials.append(material)
    return c


# 躯干:尾尖(+Y 后)→ 髋 → 腹 → 厚实的胸 → 肩(胸廓前探,龙的力量在前半身)
loft('Body', [
    (5.2, 1.0, 0.04, 0.04),
    (4.2, 1.02, 0.12, 0.11),
    (3.0, 1.0, 0.26, 0.24),
    (1.8, 1.04, 0.48, 0.44),
    (0.7, 1.12, 0.66, 0.6),
    (-0.3, 1.24, 0.8, 0.74),
    (-1.1, 1.36, 0.78, 0.76),
    (-1.8, 1.48, 0.58, 0.56),
    (-2.2, 1.62, 0.4, 0.4),
])
# 颈:肩 → 昂起(S 形)
loft('Neck', [
    (-2.1, 1.6, 0.4, 0.38),
    (-2.6, 1.95, 0.3, 0.29),
    (-3.05, 2.4, 0.24, 0.23),
    (-3.35, 2.75, 0.21, 0.2),
    (-3.55, 2.95, 0.21, 0.2),
])
# 头:颅 → 吻(楔形),上颌
loft('Head', [
    (-3.45, 2.98, 0.27, 0.24),
    (-3.85, 3.0, 0.25, 0.2),
    (-4.3, 2.94, 0.18, 0.14),
    (-4.75, 2.86, 0.12, 0.09),
    (-5.05, 2.82, 0.06, 0.05),
], cut=-0.2)
# 下颌:微张,露出牙
loft('Jaw', [
    (-3.6, 2.82, 0.2, 0.08),
    (-4.1, 2.68, 0.16, 0.07),
    (-4.6, 2.58, 0.1, 0.05),
    (-4.9, 2.55, 0.05, 0.03),
], top=scale_m, bottom=belly_m, cut=0.2)
for sx in (-1, 1):
    for k, (y, z) in enumerate(((-4.15, 2.76), (-4.45, 2.74), (-4.75, 2.72))):
        cone('Tooth', 0.025, 0.0, 0.11, (sx * (0.13 - k * 0.03), y, z - 0.03), (math.pi, 0, 0), tooth_m, 4)
# 眉骨 + 鼻孔 + 颊刺
for sx in (-1, 1):
    bone_between('Brow', (sx * 0.12, -3.75, 3.16), (sx * 0.2, -4.2, 3.04), 0.06, 0.03, horn_m)
    bone_between('Cheek', (sx * 0.22, -3.6, 2.9), (sx * 0.5, -3.2, 2.8), 0.05, 0.0, horn_m)
    cone('Nostril', 0.028, 0.0, 0.06, (sx * 0.05, -5.0, 2.86), (0.4, 0, 0), horn_m, 5)
# 双角:两段后掠上翘
for sx in (-1, 1):
    bone_between('Horn', (sx * 0.17, -3.5, 3.15), (sx * 0.32, -3.0, 3.42), 0.08, 0.055, horn_m)
    bone_between('Horn', (sx * 0.32, -3.0, 3.42), (sx * 0.38, -2.45, 3.82), 0.055, 0.0, horn_m)
# 眼:霜蓝一对(独立对象挂在 Body 下,游戏按名字 Eye* 换发光材质)
eyes = []
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, segments=8, ring_count=6,
                                         location=(sx * 0.2, -4.0, 3.04))
    e = bpy.context.active_object
    e.name = 'EyeL' if sx < 0 else 'EyeR'
    e.data.materials.append(eye_m)
    eyes.append(e)
# 背棘:沿脊一列(颈部到尾尖渐小)
for (y, z, tilt, h) in [(4.4, 1.12, 0.7, 0.3), (3.6, 1.24, 0.6, 0.38), (2.8, 1.36, 0.5, 0.46), (2.0, 1.56, 0.4, 0.52),
                        (1.2, 1.8, 0.3, 0.56), (0.4, 2.0, 0.2, 0.58), (-0.4, 2.1, 0.1, 0.58), (-1.2, 2.14, 0.0, 0.52),
                        (-1.9, 2.06, -0.1, 0.44), (-2.55, 2.25, -0.3, 0.36), (-3.05, 2.65, -0.45, 0.3)]:
    cone('Spike', 0.1, 0.0, h, (0, y, z), (tilt, 0, 0), horn_m, 5)
# 四肢:大腿 + 小腿 + 爪(前肢更粗)
for sx in (-1, 1):
    for (y, r) in ((1.3, 0.24), (-1.25, 0.27)):
        hip = (sx * 0.6, y, 1.1)
        knee = (sx * 0.78, y - 0.35, 0.55)
        foot = (sx * 0.74, y - 0.05, 0.1)
        bone_between('Thigh', hip, knee, r, r * 0.7, scale_m, 8)
        bone_between('Shin', knee, foot, r * 0.62, r * 0.45, scale_m, 8)
        for k in (-1, 0, 1):
            bone_between('Claw', (foot[0] + k * 0.09, foot[1] - 0.05, 0.08),
                         (foot[0] + k * 0.14, foot[1] - 0.32, 0.0), 0.045, 0.0, horn_m, 4)
# 尾锤:尾尖两片骨鳍
for sx in (-1, 1):
    bone_between('TailFin', (0, 5.0, 1.0), (sx * 0.35, 5.45, 1.05), 0.06, 0.0, horn_m, 4)
bone_between('TailFin', (0, 4.9, 1.04), (0, 5.5, 1.0), 0.08, 0.0, horn_m, 4)

# ---- 左翼:臂骨(肩→肘→腕)+ 四根指骨 + 扇贝边翼膜(两指之间的后缘向内收) ----
# root 在原点(肩关节),向 +X 展开,前缘朝 -Y;游戏镜像出右翼,拍动 = 绕前后轴旋转
ELBOW = (1.5, -0.55, 0.32)
WRIST = (2.85, -1.0, 0.42)
TIPS = [(5.3, -0.95, 0.48), (5.1, 0.55, 0.28), (4.25, 1.75, 0.1), (2.85, 2.55, -0.05)]
BODY_ATTACH = (0.25, 2.4, -0.15)
bone_between('WingArm', (0, 0, 0), ELBOW, 0.13, 0.09, scale_m, 8)
bone_between('WingArm', ELBOW, WRIST, 0.09, 0.07, scale_m, 8)
for t in TIPS:
    bone_between('WingFinger', WRIST, t, 0.06, 0.016, horn_m, 6)
bone_between('WingThumb', WRIST, (WRIST[0] + 0.15, WRIST[1] - 0.4, WRIST[2] + 0.1), 0.05, 0.0, horn_m, 5)


def scallop(a, b, depth, n=5, sag=0.12):
    """两指尖之间的后缘:向腕部内收的弧线(扇贝边),中段略下垂"""
    from mathutils import Vector
    A, B, W = Vector(a), Vector(b), Vector(WRIST)
    pts = []
    for i in range(1, n):
        t = i / n
        p = A.lerp(B, t)
        inward = (W - p)
        inward.z = 0
        p = p + inward.normalized() * depth * math.sin(t * math.pi)
        p.z -= sag * math.sin(t * math.pi)
        pts.append(tuple(p))
    return pts


outline = [(0, 0, 0), ELBOW, WRIST, TIPS[0]]
for i in range(len(TIPS) - 1):
    outline += scallop(TIPS[i], TIPS[i + 1], 0.55 + 0.1 * i)
    outline.append(TIPS[i + 1])
outline += scallop(TIPS[-1], BODY_ATTACH, 0.7, n=6, sag=0.18)
outline.append(BODY_ATTACH)
bm = bmesh.new()
vs = [bm.verts.new(p) for p in outline]
face = bm.faces.new(vs)
bmesh.ops.triangulate(bm, faces=[face], quad_method='BEAUTY', ngon_method='BEAUTY')
# 翼膜下垂:每个顶点按到最近骨的距离轻微下沉(骨间鼓出一点弧度)
mesh = bpy.data.meshes.new('WingL')
bm.to_mesh(mesh)
bm.free()
wing = bpy.data.objects.new('WingL', mesh)
wing.data.materials.append(memb_m)
bpy.context.collection.objects.link(wing)

# 合并:WingL 家族一体;眼睛单独挂在 Body 下(保留名字),其余并入 Body
for ob in bpy.context.collection.objects:
    ob.select_set(ob.name.startswith('Wing'))
bpy.context.view_layer.objects.active = bpy.data.objects['WingL']
bpy.ops.object.join()
bpy.context.active_object.name = 'WingL'
for ob in bpy.context.collection.objects:
    ob.select_set(ob.name != 'WingL' and not ob.name.startswith('Eye'))
bpy.context.view_layer.objects.active = bpy.data.objects['Body']
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'Body'
for e in eyes:
    e.parent = body

path = os.path.join(OUT, 'dragon.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'dragon.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
