#!/usr/bin/env python3
"""Measure the existing art. The numbers in docs/art-style.md come from here.

    survey.py                 one line per sheet: frame size, colours, body size
    survey.py --actions       frames per action, per character
    survey.py --outline       what colour the outer edge of each character is
    survey.py --palette SHEET.txt [N]   the N most used colours of one sheet

Reads images/ and new_images/ and changes nothing. Needs Pillow.
"""

import collections
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow: pip install pillow")

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ART_DIRS = ("images", "new_images")


def sheets():
    found = []
    for art_dir in ART_DIRS:
        for folder, _dirs, files in os.walk(os.path.join(REPO, art_dir)):
            for filename in sorted(files):
                path = os.path.join(folder, filename)
                if filename.endswith(".txt") and os.path.exists(path[:-4] + ".png"):
                    try:
                        with open(path) as handle:
                            info = json.load(handle)
                        if isinstance(info.get("frames"), list) and info["frames"]:
                            found.append((os.path.relpath(path, REPO), info))
                    except (ValueError, AttributeError):
                        pass
    return sorted(found)


def load(rel):
    return Image.open(os.path.join(REPO, rel[:-4] + ".png")).convert("RGBA")


def crop(image, frame):
    return image.crop((frame["originX"], frame["originY"],
                       frame["originX"] + frame["width"], frame["originY"] + frame["height"]))


def short(rel):
    return rel[len("images/"):] if rel.startswith("images/") else rel


def median(values):
    values = sorted(values)
    return values[len(values) // 2] if values else 0


def stem(name):
    """bartender/walk7 -> walk; the action a frame belongs to."""
    last = name.split("/", 1)[1] if "/" in name else name
    return re.sub(r"[\d_]+$", "", last) or last


def overview():
    print("%-52s %6s %9s %9s %7s %11s %9s" % (
        "sheet", "frames", "frame", "centre", "colours", "body w x h", "feet-to-c"))
    for rel, info in sheets():
        image = load(rel)
        frames = info["frames"]
        first = frames[0]
        colours = image.getcolors(maxcolors=1 << 20)
        visible = len([1 for _n, colour in colours if colour[3] > 0])
        soft = sum(n for n, colour in colours if 0 < colour[3] < 255)
        widths, heights, feet = [], [], []
        for frame in frames:
            box = crop(image, frame).getchannel("A").getbbox()
            if box:
                widths.append(box[2] - box[0])
                heights.append(box[3] - box[1])
                feet.append(box[3] - 1 - frame["centerY"])
        print("%-52s %6d %9s %9s %7d %11s %9s%s" % (
            short(rel), len(frames),
            "%dx%d" % (first["width"], first["height"]),
            "%d,%d" % (first["centerX"], first["centerY"]),
            visible, "%dx%d" % (median(widths), median(heights)),
            "%+d" % median(feet), "   (has soft edges)" if soft else ""))


def actions():
    for rel, info in sheets():
        counts = collections.OrderedDict()
        for frame in info["frames"]:
            counts[stem(frame["name"])] = counts.get(stem(frame["name"]), 0) + 1
        print(short(rel))
        print("   " + ", ".join("%s %d" % item for item in counts.items()))


def outline():
    """The outer edge: visible pixels that touch a transparent one (or the
    frame's border). Reports how dark it is and its commonest colours."""
    print("%-46s %10s %9s  %s" % ("sheet", "edge luma", "body luma", "commonest edge colours"))
    for rel, info in sheets():
        image = load(rel)
        edge = collections.Counter()
        body_total = 0
        body_count = 0
        for frame in info["frames"][:12]:
            cell = crop(image, frame)
            pixels = cell.load()
            width, height = cell.size
            for y in range(height):
                for x in range(width):
                    pixel = pixels[x, y]
                    if pixel[3] < 255:
                        continue
                    luma = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]
                    body_total += luma
                    body_count += 1
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if nx < 0 or ny < 0 or nx >= width or ny >= height or pixels[nx, ny][3] == 0:
                            edge[pixel[:3]] += 1
                            break
        total = sum(edge.values())
        if not total or not body_count:
            continue
        edge_luma = sum((0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * n for c, n in edge.items()) / total
        top = ", ".join("#%02x%02x%02x %d%%" % (c[0], c[1], c[2], round(100.0 * n / total))
                        for c, n in edge.most_common(4))
        print("%-46s %10.0f %9.0f  %s" % (short(rel), edge_luma,
                                         body_total / body_count, top))


def palette(rel, limit):
    image = Image.open(rel[:-4] + ".png").convert("RGBA")
    colours = [(n, c) for n, c in image.getcolors(maxcolors=1 << 20) if c[3] > 0]
    total = float(sum(n for n, _c in colours))
    print("%s: %d colours" % (rel, len(colours)))
    for n, colour in sorted(colours, reverse=True)[:limit]:
        print("  #%02x%02x%02x%s  %5.1f%%" % (colour[0], colour[1], colour[2],
                                             "" if colour[3] == 255 else " a%d" % colour[3],
                                             100 * n / total))


def main():
    args = sys.argv[1:]
    if "-h" in args or "--help" in args:
        print(__doc__)
    elif "--actions" in args:
        actions()
    elif "--outline" in args:
        outline()
    elif "--palette" in args:
        at = args.index("--palette")
        palette(args[at + 1], int(args[at + 2]) if len(args) > at + 2 else 24)
    else:
        overview()


if __name__ == "__main__":
    main()
