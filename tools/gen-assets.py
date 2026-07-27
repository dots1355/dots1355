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


make_tree('oak', 'oak', 7, trunk_len=2.6, trunk_r=0.34, depth=3,
          leaf_color=(0.12, 0.15, 0.07), bark_color=(0.20, 0.15, 0.11), leaf_scale=1.15)
make_tree('birch', 'oak', 23, trunk_len=3.1, trunk_r=0.22, depth=3,
          leaf_color=(0.45, 0.32, 0.10), bark_color=(0.58, 0.57, 0.52), leaf_scale=0.9)
make_tree('pine', 'pine', 11, trunk_len=4.8, trunk_r=0.24, depth=0,
          leaf_color=(0.07, 0.11, 0.09), bark_color=(0.22, 0.16, 0.11), leaf_scale=1.05)
print('DONE')
