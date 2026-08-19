# Export the warehouse Structure collection from DP_Factory_Warehouse_Production.blend.
# Run INSIDE Blender (execute_blender_code exec()s this file, or paste into the Text editor).
#
#   The wall mural is a LIVE node mix (brick x painted sign x MuralFade) so the artist can
#   dial the fade in Blender — but glTF carries exactly one base-colour image per material,
#   so the mix must be FLATTENED before every export and the live graph restored after.
#   This script is that ritual. Do not export the scene by hand or the mural wall ships
#   with whichever single image the exporter happens to pick.
#
# After this, finish the pipeline outside Blender. The --set values come from
# assets/warehouse/export-factors.json, which THIS script writes (windows tint +
# any Bright/Contrast dials folded into baseColorFactor) — read it, don't hardcode:
#   node tools/glb-webp.mjs assets/warehouse/structure.glb assets/warehouse/structure.webp.glb --quality 85
#   node tools/glb-basecolor.mjs assets/warehouse/structure.webp.glb assets/warehouse/structure.glb \
#        --set "<name>=<r>,<g>,<b>" ... (one per entry in export-factors.json)
#   rm assets/warehouse/structure.webp.glb

import bpy, numpy as np, os, json

REPO = r"C:\Users\dexte\Desktop\Loops Pickle Factory\The Dripping Pickle - 3JS"
OUT = os.path.join(REPO, "assets", "warehouse", "structure.glb")
MURAL_PNG = os.path.join(REPO, "assets", "warehouse", "brick_mural_wall.png")
FACTORS_JSON = os.path.join(REPO, "assets", "warehouse", "export-factors.json")

# ── 0. collect base-colour factors the exporter will drop ───────────────────
#    A Brightness/Contrast node in front of a Base Color texture vanishes on
#    export. Cycles' formula is out = (1+contrast)*c + (brightness-contrast/2),
#    linear — when the constant term is ~0 that is a pure multiply, which IS
#    glTF's baseColorFactor. Written to export-factors.json; glb-basecolor.mjs
#    applies them after glb-webp (see the pipeline in the header).
factors = {"modular_factory_facade_windows_60": [0.0575, 0.0857, 0.045]}
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not b or not b.inputs['Base Color'].links: continue
    n = b.inputs['Base Color'].links[0].from_node
    if n.type != 'BRIGHTCONTRAST': continue
    a = 1 + n.inputs['Contrast'].default_value
    off = n.inputs['Bright'].default_value - n.inputs['Contrast'].default_value / 2
    if abs(off) < 0.005:
        factors[mat.name] = [round(a, 4)] * 3
        print(f"FACTOR: {mat.name} -> multiply {a:.3f} (Bright/Contrast folded into baseColorFactor)")
    else:
        print(f"WARNING: {mat.name} Bright/Contrast has offset {off:+.3f} — NOT a pure multiply, "
              f"it will export wrong. Bake it into the image or zero the offset.")
with open(FACTORS_JSON, 'w') as f:
    json.dump(factors, f, indent=1)

# ── 1. flatten the mural mix at the current MuralFade ───────────────────────
mural = bpy.data.materials['M_Brick_Mural_60']
mnt = mural.node_tree
fade = mnt.nodes['MuralFade'].outputs[0].default_value
W = bpy.data.images['Mural_BASE'].size[0]

def px(name):
    buf = np.empty(W * W * 4, dtype=np.float32)
    bpy.data.images[name].pixels.foreach_get(buf)
    return buf

base, col, alp = px('Mural_BASE'), px('Mural_COL'), px('Mural_ALP')
a = alp[0::4] * fade
out = base.copy()
for ch in range(3):
    out[ch::4] = base[ch::4] * (1 - a) + col[ch::4] * a
out[3::4] = 1.0

flat = bpy.data.images.get('MuralWall_60')
if flat: bpy.data.images.remove(flat)
flat = bpy.data.images.new('MuralWall_60', W, W, alpha=True)
flat.colorspace_settings.name = 'sRGB'
flat.pixels.foreach_set(out)
flat.alpha_mode = 'STRAIGHT'
flat.file_format = 'PNG'
flat.filepath_raw = MURAL_PNG
flat.save()
flat.source = 'FILE'; flat.filepath = MURAL_PNG
print(f"FLATTENED mural at fade {fade:.2f} -> {MURAL_PNG}")

# ── 2. temp-swap: flattened image straight into Base Color ──────────────────
bsdf = next(n for n in mnt.nodes if n.type == 'BSDF_PRINCIPLED')
mix_out = bsdf.inputs['Base Color'].links[0].from_socket   # remember the live mix
uvn = next(n for n in mnt.nodes if n.type == 'UVMAP')
exp = mnt.nodes.get('MURAL_EXPORT') or mnt.nodes.new('ShaderNodeTexImage')
exp.name = 'MURAL_EXPORT'; exp.label = 'flattened for export'
exp.image = flat
mnt.links.new(uvn.outputs['UV'], exp.inputs['Vector'])
for l in list(bsdf.inputs['Base Color'].links): mnt.links.remove(l)
mnt.links.new(exp.outputs['Color'], bsdf.inputs['Base Color'])

try:
    # ── 3. export visible Structure meshes + the camera ─────────────────────
    struct = bpy.data.collections['Structure']
    def all_objs(col):
        out = list(col.objects)
        for c in col.children: out += all_objs(c)
        return out
    targets = [o for o in all_objs(struct) if o.type == 'MESH' and not o.hide_get()]
    bpy.ops.object.select_all(action='DESELECT')
    for o in targets: o.select_set(True)
    bpy.data.objects['Camera'].select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True,
        export_apply=True, export_image_format='AUTO',
        export_cameras=True, export_animations=False,
    )
    print(f"EXPORTED: {OUT} {os.path.getsize(OUT)/1e6:.1f} MB ({len(targets)} meshes)")
finally:
    # ── 4. restore the live mix, whatever happened ───────────────────────────
    for l in list(bsdf.inputs['Base Color'].links): mnt.links.remove(l)
    mnt.links.new(mix_out, bsdf.inputs['Base Color'])
    print("RESTORED: live mural mix on Base Color")
