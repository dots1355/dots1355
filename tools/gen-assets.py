# Blender 资产工厂:程序化生成写实树木,导出紧凑 GLB 给游戏加载
# 用法: pip install bpy && python3 tools/gen-assets.py
# 产出: assets/models/oak.glb / pine.glb / birch.glb
import bpy
import bmesh
import math
import random
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, roughness=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return m


def branch_mesh(bm, start, direction, length, radius, depth, rng, leaf_points):
    """递归长枝:每段锥台,末端记叶簇锚点"""
    seg = max(2, depth + 1)
    p = list(start)
    d = list(direction)
    for i in range(seg):
        nxt = [p[j] + d[j] * (length / seg) for j in range(3)]
        r0 = radius * (1 - i / (seg + 2))
        r1 = radius * (1 - (i + 1) / (seg + 2))
        # 弯曲扰动:树从来不长直
        d[0] += rng.uniform(-0.25, 0.25)
        d[1] += rng.uniform(-0.25, 0.25)
        d[2] += rng.uniform(-0.06, 0.14)
        n = math.sqrt(sum(x * x for x in d)) or 1
        d = [x / n for x in d]
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=6,
                                    radius1=max(r0, 0.015), radius2=max(r1, 0.012),
                                    depth=length / seg)
        verts = ret['verts']
        # 对齐段方向
        up = (0, 0, 1)
        axis = (up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0])
        an = math.sqrt(sum(x * x for x in axis))
        ang = math.acos(max(-1, min(1, d[2])))
        mid = [(p[j] + nxt[j]) / 2 for j in range(3)]
        import mathutils
        if an > 1e-6:
            rot = mathutils.Matrix.Rotation(ang, 4, mathutils.Vector(axis).normalized())
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=verts)
        bmesh.ops.translate(bm, vec=mid, verts=verts)
        p = nxt
    if depth > 0:
        kids = rng.randint(2, 3)
        for _ in range(kids):
            nd = [d[0] + rng.uniform(-0.9, 0.9), d[1] + rng.uniform(-0.9, 0.9), d[2] + rng.uniform(0.1, 0.55)]
            n = math.sqrt(sum(x * x for x in nd)) or 1
            nd = [x / n for x in nd]
            branch_mesh(bm, p, nd, length * rng.uniform(0.6, 0.75), radius * 0.55, depth - 1, rng, leaf_points)
    else:
        leaf_points.append(tuple(p))


def make_tree(name, kind, seed, trunk_len, trunk_r, depth, leaf_color, bark_color, leaf_scale):
    reset()
    rng = random.Random(seed)
    # 树干+枝
    bm = bmesh.new()
    leaf_points = []
    branch_mesh(bm, (0, 0, 0), (0, 0, 1), trunk_len, trunk_r, depth, rng, leaf_points)
    mesh = bpy.data.meshes.new(name + '_bark')
    bm.to_mesh(mesh)
    bm.free()
    tree = bpy.data.objects.new(name + '_bark', mesh)
    tree.data.materials.append(mat('bark', bark_color, 0.95))
    bpy.context.collection.objects.link(tree)
    # 叶簇:每个末端锚点一团起伏 icosphere(低细分,平直着色出"雕塑感")
    bm2 = bmesh.new()
    for (x, y, z) in leaf_points:
        if kind == 'pine':
            continue
        r = leaf_scale * rng.uniform(0.7, 1.25)
        ret = bmesh.ops.create_icosphere(bm2, subdivisions=1, radius=r)
        vs = ret['verts']
        for v in vs:  # 每叶簇随机揉皱
            v.co.x *= rng.uniform(0.85, 1.2)
            v.co.y *= rng.uniform(0.85, 1.2)
            v.co.z *= rng.uniform(0.62, 0.85)
        bmesh.ops.translate(bm2, vec=(x, y, z), verts=vs)
    if kind == 'pine':
        # 松:塔状鳞层锥台叠层
        h = trunk_len
        tiers = 8
        for i in range(tiers):
            t = i / (tiers - 1)
            rr = leaf_scale * (1.5 - t * 1.25) * rng.uniform(0.92, 1.08)
            ret = bmesh.ops.create_cone(bm2, cap_ends=True, segments=9,
                                        radius1=rr, radius2=rr * 0.12,
                                        depth=trunk_len * 0.30)
            vs = ret['verts']
            for v in vs:
                v.co.x *= rng.uniform(0.9, 1.1)
                v.co.y *= rng.uniform(0.9, 1.1)
            bmesh.ops.translate(bm2, vec=(0, 0, h * (0.26 + t * 0.80)), verts=vs)
    if len(bm2.verts):
        mesh2 = bpy.data.meshes.new(name + '_leaf')
        bm2.to_mesh(mesh2)
        bm2.free()
        leaf = bpy.data.objects.new(name + '_leaf', mesh2)
        leaf.data.materials.append(mat('leaf', leaf_color, 0.9))
        bpy.context.collection.objects.link(leaf)
    # 平直着色(北境雕塑感)+ 导出
    for ob in bpy.context.collection.objects:
        for poly in ob.data.polygons:
            poly.use_smooth = False
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True,
                              export_yup=True)
    tris = sum(len(ob.data.polygons) for ob in bpy.context.collection.objects)
    print(f'{name}.glb faces≈{tris} → {os.path.getsize(path) // 1024}KB')


