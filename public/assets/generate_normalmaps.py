"""Generate normal maps from sprite textures using luminance-based height estimation."""
from PIL import Image, ImageFilter
import numpy as np
import os
import glob

def generate_normal_map(input_path, output_path, strength=2.0, sphere_bias=0.0):
    """Generate a normal map from a sprite image.
    Uses luminance as height, computes gradients via Sobel-like filter.
    sphere_bias (0.0-1.0): blend with a spherical normal map for rounder 3D look.
    """
    img = Image.open(input_path).convert('RGBA')
    pixels = np.array(img, dtype=np.float32)

    # Compute luminance as height map (brighter = higher)
    r, g, b, a = pixels[:,:,0], pixels[:,:,1], pixels[:,:,2], pixels[:,:,3]
    height = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    # Mask by alpha — transparent pixels are flat (facing up)
    alpha_mask = a / 255.0
    height *= alpha_mask

    # Smooth height slightly to reduce noise
    height_img = Image.fromarray((height * 255).astype(np.uint8), 'L')
    height_img = height_img.filter(ImageFilter.GaussianBlur(radius=0.8))
    height = np.array(height_img, dtype=np.float32) / 255.0

    # Compute gradients (Sobel-like)
    h, w = height.shape
    dx = np.zeros_like(height)
    dy = np.zeros_like(height)

    # Central differences
    dx[:, 1:-1] = (height[:, 2:] - height[:, :-2]) * strength
    dy[1:-1, :] = (height[2:, :] - height[:-2, :]) * strength

    # Normal = (-dx, -dy, 1) normalized
    nx = -dx
    ny = -dy
    nz = np.ones_like(height)

    # Normalize
    length = np.sqrt(nx**2 + ny**2 + nz**2)
    length = np.maximum(length, 0.001)
    nx /= length
    ny /= length
    nz /= length

    # Spherical bias: blend with a hemisphere normal map for rounder 3D shape
    if sphere_bias > 0.0:
        # Find bounding box of non-transparent pixels
        opaque = alpha_mask > 0.1
        rows = np.any(opaque, axis=1)
        cols = np.any(opaque, axis=0)
        if rows.any() and cols.any():
            rmin, rmax = np.where(rows)[0][[0, -1]]
            cmin, cmax = np.where(cols)[0][[0, -1]]
            # Normalized coords within bounding box [-1, 1]
            cy_arr, cx_arr = np.mgrid[0:h, 0:w].astype(np.float32)
            cx_norm = (cx_arr - (cmin + cmax) * 0.5) / max((cmax - cmin) * 0.5, 1)
            cy_norm = (cy_arr - (rmin + rmax) * 0.5) / max((rmax - rmin) * 0.5, 1)
            r2 = cx_norm**2 + cy_norm**2
            # Hemisphere: nz = sqrt(1 - r2), clamped
            sz = np.sqrt(np.maximum(1.0 - r2, 0.0))
            sx = -cx_norm
            sy = -cy_norm
            slen = np.sqrt(sx**2 + sy**2 + sz**2)
            slen = np.maximum(slen, 0.001)
            sx /= slen; sy /= slen; sz /= slen
            # Only apply sphere where alpha > 0
            mask = alpha_mask * sphere_bias
            nx = nx * (1.0 - mask) + sx * mask
            ny = ny * (1.0 - mask) + sy * mask
            nz = nz * (1.0 - mask) + sz * mask
            # Re-normalize
            length = np.sqrt(nx**2 + ny**2 + nz**2)
            length = np.maximum(length, 0.001)
            nx /= length; ny /= length; nz /= length

    # Convert from [-1,1] to [0,255] range
    # Normal map convention: R=X, G=Y, B=Z
    norm_r = ((nx * 0.5 + 0.5) * 255).astype(np.uint8)
    norm_g = ((ny * 0.5 + 0.5) * 255).astype(np.uint8)
    norm_b = ((nz * 0.5 + 0.5) * 255).astype(np.uint8)
    norm_a = (alpha_mask * 255).astype(np.uint8)

    # Stack into RGBA
    normal_map = np.stack([norm_r, norm_g, norm_b, norm_a], axis=-1)

    result = Image.fromarray(normal_map, 'RGBA')
    result.save(output_path)
    bias_str = f' sphere={sphere_bias}' if sphere_bias > 0 else ''
    print(f'  {os.path.basename(input_path)} -> {os.path.basename(output_path)} ({w}x{h}{bias_str})')

def main():
    base = os.path.dirname(os.path.abspath(__file__))

    # Sprites to generate normal maps for
    # Format: (src, dst, strength, sphere_bias)
    sources = [
        # Trees — 50% spherical bias for rounder 3D canopy look
        ('pixelart/dark-tree.png', 'normals/dark-tree_n.png', 4.0, 0.5),
        ('pixelart/tree_pine.png', 'normals/tree_pine_n.png', 4.0, 0.5),
        ('pixelart/tree_oak.png', 'normals/tree_oak_n.png', 4.0, 0.5),
        ('pixelart/tree_dead.png', 'normals/tree_dead_n.png', 3.0, 0.3),
        ('pixelart/tree_birch.png', 'normals/tree_birch_n.png', 4.0, 0.5),
        # Stones/rocks — slight sphere for roundness
        ('pixelart/stone_deposit.png', 'normals/stone_deposit_n.png', 4.0, 0.3),
        ('pixelart/metal_ore.png', 'normals/metal_ore_n.png', 4.0, 0.3),
        ('pixelart/rock_wall.png', 'normals/rock_wall_n.png', 3.5, 0.0),
        ('pixelart/metal_mine.png', 'normals/metal_mine_n.png', 3.5, 0.2),
        # Ground tileset — flat, no sphere
        ('pixelart/ground-tileset.png', 'normals/ground-tileset_n.png', 2.0, 0.0),
        # Dungeon
        ('dungeon/dungeon-tileset.png', 'normals/dungeon-tileset_n.png', 2.5, 0.0),
        ('dungeon/pillar.png', 'normals/pillar_n.png', 4.0, 0.4),
        ('dungeon/chest.png', 'normals/chest_n.png', 3.5, 0.3),
        ('dungeon/bones.png', 'normals/bones_n.png', 2.0, 0.0),
    ]

    # Create output directory
    normals_dir = os.path.join(base, 'normals')
    os.makedirs(normals_dir, exist_ok=True)

    print('Generating normal maps...')
    for src, dst, strength, sphere in sources:
        src_path = os.path.join(base, src)
        dst_path = os.path.join(base, dst)
        if os.path.exists(src_path):
            generate_normal_map(src_path, dst_path, strength, sphere)
        else:
            print(f'  SKIP: {src} (not found)')

    print(f'\nDone! Normal maps saved to {normals_dir}/')

if __name__ == '__main__':
    main()
