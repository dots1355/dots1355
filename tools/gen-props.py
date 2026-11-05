# Blender 资产工厂 · 建筑与岩石篇
#   house.glb — 三种诺德民居户型(局部原点在地面中心,正面朝 -Y → 游戏 +Z;占地约 6×5,游戏按需缩放):
#     HouseA  平房:石基 / 抹灰墙 + 深色木构架(角柱、腰梁、立筋、斜撑)/ 窗框 + 十字棂 + 开启的百叶窗 /
#             檐口出挑的两坡叠瓦顶 + 封檐板 / 门框 + 门檐 / 石烟囱
#     HouseB  两层街屋:石砌底层 + 上层木构架外挑(楼板梁头外露)/ 山墙朝街的陡坡顶 / 山尖小窗
#     HouseC  长屋作坊:矮石基 + 横板木墙 / 前廊(三根廊柱,前坡顶顺势延伸)/ 侧墙柴垛
#     材质名: plaster wood stone roof door glass plank(游戏按名字换成带贴图的共享材质,屋顶颜色按户随机)
#   props.glb — 市集摊位 / 木桶
#   rocks.glb — 三块侵蚀岩(棱面平直着色,底部坐平;游戏取几何体入池自行调色)
# 用法: /usr/bin/python3 tools/gen-props.py
import bpy
import bmesh
import random
import os
import math
from mathutils import Vector

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
    ob.scale = (sx, sy, sz)
    ob.data.materials.append(material)
    return ob


# ================= 民居(三种户型) =================
bpy.ops.wm.read_factory_settings(use_empty=True)
plaster = mat('plaster', (0.62, 0.58, 0.50), 0.95)
wood = mat('wood', (0.16, 0.11, 0.08), 0.9)     # 深色梁木
stone = mat('stone', (0.42, 0.41, 0.40), 0.98)
roofm = mat('roof', (0.30, 0.20, 0.15), 0.92)
door = mat('door', (0.22, 0.15, 0.10), 0.85)
glass = mat('glass', (0.10, 0.12, 0.14), 0.35)
plank = mat('plank', (0.36, 0.27, 0.19), 0.92)  # 横板木墙(比梁木浅)

PARTS = []


def part(ob, material):
    ob.data.materials.clear()
    ob.data.materials.append(material)
    PARTS.append(ob)
    return ob


