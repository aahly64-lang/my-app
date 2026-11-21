# Generates the app icon, adaptive icon and splash image into ./assets (requires Pillow).
import os
from PIL import Image, ImageDraw

S = 1024
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets')
os.makedirs(OUT, exist_ok=True)


def note_layer(size, scale):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    c = size / 2
    w = int(520 * scale)
    h = int(520 * scale)
    x0 = int(c - w / 2)
    y0 = int(c - h / 2 + 20 * scale)
    x1 = x0 + w
    y1 = y0 + h
    fold = int(120 * scale)
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    o = 14 * scale
    p = 18 * scale
    sd.polygon([(x0 + o, y0 + p), (x1 + o, y0 + p), (x1 + o, y1 - fold + p), (x1 - fold + o, y1 + p), (x0 + o, y1 + p)], fill=(0, 0, 0, 70))
    im = Image.alpha_composite(im, sh)
    d = ImageDraw.Draw(im)
    d.polygon([(x0, y0), (x1, y0), (x1, y1 - fold), (x1 - fold, y1), (x0, y1)], fill=(250, 204, 21, 255))
    d.polygon([(x1, y1 - fold), (x1 - fold, y1 - fold), (x1 - fold, y1)], fill=(202, 138, 4, 255))
    tw = int(170 * scale)
    th = int(56 * scale)
    d.rectangle([c - tw / 2, y0 - th / 2, c + tw / 2, y0 + th / 2], fill=(254, 249, 195, 220))
    for i in range(3):
        ly = y0 + int((150 + i * 95) * scale)
        lx1 = x1 - int(70 * scale)
        lx0 = x0 + int((70 if i < 2 else 200) * scale)
        d.rounded_rectangle([lx0, ly, lx1, ly + int(26 * scale)], radius=int(13 * scale), fill=(113, 63, 18, 255))
    pc = (x0 + int(120 * scale), y1 - int(150 * scale))
    r = int(62 * scale)
    d.ellipse([pc[0] - r, pc[1] - r, pc[0] + r, pc[1] + r], fill=(220, 38, 38, 255))
    d.polygon([(pc[0] - r * 0.85, pc[1] + r * 0.45), (pc[0] + r * 0.85, pc[1] + r * 0.45), (pc[0], pc[1] + r * 2.0)], fill=(220, 38, 38, 255))
    ri = int(24 * scale)
    d.ellipse([pc[0] - ri, pc[1] - ri, pc[0] + ri, pc[1] + ri], fill=(255, 255, 255, 255))
    return im


icon = Image.new('RGBA', (S, S), (15, 23, 42, 255))
icon = Image.alpha_composite(icon, note_layer(S, 1.25))
icon.convert('RGB').save(os.path.join(OUT, 'icon.png'), optimize=True)
note_layer(S, 0.78).save(os.path.join(OUT, 'adaptive-icon.png'), optimize=True)
note_layer(S, 1.0).save(os.path.join(OUT, 'splash.png'), optimize=True)
print('icons generated')
