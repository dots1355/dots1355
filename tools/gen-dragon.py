# Blender 资产工厂 · 霜龙篇
#   dragon.glb — 天际式霜龙(骨架感强的放样躯干、膜翼、背棘、双角):
#     Body — 躯干+颈+头+角+眼+背棘+四肢+尾(合并单对象,多材质)
#     WingL — 左翼(root 在原点,向 +X 展开;游戏里镜像出右翼,拍动=绕前轴旋转)
#   材质名: scale(鳞) dscale(腹) horn(角/棘) membrane(翼膜,双面) eye(眼)
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
scale_m = mat('scale', (0.40, 0.48, 0.54), 0.8)
horn_m = mat('horn', (0.14, 0.13, 0.12), 0.7)
memb_m = mat('membrane', (0.66, 0.75, 0.82), 0.9, double=True)
eye_m = mat('eye', (0.55, 0.9, 1.0), 0.2)


def loft(name, rings, material):
    """放样:rings = [(y前后, z高度, rx横径, rz竖径)],-Y 为前"""
    bm = bmesh.new()
    N = 10
    loops = []
    for (y, z, rx, rz) in rings:
        vs = [bm.verts.new((math.cos(a / N * 2 * math.pi) * rx, y,
                            z + math.sin(a / N * 2 * math.pi) * rz)) for a in range(N)]
        loops.append(vs)
    for i in range(len(loops) - 1):
        A, B = loops[i], loops[i + 1]
        for j in range(N):
            bm.faces.new((A[j], A[(j + 1) % N], B[(j + 1) % N], B[j]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.collection.objects.link(ob)
    return ob


# 躯干:尾尖(+Y 后)→ 髋 → 腹(最宽)→ 胸 → 肩
loft('Body', [
    (4.8, 1.05, 0.05, 0.05),
    (3.6, 1.02, 0.16, 0.14),
    (2.3, 1.0, 0.32, 0.28),
    (1.0, 1.05, 0.55, 0.5),
    (0.0, 1.15, 0.72, 0.62),
    (-1.0, 1.25, 0.64, 0.56),
    (-1.9, 1.35, 0.46, 0.42),
], scale_m)
# 颈:肩 → 昂起
loft('Neck', [
    (-1.9, 1.35, 0.32, 0.3),
    (-2.6, 1.75, 0.25, 0.23),
    (-3.15, 2.25, 0.2, 0.19),
    (-3.5, 2.6, 0.17, 0.16),
], scale_m)
# 头:楔形拉长
loft('Head', [
    (-3.45, 2.6, 0.23, 0.19),
    (-4.0, 2.56, 0.2, 0.15),
    (-4.5, 2.46, 0.12, 0.09),
    (-4.85, 2.4, 0.04, 0.035),
], scale_m)
# 双角:后掠
for sx in (-1, 1):
    bpy.ops.mesh.primitive_cone_add(radius1=0.07, depth=0.75, vertices=6,
                                    location=(sx * 0.18, -3.3, 2.9), rotation=(-0.95, 0, sx * 0.28))
    c = bpy.context.active_object
    c.name = 'Horn'
    c.data.materials.append(horn_m)
# 眼:霜蓝一对(命名 Eye* 供游戏换发光材质)
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, segments=8, ring_count=6,
                                         location=(sx * 0.15, -4.05, 2.62))
    e = bpy.context.active_object
    e.name = 'EyeL' if sx < 0 else 'EyeR'
    e.data.materials.append(eye_m)
# 背棘:沿脊一列
for (y, z, tilt) in [(3.4, 1.2, 0.6), (2.6, 1.28, 0.5), (1.8, 1.45, 0.4), (1.0, 1.62, 0.3),
                     (0.2, 1.78, 0.15), (-0.6, 1.85, 0), (-1.4, 1.82, -0.1),
                     (-2.3, 2.05, -0.3), (-2.95, 2.45, -0.45)]:
    bpy.ops.mesh.primitive_cone_add(radius1=0.09, depth=0.42, vertices=5,
                                    location=(0, y, z), rotation=(tilt, 0, 0))
    c = bpy.context.active_object
    c.name = 'Spike'
    c.data.materials.append(horn_m)
# 四肢:短粗蹲伏
for sx in (-1, 1):
    for (y, r) in ((0.9, 0.2), (-1.15, 0.22)):
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r * 0.55, depth=1.15, vertices=8,
                                        location=(sx * 0.58, y, 0.58))
        l = bpy.context.active_object
        l.name = 'Leg'
        l.data.materials.append(scale_m)
# 尾鳍:尾尖一片
bpy.ops.mesh.primitive_cone_add(radius1=0.22, depth=0.5, vertices=4, location=(0, 4.9, 1.1),
                                rotation=(1.5708, 0, 0))
tf = bpy.context.active_object
tf.name = 'TailFin'
tf.data.materials.append(horn_m)

# 左翼:root 在原点,三根指骨 + 膜,向 +X 展开(单独导出,游戏镜像出右翼)
bm = bmesh.new()
tips = [(3.3, -1.7, 0.35), (3.8, -0.3, 0.15), (3.2, 1.1, 0.05)]
root = bm.verts.new((0, 0, 0))
tv = [bm.verts.new(t) for t in tips]
for i in range(len(tv) - 1):
    bm.faces.new((root, tv[i], tv[i + 1]))
mesh = bpy.data.meshes.new('WingL')
bm.to_mesh(mesh)
bm.free()
wing = bpy.data.objects.new('WingL', mesh)
wing.data.materials.append(memb_m)
bpy.context.collection.objects.link(wing)
# 指骨:细锥从根到各指尖
for t in tips:
    L = math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2)
    bpy.ops.mesh.primitive_cone_add(radius1=0.045, radius2=0.015, depth=L, vertices=5,
                                    location=(t[0] / 2, t[1] / 2, t[2] / 2))
    b2 = bpy.context.active_object
    b2.name = 'WingLBone'
    b2.data.materials.append(horn_m)
    # 朝向指尖
    b2.rotation_mode = 'QUATERNION'
    from mathutils import Vector
    b2.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(t).normalized())

# 合并:WingL 家族一体,其余并入 Body
for ob in bpy.context.collection.objects:
    ob.select_set(ob.name.startswith('WingL'))
bpy.context.view_layer.objects.active = bpy.data.objects['WingL']
bpy.ops.object.join()
bpy.context.active_object.name = 'WingL'
for ob in bpy.context.collection.objects:
    ob.select_set(ob.name != 'WingL')
bpy.context.view_layer.objects.active = bpy.data.objects['Body']
bpy.ops.object.join()
bpy.context.active_object.name = 'Body'

path = os.path.join(OUT, 'dragon.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print(f'dragon.glb → {os.path.getsize(path) // 1024}KB')
print('DONE')