def blk(sx, sy, sz, px, py, pz, material, rx=0.0, ry=0.0, rz=0.0):
    """轴对齐(可带旋转)的方块:尺寸 + 中心"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(px, py, pz), rotation=(rx, ry, rz))
    ob = bpy.context.active_object
    ob.scale = (sx, sy, sz)
    return part(ob, material)


def beam(p0, p1, t, material, t2=None):
    """两点之间的方木(斜撑、封檐板)"""
    a, b = Vector(p0), Vector(p1)
    v = b - a
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.scale = (t, t2 or t, v.length)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(v.normalized())
    return part(ob, material)


def poly_mesh(verts, faces, material):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    me = bpy.data.meshes.new('m')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('p', me)
    bpy.context.collection.objects.link(ob)
    return part(ob, material)


def prism_x(x0, x1, tri, material):
    """沿 X 拉伸的三角柱(山墙):tri=[(y,z)×3]"""
    v = [(x0, y, z) for (y, z) in tri] + [(x1, y, z) for (y, z) in tri]
    return poly_mesh(v, [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)], material)


def prism_y(y0, y1, tri, material):
    """沿 Y 拉伸的三角柱:tri=[(x,z)×3]"""
    v = [(x, y0, z) for (x, z) in tri] + [(x, y1, z) for (x, z) in tri]
    return poly_mesh(v, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], material)


# ---- 墙面构件:face 为 'front'(-Y)/'back'(+Y)/'left'(-X)/'right'(+X);u 为沿墙横坐标 ----
def on_face(face, hw, hd, u, out):
    """墙面局部 (u, 外凸 out) → 世界 (x, y);hw/hd 为墙半宽/半深"""
    if face == 'front':
        return u, -hd - out
    if face == 'back':
        return -u, hd + out
    if face == 'left':
        return -hw - out, -u
    return hw + out, u


def face_blk(face, hw, hd, u, z, w, h, t, out, material):
    x, y = on_face(face, hw, hd, u, out)
    if face in ('front', 'back'):
        return blk(w, t, h, x, y, z, material)
    return blk(t, w, h, x, y, z, material)


def board(face, hw, hd, u0, o0, u1, o1, z, height, thick, material):
    """墙面局部两点 (u,外凸) 之间的竖板"""
    x0, y0 = on_face(face, hw, hd, u0, o0)
    x1, y1 = on_face(face, hw, hd, u1, o1)
    L = math.hypot(x1 - x0, y1 - y0)
    return blk(L, thick, height, (x0 + x1) / 2, (y0 + y1) / 2, z, material, rz=math.atan2(y1 - y0, x1 - x0))


def window(face, hw, hd, u, z, w=0.72, h=0.82, shutters=True):
    face_blk(face, hw, hd, u, z, w, h, 0.04, 0.0, glass)                     # 玻璃(夜里发暖光)
    for s in (-1, 1):                                                       # 左右窗框
        face_blk(face, hw, hd, u + s * (w / 2 + 0.05), z, 0.1, h + 0.2, 0.1, 0.03, wood)
    face_blk(face, hw, hd, u, z + h / 2 + 0.06, w + 0.3, 0.12, 0.12, 0.04, wood)   # 过梁
    face_blk(face, hw, hd, u, z - h / 2 - 0.06, w + 0.36, 0.1, 0.18, 0.07, wood)   # 窗台
    face_blk(face, hw, hd, u, z, 0.045, h, 0.05, 0.03, wood)                 # 竖棂
    face_blk(face, hw, hd, u, z + 0.05, w, 0.045, 0.05, 0.03, wood)          # 横棂
    if shutters:  # 百叶窗:铰在窗框外沿,向外半开
        a = 0.62
        for s in (-1, 1):
            u0, o0 = u + s * (w / 2 + 0.1), 0.06
            L = w / 2 + 0.02
            board(face, hw, hd, u0, o0, u0 + s * L * math.cos(a), o0 + L * math.sin(a), z, h + 0.06, 0.05, plank)


def doorway(face, hw, hd, u, z0, w=1.0, h=1.95, canopy=True):
    face_blk(face, hw, hd, u, z0 + h / 2, w, h, 0.06, 0.01, door)
    for k in range(1, 4):  # 门板竖缝(压条)
        face_blk(face, hw, hd, u - w / 2 + k * w / 4, z0 + h / 2, 0.03, h - 0.1, 0.03, 0.04, wood)
    face_blk(face, hw, hd, u, z0 + h * 0.3, w - 0.1, 0.07, 0.04, 0.05, wood)  # 横档
    face_blk(face, hw, hd, u, z0 + h * 0.75, w - 0.1, 0.07, 0.04, 0.05, wood)
    for s in (-1, 1):
        face_blk(face, hw, hd, u + s * (w / 2 + 0.07), z0 + h / 2 + 0.05, 0.14, h + 0.1, 0.14, 0.04, wood)
    face_blk(face, hw, hd, u, z0 + h + 0.1, w + 0.44, 0.16, 0.16, 0.05, wood)
    face_blk(face, hw, hd, u, z0 - 0.04, w + 0.3, 0.08, 0.5, 0.2, stone)    # 门槛石
    if canopy:  # 门檐:两根托架 + 一片小坡顶
        ztop = z0 + h + 0.55
        for s in (-1, 1):
            x0, y0 = on_face(face, hw, hd, u + s * (w / 2 + 0.25), 0.0)
            x1, y1 = on_face(face, hw, hd, u + s * (w / 2 + 0.25), 0.55)
            beam((x0, y0, ztop - 0.5), (x1, y1, ztop - 0.04), 0.07, wood)
        x, y = on_face(face, hw, hd, u, 0.33)
        rx = {'front': 0.42, 'back': -0.42}.get(face, 0)
        ry = {'left': -0.42, 'right': 0.42}.get(face, 0)
        if face in ('front', 'back'):
            blk(w + 0.9, 0.78, 0.07, x, y, ztop, roofm, rx=rx)
        else:
            blk(0.78, w + 0.9, 0.07, x, y, ztop, roofm, ry=ry)


def timber_frame(hw, hd, z0, z1, faces, openings):
    """木构架:角柱 + 地梁/檐梁/腰梁 + 立筋 + 角部斜撑;openings[face] = [(u, 半宽)] 处不放立筋/斜撑"""
    t = 0.17
    for sx in (-1, 1):
        for sy in (-1, 1):
            blk(t, t, z1 - z0, sx * (hw + 0.01), sy * (hd + 0.01), (z0 + z1) / 2, wood)
    mid = z0 + (z1 - z0) * 0.42
    for face in faces:
        L = 2 * (hw if face in ('front', 'back') else hd)
        for z in (z0 + 0.08, z1 - 0.08):
            face_blk(face, hw, hd, 0, z, L + 0.1, 0.16, 0.14, 0.03, wood)
        ops = openings.get(face, [])
        # 腰梁:被门打断的段落分开画
        segs = [(-L / 2, L / 2)]
        for (u, half) in ops:
            nxt = []
            for (a, b) in segs:
                if u + half < a or u - half > b:
                    nxt.append((a, b))
                    continue
                if u - half > a:
                    nxt.append((a, u - half))
                if u + half < b:
                    nxt.append((u + half, b))
            segs = nxt
        for (a, b) in segs:
            if b - a > 0.3:
                face_blk(face, hw, hd, (a + b) / 2, mid, b - a, 0.13, 0.12, 0.025, wood)
        # 立筋:约 1.1m 一根,开口处跳过
        n = max(2, round(L / 1.1))
        for i in range(1, n):
            u = -L / 2 + i * L / n
            if any(abs(u - ou) < oh + 0.12 for (ou, oh) in ops):
                continue
            face_blk(face, hw, hd, u, (z0 + z1) / 2, 0.12, z1 - z0 - 0.2, 0.1, 0.02, wood)
        # 角部斜撑(下半段,开口远离角部时才放)
        for s in (-1, 1):
            ua, ub = s * (L / 2 - 0.12), s * (L / 2 - 0.95)
            if any(abs((ua + ub) / 2 - ou) < oh + 0.55 for (ou, oh) in ops):
                continue
            xa, ya = on_face(face, hw, hd, ua, 0.025)
            xb, yb = on_face(face, hw, hd, ub, 0.025)
            beam((xa, ya, z0 + 0.12), (xb, yb, mid - 0.05), 0.11, wood)


def gable_roof_x(L, S, z_eave, rise, over_eave=0.5, over_gable=0.38, courses=7, front_extra=0.0, gable_mat=None):
    """两坡顶,屋脊沿 X;front_extra>0 时前坡(-Y)顺势延伸(盖住前廊)"""
    pitch = math.atan2(rise, S / 2)
    zr = z_eave + rise
    for side in (-1, 1):
        ext = over_eave + (front_extra if side < 0 else 0)
        slope = (S / 2 + ext) / math.cos(pitch)
        for i in range(courses):
            s0 = slope * i / courses
            sc = s0 + slope / courses / 2
            y = side * (S / 2 + ext - sc * math.cos(pitch))
            z = zr - (slope - sc) * math.sin(pitch) + 0.07
            blk(L + 2 * over_gable, slope / courses + 0.13, 0.075, 0, y, z, roofm,
                rx=-side * pitch + side * 0.05)
        # 封檐板(山墙沿口的斜板)
        for gx in (-1, 1):
            beam((gx * (L / 2 + over_gable + 0.03), side * (S / 2 + ext) * 1.0, zr - slope * math.sin(pitch) + 0.02),
                 (gx * (L / 2 + over_gable + 0.03), 0, zr + 0.12), 0.07, wood, 0.24)
    blk(L + 2 * over_gable + 0.1, 0.26, 0.2, 0, 0, zr + 0.15, wood, rx=math.pi / 4)  # 脊檩
    # 山墙三角
    gm = gable_mat or plaster
    for gx in (-1, 1):
        x0 = gx * L / 2
        prism_x(min(x0, x0 - gx * 0.12), max(x0, x0 - gx * 0.12),
                [(-S / 2, z_eave - 0.01), (S / 2, z_eave - 0.01), (0, zr)], gm)
        if gm is plaster:  # 山尖木构:中柱 + 人字撑
            blk(0.12, 0.12, rise - 0.15, x0 + gx * 0.03, 0, z_eave + (rise - 0.15) / 2, wood)
            for sy in (-1, 1):
                beam((x0 + gx * 0.03, sy * (S / 2 - 0.2), z_eave + 0.1), (x0 + gx * 0.03, 0, zr - 0.35), 0.1, wood)
    return zr


def gable_roof_y(L, S, z_eave, rise, over_eave=0.45, over_gable=0.5, courses=8):
    """两坡顶,屋脊沿 Y(山墙朝街)"""
    pitch = math.atan2(rise, S / 2)
    zr = z_eave + rise
    slope = (S / 2 + over_eave) / math.cos(pitch)
    for side in (-1, 1):
        for i in range(courses):
            sc = slope * i / courses + slope / courses / 2
            x = side * (S / 2 + over_eave - sc * math.cos(pitch))
            z = zr - (slope - sc) * math.sin(pitch) + 0.07
            blk(slope / courses + 0.13, L + 2 * over_gable, 0.075, x, 0, z, roofm, ry=side * pitch - side * 0.05)
        for gy in (-1, 1):
            beam((side * (S / 2 + over_eave), gy * (L / 2 + over_gable + 0.03), zr - slope * math.sin(pitch) + 0.02),
                 (0, gy * (L / 2 + over_gable + 0.03), zr + 0.12), 0.24, wood, 0.07)
    blk(0.26, L + 2 * over_gable + 0.1, 0.2, 0, 0, zr + 0.15, wood, ry=math.pi / 4)
    for gy in (-1, 1):
        y0 = gy * L / 2
        prism_y(min(y0, y0 - gy * 0.12), max(y0, y0 - gy * 0.12),
                [(-S / 2, z_eave - 0.01), (S / 2, z_eave - 0.01), (0, zr)], plaster)
        # 山墙木构:中柱 + 双斜撑 + 横梁
        yy = y0 + gy * 0.03
        blk(S - 0.2, 0.14, 0.14, 0, yy, z_eave + 0.08, wood)
        blk(0.12, 0.12, rise - 0.2, 0, yy, z_eave + (rise - 0.2) / 2, wood)
        for sx in (-1, 1):
            beam((sx * (S / 2 - 0.25), yy, z_eave + 0.12), (sx * 0.1, yy, zr - 0.45), 0.1, wood)
    return zr


def chimney(x, y, z0, h):
    blk(0.62, 0.62, h, x, y, z0 + h / 2, stone)
    blk(0.78, 0.78, 0.14, x, y, z0 + h + 0.07, stone)
    blk(0.5, 0.5, 0.1, x, y, z0 + h + 0.19, stone)


def finish(name):
    """应用变换 → 合并为单对象(多材质);游戏里再按材质拆开合批"""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in PARTS:
        ob.select_set(True)
        for p in ob.data.polygons:
            p.use_smooth = False
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    PARTS.clear()
    return ob


# ---------- HouseA:平房(屋脊沿 X,檐口朝街) ----------
W, D, BASE, EAVE = 6.0, 5.0, 0.55, 3.0
hw, hd = W / 2, D / 2
blk(W + 0.26, D + 0.26, BASE, 0, 0, BASE / 2, stone)
blk(W, D, EAVE - BASE, 0, 0, BASE + (EAVE - BASE) / 2, plaster)
win_z = BASE + 1.45
timber_frame(hw, hd, BASE, EAVE, ['front', 'back', 'left', 'right'],
             {'front': [(0, 0.66), (-1.75, 0.5), (1.75, 0.5)], 'back': [(0.9, 0.5)],
              'left': [(0, 0.5)], 'right': [(0, 0.5)]})
doorway('front', hw, hd, 0, BASE, canopy=False)
window('front', hw, hd, -1.75, win_z)
window('front', hw, hd, 1.75, win_z)
window('back', hw, hd, 0.9, win_z, shutters=False)
window('left', hw, hd, 0, win_z)
window('right', hw, hd, 0, win_z, shutters=False)
zr = gable_roof_x(W, D, EAVE, 2.0)
chimney(1.6, 1.0, EAVE + 0.4, zr - EAVE + 0.4)
finish('HouseA')

# ---------- HouseB:两层街屋(石砌底层 + 外挑木构上层,山墙朝街) ----------
W, D = 5.4, 5.0
hw, hd = W / 2, D / 2
G1 = 2.55            # 底层顶
JET = 0.42           # 上层向街外挑
blk(W + 0.2, D + 0.2, 0.35, 0, 0, 0.175, stone)
blk(W, D, G1 - 0.3, 0, 0, 0.3 + (G1 - 0.3) / 2, stone)
for sx in (-1, 1):  # 底层转角隅石(凸出的大块,读起来是砌石)
    for k in range(4):
        blk(0.5 if k % 2 == 0 else 0.34, 0.12, 0.5, sx * (hw - 0.22 + (0.08 if k % 2 else 0)), -hd - 0.03, 0.55 + k * 0.52, stone)
doorway('front', hw, hd, -0.9, 0.3, canopy=False)
window('front', hw, hd, 1.2, 1.55, w=0.66, h=0.74)
window('left', hw, hd, 0.4, 1.55, w=0.6, h=0.7, shutters=False)
window('right', hw, hd, -0.6, 1.55, w=0.6, h=0.7, shutters=False)
# 楼板梁头:前檐一排外露的方木,托住外挑的上层
for i in range(7):
    x = -hw + 0.35 + i * (W - 0.7) / 6
    blk(0.16, JET + 0.3, 0.18, x, -hd - JET / 2 + 0.1, G1 + 0.06, wood)
blk(W + 0.3, 0.18, 0.2, 0, -hd - JET + 0.06, G1 + 0.12, wood)  # 外挑承檩
# 上层(整体向前挑出 JET,左右各挑 0.1)
UW, UD = W + 0.2, D + JET
uhw, uhd = UW / 2, UD / 2
oy = -JET / 2   # 上层中心前移
U0, U1 = G1 + 0.2, G1 + 0.2 + 2.35
blk(W + 0.12, D + 0.06, U0 - G1 + 0.04, 0, 0, (G1 + U0) / 2, wood)  # 楼板层
blk(UW, UD, U1 - U0, 0, oy, (U0 + U1) / 2, plaster)
# 上层构件用平移后的坐标系:把 hd 换成 uhd,再整体前移 oy
_tf_start = len(PARTS)
timber_frame(uhw, uhd, U0, U1, ['front', 'back', 'left', 'right'],
             {'front': [(-1.25, 0.45), (1.25, 0.45)], 'left': [(0, 0.45)], 'right': [(0.3, 0.45)], 'back': [(0, 0.45)]})
window('front', uhw, uhd, -1.25, U0 + 1.25, w=0.66, h=0.78)
window('front', uhw, uhd, 1.25, U0 + 1.25, w=0.66, h=0.78)
window('left', uhw, uhd, 0, U0 + 1.25, w=0.6, h=0.72, shutters=False)
window('right', uhw, uhd, 0.3, U0 + 1.25, w=0.6, h=0.72, shutters=False)
window('back', uhw, uhd, 0, U0 + 1.25, w=0.6, h=0.72, shutters=False)
for ob in PARTS[_tf_start:]:
    ob.location.y += oy
_r_start = len(PARTS)
zr = gable_roof_y(UD, UW, U1, 2.7)
for ob in PARTS[_r_start:]:
    ob.location.y += oy
# 山尖小窗(朝街)
_w_start = len(PARTS)
window('front', uhw, uhd, 0, U1 + 0.85, w=0.42, h=0.5, shutters=False)
for ob in PARTS[_w_start:]:
    ob.location.y += oy
chimney(-1.3, 1.2, U1 + 0.3, zr - U1 + 0.5)
finish('HouseB')

# ---------- HouseC:长屋作坊(横板木墙 + 前廊 + 侧墙柴垛) ----------
W = 6.0
BODY0, BODY1 = -1.65, 2.5          # 屋身进深(前廊在 -2.5..-1.65)
D = BODY1 - BODY0
hw, hd = W / 2, D / 2
cy = (BODY0 + BODY1) / 2
EAVE = 2.55
_c_start = len(PARTS)
blk(W + 0.2, D + 0.2, 0.35, 0, 0, 0.175, stone)
blk(W, D, EAVE - 0.35, 0, 0, 0.35 + (EAVE - 0.35) / 2, plank)
for k in range(9):  # 横板:一道道搭接的板缝
    z = 0.5 + k * 0.24
    for face in ('front', 'back'):
        face_blk(face, hw, hd, 0, z, W, 0.05, 0.035, 0.0, wood)
    for face in ('left', 'right'):
        face_blk(face, hw, hd, 0, z, D, 0.05, 0.035, 0.0, wood)
for sx in (-1, 1):
    for sy in (-1, 1):
        blk(0.2, 0.2, EAVE - 0.35, sx * (hw + 0.02), sy * (hd + 0.02), 0.35 + (EAVE - 0.35) / 2, wood)
doorway('front', hw, hd, -0.6, 0.35, canopy=False)
window('front', hw, hd, 1.6, 1.5, w=0.66, h=0.7)
window('left', hw, hd, 0.3, 1.5, w=0.6, h=0.62, shutters=False)
window('back', hw, hd, -1.2, 1.5, w=0.6, h=0.62, shutters=False)
for ob in PARTS[_c_start:]:
    ob.location.y += cy
_r_start = len(PARTS)
zr = gable_roof_x(W, D, EAVE, 2.2, over_eave=0.35, gable_mat=plank)
for ob in PARTS[_r_start:]:
    ob.location.y += cy
# 前廊:地台 + 三根廊柱 + 檐檩 + 缓坡披檐(接在主屋檐下)
blk(W - 0.3, -BODY0 + 2.62 - 1.65 + 0.05, 0.2, 0, (BODY0 - 2.62) / 2, 0.1, plank)
for x in (-hw + 0.3, 0.5, hw - 0.3):
    blk(0.18, 0.18, 1.82, x, -2.48, 1.11, wood)
    beam((x, -2.48, 1.55), (x, -2.1, 1.98), 0.08, wood)
blk(W + 0.1, 0.18, 0.18, 0, -2.48, 2.04, wood)
for i in range(3):  # 披檐三道搭接板
    y0 = BODY0 - 0.25 - i * 0.36
    z0 = 2.2 - i * 0.075
    blk(W + 0.5, 0.48, 0.07, 0, y0 - 0.18, z0 - 0.02, roofm, rx=0.2)
# 前廊左端柴垛:截面朝外的原木摞
for row in range(3):
    for k in range(5 - row):
        bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.12, depth=0.7,
                                            location=(-hw + 0.75 + k * 0.25 + row * 0.125, -2.05, 0.32 + row * 0.21),
                                            rotation=(math.pi / 2, 0, 0))
        part(bpy.context.active_object, plank)
chimney(-1.9, cy + 1.2, EAVE + 0.3, zr - EAVE + 0.35)
finish('HouseC')

bpy.ops.object.select_all(action='SELECT')
path = os.path.join(OUT, 'house.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                          export_texcoords=False, export_normals=False)  # 游戏里按面重算法线(平直着色)
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