def make_birch(seed=23):
    """白桦:微弯的细高主干(白皮 + 一圈圈黑色皮孔斑),三四根斜上的主枝;树冠是沿上半截枝条撒开的
    二三十团小叶簇(两种金黄),疏密有致、透光——不再是"白棍子顶一个黄球"的棒棒糖"""
    import mathutils
    reset()
    rng = random.Random(seed)
    bark = bmesh.new()
    leaves = bmesh.new()
    clumps = []  # (中心, 半径)

    def limb(p0, d, length, r0, r1, segs, bark_marks=True):
        pts = [mathutils.Vector(p0)]
        d = mathutils.Vector(d).normalized()
        for i in range(segs):
            d = (d + mathutils.Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(0.0, 0.08)))).normalized()
            pts.append(pts[-1] + d * (length / segs))
        rings = []
        for i, p in enumerate(pts):
            t = i / segs
            r = r0 + (r1 - r0) * t
            dd = (pts[min(i + 1, segs)] - pts[max(i - 1, 0)]).normalized()
            up = mathutils.Vector((0, 0, 1)) if abs(dd.z) < 0.95 else mathutils.Vector((1, 0, 0))
            u = dd.cross(up).normalized()
            w = dd.cross(u).normalized()
            rings.append([bark.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * r)
                          for a in [k / 7 * math.pi * 2 for k in range(7)]])
        for i in range(segs):
            A, B = rings[i], rings[i + 1]
            band = bark_marks and rng.random() < 0.45  # 这一节有没有黑色皮孔带
            for k in range(7):
                f = bark.faces.new((A[k], A[(k + 1) % 7], B[(k + 1) % 7], B[k]))
                f.material_index = 1 if (band and rng.random() < 0.6) or (not band and rng.random() < 0.08) else 0
        cap = bark.faces.new(list(reversed(rings[-1])))
        cap.material_index = 0
        return pts

    # 主干:4.6m,带一点倾斜和弯
    lean = mathutils.Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 1))
    trunk = limb((0, 0, -0.15), lean, 4.9, 0.2, 0.07, 9)
    # 主枝:从 45%~85% 高处斜上伸出
    tips = []
    for j in range(4):
        i0 = 4 + j  # 第几节分枝
        base = trunk[i0]
        a = j * 2.2 + rng.uniform(-0.4, 0.4)
        d = (math.cos(a) * 0.75, math.sin(a) * 0.75, 1.0)
        L = rng.uniform(1.5, 2.2) * (1.0 - j * 0.12)
        pts = limb(base, d, L, 0.075 - j * 0.008, 0.025, 4)
        tips.append(pts)
        # 每根主枝再分一两根细枝
        for _ in range(rng.randint(1, 2)):
            k = rng.randint(1, 3)
            a2 = a + rng.uniform(-1.2, 1.2)
            sub = limb(pts[k], (math.cos(a2), math.sin(a2), 0.9), L * 0.55, 0.03, 0.012, 3, bark_marks=False)
            tips.append(sub)
    tips.append(trunk[6:])
    # 叶簇:沿每根枝的上半截撒,越靠枝梢越密;主干顶上再压一团
    for pts in tips:
        for i, p in enumerate(pts):
            if i < len(pts) * 0.35:
                continue
            for _ in range(1 if i < len(pts) - 1 else 2):
                c = p + mathutils.Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), rng.uniform(-0.1, 0.3)))
                clumps.append((c, rng.uniform(0.42, 0.68)))
    clumps.append((trunk[-1] + mathutils.Vector((0, 0, 0.25)), 0.7))
    for (c, r) in clumps:
        ret = bmesh.ops.create_icosphere(leaves, subdivisions=1, radius=r)
        mi = 1 if rng.random() < 0.35 else 0
        vs = set(ret['verts'])
        for v in ret['verts']:
            v.co.x *= rng.uniform(0.85, 1.15)
            v.co.y *= rng.uniform(0.85, 1.15)
            v.co.z *= rng.uniform(0.6, 0.8)
            v.co += c
        for f in leaves.faces:
            if f.verts[0] in vs:
                f.material_index = mi
    for name, bm, mats in (('birch_bark', bark, [mat('bark', (0.62, 0.61, 0.56), 0.95), mat('barkdark', (0.06, 0.055, 0.05), 0.95)]),
                           ('birch_leaf', leaves, [mat('leaf', (0.45, 0.32, 0.10), 0.9), mat('leaflight', (0.5, 0.4, 0.12), 0.9)])):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        for m in mats:
            ob.data.materials.append(m)
        bpy.context.collection.objects.link(ob)
        for poly in ob.data.polygons:
            poly.use_smooth = False
    path = os.path.join(OUT, 'birch.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False)
    lo = [min(c[0][k] - c[1] for c in clumps) for k in range(3)]
    hi = [max(c[0][k] + c[1] for c in clumps) for k in range(3)]
    print('birch crown bbox (blender xyz):', [round(v, 2) for v in lo], [round(v, 2) for v in hi], 'clumps', len(clumps))
    print(f'birch.glb → {os.path.getsize(path) // 1024}KB')


# 用法:不带参数 = 三种都重建;带参数(oak / birch / pine)= 只重建列出的那几种
ONLY = set(sys.argv[1:])
if not ONLY or 'oak' in ONLY:
    make_tree('oak', 'oak', 7, trunk_len=2.6, trunk_r=0.34, depth=3,
              leaf_color=(0.12, 0.15, 0.07), bark_color=(0.20, 0.15, 0.11), leaf_scale=1.15)
if not ONLY or 'birch' in ONLY:
    make_birch()
if not ONLY or 'pine' in ONLY:
    make_tree('pine', 'pine', 11, trunk_len=4.8, trunk_r=0.24, depth=0,
              leaf_color=(0.07, 0.11, 0.09), bark_color=(0.22, 0.16, 0.11), leaf_scale=1.05)
print('DONE')
