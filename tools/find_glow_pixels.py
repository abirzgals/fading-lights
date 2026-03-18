"""
Find bright/glowing pixels in enemy sprites.
Outputs glow data to each enemy's metadata.json.

Bright pixels (eyes, runes, magic effects) are detected by:
- High luminance (>180) OR high saturation with medium luminance
- Not near-white (those are just highlights)
- Must have alpha > 128 (visible pixels only)
"""

from PIL import Image
import json
import os
import glob
import colorsys

def get_glow_pixels(img_path, lum_threshold=170, sat_threshold=0.5):
    """Find glowing pixels in a sprite image."""
    img = Image.open(img_path).convert('RGBA')
    pixels = img.load()
    w, h = img.size
    glow = []

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 128:
                continue  # skip transparent

            # Luminance
            lum = 0.299 * r + 0.587 * g + 0.114 * b

            # HSV saturation
            r01, g01, b01 = r / 255, g / 255, b / 255
            _, sat, val = colorsys.rgb_to_hsv(r01, g01, b01)

            # Detect glow: bright OR saturated+medium-bright
            is_glow = False
            if lum > lum_threshold and sat > 0.15:
                is_glow = True  # bright colored pixel (eyes, runes)
            elif sat > sat_threshold and lum > 100:
                is_glow = True  # saturated colored pixel (magic effects)

            # Skip near-white (just highlights, not glow)
            if r > 240 and g > 240 and b > 240:
                is_glow = False

            if is_glow:
                glow.append({
                    "x": x, "y": y,
                    "r": r, "g": g, "b": b,
                    "luminance": round(lum, 1)
                })

    return glow


def process_enemy(enemy_dir):
    """Process all rotation sprites for one enemy and add glow data to metadata."""
    meta_path = os.path.join(enemy_dir, 'metadata.json')
    if not os.path.exists(meta_path):
        return

    with open(meta_path, 'r') as f:
        meta = json.load(f)

    # Process rotation sprites
    rot_dir = os.path.join(enemy_dir, 'rotations')
    glow_data = {}
    total_glow = 0

    if os.path.isdir(rot_dir):
        for png in sorted(glob.glob(os.path.join(rot_dir, '*.png'))):
            direction = os.path.splitext(os.path.basename(png))[0]
            pixels = get_glow_pixels(png)
            if pixels:
                # Cluster nearby pixels to avoid listing every single one
                # Just keep the brightest per 4x4 cell
                cells = {}
                for p in pixels:
                    cx, cy = p['x'] // 4, p['y'] // 4
                    key = f"{cx},{cy}"
                    if key not in cells or p['luminance'] > cells[key]['luminance']:
                        cells[key] = p
                glow_data[direction] = list(cells.values())
                total_glow += len(cells)

    # Save glow data
    meta['glowPixels'] = glow_data
    meta['hasGlow'] = total_glow > 0

    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)

    name = os.path.basename(enemy_dir)
    print(f"  {name}: {total_glow} glow clusters across {len(glow_data)} directions")


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    enemies_dir = os.path.join(base, 'public', 'assets', 'enemies')

    print("Scanning enemy sprites for glow pixels...")
    for enemy_dir in sorted(glob.glob(os.path.join(enemies_dir, '*/'))):
        if os.path.isdir(enemy_dir):
            process_enemy(enemy_dir)

    # Also check stalker
    stalker_dir = os.path.join(base, 'public', 'assets', 'pixelart', 'shadow-stalker')
    if os.path.isdir(stalker_dir):
        process_enemy(stalker_dir)

    print("Done!")


if __name__ == '__main__':
    main()
