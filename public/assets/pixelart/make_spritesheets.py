"""Combine individual animation frames into horizontal strip spritesheets."""
from PIL import Image
import os

DIRECTIONS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
FRAME_SIZE = 48

def make_spritesheet(char_dir, output_dir, prefix, anim_name, out_name=None):
    os.makedirs(output_dir, exist_ok=True)
    anim_dir = os.path.join(char_dir, 'animations', anim_name)
    if not os.path.isdir(anim_dir):
        print(f"  Animation '{anim_name}' not found in {char_dir}")
        return

    label = out_name or anim_name
    for direction in DIRECTIONS:
        dir_path = os.path.join(anim_dir, direction)
        if not os.path.isdir(dir_path):
            print(f"  Skipping {direction} (no frames)")
            continue
        frames = sorted([f for f in os.listdir(dir_path) if f.endswith('.png')])
        if not frames:
            continue
        sheet = Image.new('RGBA', (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
        for i, fname in enumerate(frames):
            frame = Image.open(os.path.join(dir_path, fname))
            sheet.paste(frame, (i * FRAME_SIZE, 0))
        out_path = os.path.join(output_dir, f'{prefix}_{label}_{direction}.png')
        sheet.save(out_path)
        print(f"  {out_path} ({len(frames)} frames)")

OUT = 'e:/Websites/fading-lights/assets/pixelart/spritesheets'
PLAYER = 'e:/Websites/fading-lights/assets/pixelart/survivor-player-full'
STALKER = 'e:/Websites/fading-lights/assets/pixelart/shadow-stalker-anim'

print("Player walk:")
make_spritesheet(PLAYER, OUT, 'player', 'walking', 'walk')
print("Player melee attack:")
make_spritesheet(PLAYER, OUT, 'player', 'lead-jab', 'melee')
print("Player ranged attack:")
make_spritesheet(PLAYER, OUT, 'player', 'throw-object', 'ranged')

if os.path.isdir(STALKER):
    print("Stalker walk:")
    make_spritesheet(STALKER, OUT, 'stalker', 'walking', 'walk')
