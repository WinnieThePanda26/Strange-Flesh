#!/usr/bin/env python3
"""Pack, unpack and compare Strange Flesh sprite sheets.

A sheet is a PNG plus a .txt file of JSON that says where each frame is and
where its centre (anchor) point is. The format is described in docs/sprites.md.

    spritesheet.py pack   FOLDER [-o OUT] [--like SHEET.txt] [--center X,Y] ...
    spritesheet.py unpack SHEET.txt FOLDER
    spritesheet.py compare A.txt B.txt

pack    turns a folder of frame PNGs into OUT.png + OUT.txt.
unpack  is the inverse: one PNG per frame plus a pack.json, so that packing the
        folder again gives back the same sheet.
compare checks that two sheets hold the same frames: same names, sizes, centres
        and pixels. The layout of the frames inside the sheet may differ.

Needs Python 3 and Pillow (pip install pillow). Nothing else.
"""

import argparse
import collections
import json
import math
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow: pip install pillow")

MANIFEST = "pack.json"
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# The folders the game loads sheets from. Used to look for clashing frame names.
ART_DIRS = ("images", "new_images")

# Sheets wider or taller than this fail to load on some phones.
MAX_SAFE_SIDE = 4096


class SheetError(Exception):
    pass


def natural_key(text):
    """Sort key that puts walk2 before walk10."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def parse_point(text):
    try:
        x, y = text.split(",")
        return [int(x), int(y)]
    except ValueError:
        raise argparse.ArgumentTypeError("expected X,Y (two whole numbers), got %r" % text)


def read_sheet(txt_path):
    """Return (info, image) for a sheet. The image is RGBA."""
    with open(txt_path) as handle:
        info = json.load(handle)
    png_path = txt_path[:-4] + ".png"
    if not os.path.exists(png_path):
        raise SheetError("%s has no matching %s" % (txt_path, os.path.basename(png_path)))
    return info, Image.open(png_path).convert("RGBA")


def clear_invisible(image):
    """Give every fully transparent pixel the same value, so that pixels nobody
    can see never make two images count as different."""
    visible = image.getchannel("A").point(lambda alpha: 255 if alpha else 0)
    return Image.composite(image, Image.new("RGBA", image.size, (0, 0, 0, 0)), visible)


def frame_image(sheet_image, frame):
    box = (frame["originX"], frame["originY"],
           frame["originX"] + frame["width"], frame["originY"] + frame["height"])
    return clear_invisible(sheet_image.crop(box))


def opaque_bounds(image):
    """Bounding box of the visible pixels, or None for an empty image."""
    return image.getchannel("A").getbbox()


def guess_center(images):
    """Bottom middle of what is drawn in the first frame: where the feet meet
    the ground when the first frame is a standing pose."""
    for image in images:
        box = opaque_bounds(image)
        if box is not None:
            left, top, right, bottom = box
            return [(left + right) // 2, bottom - 1]
    width, height = images[0].size
    return [width // 2, height - 1]


def save_png(image, path):
    """Write the image without losing anything. Sheets with 256 colours or
    fewer are written with a palette, like the original art, which makes the
    file several times smaller."""
    image = clear_invisible(image)
    colors = image.getcolors(maxcolors=256)
    if colors is None:
        image.save(path, optimize=True)
        return "RGBA"

    palette = [color for _count, color in sorted(colors, key=lambda c: -c[0])]
    index_of = dict((bytes(color), index) for index, color in enumerate(palette))
    raw = image.tobytes()
    indexed = Image.frombytes(
        "P", image.size, bytes(index_of[raw[at:at + 4]] for at in range(0, len(raw), 4)))
    flat = []
    for red, green, blue, _alpha in palette:
        flat.extend((red, green, blue))
    indexed.putpalette(flat)
    indexed.save(path, optimize=True, transparency=bytes(color[3] for color in palette))

    # Never trust the palette route blindly: read the file back and compare.
    if Image.open(path).convert("RGBA").tobytes() != image.tobytes():
        image.save(path, optimize=True)
        return "RGBA"
    return "palette of %d" % len(palette)


def other_sheet_names(skip_paths):
    """Every frame name in the game's art folders -> the sheet that defines it."""
    skip = set(os.path.abspath(path) for path in skip_paths)
    names = {}
    for art_dir in ART_DIRS:
        for folder, _dirs, files in os.walk(os.path.join(REPO, art_dir)):
            for filename in files:
                path = os.path.join(folder, filename)
                if not filename.endswith(".txt") or os.path.abspath(path) in skip:
                    continue
                try:
                    with open(path) as handle:
                        frames = json.load(handle)["frames"]
                except (ValueError, KeyError, TypeError, OSError):
                    continue
                for frame in frames:
                    names.setdefault(frame["name"], os.path.relpath(path, REPO))
    return names


# ---------------------------------------------------------------------------
# pack
# ---------------------------------------------------------------------------

def load_manifest(folder):
    path = os.path.join(folder, MANIFEST)
    if not os.path.exists(path):
        return {}
    with open(path) as handle:
        try:
            return json.load(handle)
        except ValueError as error:
            raise SheetError("%s is not valid JSON: %s" % (path, error))


def plan_frames(folder, manifest, parent, prefix):
    """Decide the order and name of every frame. Returns a list of dicts with
    file, name and (maybe) center."""
    on_disk = sorted((name for name in os.listdir(folder) if name.lower().endswith(".png")),
                     key=natural_key)
    if not on_disk:
        raise SheetError("no .png files in %s" % folder)

    def default_name(filename):
        stem = os.path.splitext(filename)[0]
        if prefix:
            stem = prefix + "_" + stem
        return parent + "/" + stem

    planned = []
    listed = set()
    for entry in manifest.get("frames", []):
        filename = entry["file"]
        if filename not in on_disk:
            raise SheetError("%s lists %s, which is not in %s" % (MANIFEST, filename, folder))
        if filename in listed:
            raise SheetError("%s lists %s twice" % (MANIFEST, filename))
        listed.add(filename)
        planned.append({"file": filename,
                        "name": entry.get("name", default_name(filename)),
                        "center": entry.get("center")})

    # Frames added since the manifest was written go on the end, in name order.
    added = [filename for filename in on_disk if filename not in listed]
    for filename in added:
        planned.append({"file": filename, "name": default_name(filename), "center": None})
    if listed and added:
        print("note: %d frame(s) not in %s were added at the end: %s"
              % (len(added), MANIFEST, ", ".join(added)))
    return planned


def pack(args):
    folder = args.folder.rstrip("/")
    if not os.path.isdir(folder):
        raise SheetError("%s is not a folder" % folder)
    manifest = load_manifest(folder)

    like = None
    if args.like:
        like, _image = read_sheet(args.like)
        if not like["frames"]:
            raise SheetError("%s has no frames to copy settings from" % args.like)

    # Where each setting comes from: command line, then pack.json, then --like,
    # then a default.
    parent = args.parent or manifest.get("parent")
    if parent is None and like:
        parent = like["frames"][0]["name"].split("/")[0]
    if parent is None:
        parent = os.path.basename(os.path.abspath(folder))
    prefix = args.prefix if args.prefix is not None else manifest.get("prefix", "")

    planned = plan_frames(folder, manifest, parent, prefix)
    images = [Image.open(os.path.join(folder, frame["file"])).convert("RGBA") for frame in planned]

    sizes = collections.Counter(image.size for image in images)
    if len(sizes) > 1:
        usual = sizes.most_common(1)[0][0]
        odd = ["%s is %dx%d" % (frame["file"], image.size[0], image.size[1])
               for frame, image in zip(planned, images) if image.size != usual]
        raise SheetError(
            "every frame must be drawn on the same size canvas, so that one centre point "
            "fits them all.\n  Most frames are %dx%d, but: %s"
            % (usual[0], usual[1], "; ".join(odd[:8]) + (" ..." if len(odd) > 8 else "")))
    width, height = images[0].size

    if like:
        first = like["frames"][0]
        if (first["width"], first["height"]) != (width, height):
            raise SheetError(
                "--like %s has %dx%d frames but these are %dx%d. Draw on the same canvas, "
                "or drop --like and give --center."
                % (args.like, first["width"], first["height"], width, height))

    center = args.center or manifest.get("center")
    center_source = "given"
    if center is None and like:
        center = [like["frames"][0]["centerX"], like["frames"][0]["centerY"]]
        center_source = "copied from " + os.path.basename(args.like)
    if center is None:
        center = guess_center(images)
        center_source = "GUESSED"

    names = [frame["name"] for frame in planned]
    repeated = [name for name, count in collections.Counter(names).items() if count > 1]
    if repeated:
        raise SheetError("frame names must be unique; repeated: %s" % ", ".join(sorted(repeated)))

    count = len(planned)
    columns = args.columns or manifest.get("columns")
    if not columns:
        # Roughly square, which keeps both sides as small as they can be.
        columns = max(1, int(math.ceil(math.sqrt(count * height / float(width)))))
    columns = min(columns, count)
    rows = int(math.ceil(count / float(columns)))

    sheet = Image.new("RGBA", (columns * width, rows * height), (0, 0, 0, 0))
    frames = []
    for index, (frame, image) in enumerate(zip(planned, images)):
        origin_x = (index % columns) * width
        origin_y = (index // columns) * height
        sheet.paste(image, (origin_x, origin_y))
        frame_center = frame["center"] or center
        # Key order matches the original sheets.
        frames.append(collections.OrderedDict([
            ("name", frame["name"]), ("width", width), ("height", height),
            ("originX", origin_x), ("originY", origin_y),
            ("centerX", frame_center[0]), ("centerY", frame_center[1])]))

    out = args.out or folder
    if out.endswith(".txt") or out.endswith(".png"):
        out = out[:-4]
    out_dir = os.path.dirname(out)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    mode = save_png(sheet, out + ".png")
    info = collections.OrderedDict([("width", sheet.size[0]), ("height", sheet.size[1]),
                                    ("frames", frames)])
    with open(out + ".txt", "w") as handle:
        handle.write(json.dumps(info, separators=(",", ":")) + "\n")

    print("%s.png  %dx%d, %d frames of %dx%d in %d column(s), %s"
          % (out, sheet.size[0], sheet.size[1], count, width, height, columns, mode))
    print("%s.txt  frames %s ... %s, centre (%d, %d) %s"
          % (out, names[0], names[-1], center[0], center[1], center_source))

    if center_source == "GUESSED":
        print("warning: the centre was guessed as the bottom middle of the first frame.\n"
              "  Check it in the sprite viewer, then pass --center X,Y or --like SHEET.txt.")
    if max(sheet.size) > MAX_SAFE_SIDE:
        print("warning: the sheet is over %d pixels on one side, which some phones cannot load.\n"
              "  Try --columns %d, or split the frames into two sheets."
              % (MAX_SAFE_SIDE, max(1, int(round(math.sqrt(count * height / float(width)))))))
    if not args.no_name_check:
        elsewhere = other_sheet_names([out + ".txt"])
        clashes = [(name, elsewhere[name]) for name in names if name in elsewhere]
        if clashes:
            print("warning: %d frame name(s) are already used by another sheet. The game finds "
                  "frames by name, so whichever sheet loads last wins:" % len(clashes))
            for name, where in clashes[:8]:
                print("  %s  (also in %s)" % (name, where))
            if len(clashes) > 8:
                print("  ...")
    return 0


# ---------------------------------------------------------------------------
# unpack
# ---------------------------------------------------------------------------

def unpack(args):
    info, sheet = read_sheet(args.sheet)
    frames = info["frames"]
    if not frames:
        raise SheetError("%s has no frames" % args.sheet)
    folder = args.folder
    if not os.path.isdir(folder):
        os.makedirs(folder)
    elif any(name.lower().endswith(".png") or name == MANIFEST for name in os.listdir(folder)):
        raise SheetError("%s already holds frames; unpack into an empty folder" % folder)

    parent = collections.Counter(frame["name"].split("/")[0] for frame in frames).most_common(1)[0][0]
    center = list(collections.Counter(
        (frame["centerX"], frame["centerY"]) for frame in frames).most_common(1)[0][0])
    columns = len(set(frame["originX"] for frame in frames))

    entries = []
    used = set()
    for frame in frames:
        name = frame["name"]
        if name.startswith(parent + "/"):
            stem = name[len(parent) + 1:]
        else:
            stem = name
        filename = re.sub(r"[^A-Za-z0-9._-]+", "__", stem) + ".png"
        if filename in used:
            raise SheetError("two frames would both be saved as %s" % filename)
        used.add(filename)
        frame_image(sheet, frame).save(os.path.join(folder, filename))

        entry = collections.OrderedDict([("file", filename), ("name", name)])
        if [frame["centerX"], frame["centerY"]] != center:
            entry["center"] = [frame["centerX"], frame["centerY"]]
        entries.append(entry)

    manifest = collections.OrderedDict([("parent", parent), ("center", center),
                                        ("columns", columns), ("frames", entries)])
    # One frame per line, so the file is easy to read and to reorder by hand.
    lines = ["{"]
    for key in ("parent", "center", "columns"):
        lines.append(' "%s": %s,' % (key, json.dumps(manifest[key])))
    lines.append(' "frames": [')
    lines.append(",\n".join("  " + json.dumps(entry) for entry in entries))
    lines.append(" ]")
    lines.append("}")
    with open(os.path.join(folder, MANIFEST), "w") as handle:
        handle.write("\n".join(lines) + "\n")

    print("%s: %d frames -> %s/ (+ %s)" % (args.sheet, len(frames), folder, MANIFEST))
    if (info.get("width"), info.get("height")) != sheet.size:
        print("note: the .txt says the sheet is %sx%s but the PNG is %dx%d. The game never "
              "reads those two numbers." % (info.get("width"), info.get("height"),
                                           sheet.size[0], sheet.size[1]))
    return 0


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------

def compare(args):
    info_a, sheet_a = read_sheet(args.a)
    info_b, sheet_b = read_sheet(args.b)
    problems = []

    names_a = [frame["name"] for frame in info_a["frames"]]
    names_b = [frame["name"] for frame in info_b["frames"]]
    if names_a != names_b:
        missing = [name for name in names_a if name not in set(names_b)]
        extra = [name for name in names_b if name not in set(names_a)]
        if missing or extra:
            problems.append("frame names differ: missing %s, extra %s" % (missing[:5], extra[:5]))
        else:
            problems.append("same frame names, in a different order")

    by_name_b = dict((frame["name"], frame) for frame in info_b["frames"])
    moved = 0
    for frame_a in info_a["frames"]:
        frame_b = by_name_b.get(frame_a["name"])
        if frame_b is None:
            continue
        for key in ("width", "height", "centerX", "centerY"):
            if frame_a[key] != frame_b[key]:
                problems.append("%s: %s is %s in A, %s in B"
                                % (frame_a["name"], key, frame_a[key], frame_b[key]))
        if (frame_a["originX"], frame_a["originY"]) != (frame_b["originX"], frame_b["originY"]):
            moved += 1
        if (frame_a["width"], frame_a["height"]) == (frame_b["width"], frame_b["height"]):
            image_a = frame_image(sheet_a, frame_a)
            image_b = frame_image(sheet_b, frame_b)
            if image_a.tobytes() != image_b.tobytes():
                problems.append("%s: pixels differ" % frame_a["name"])

    if problems:
        print("DIFFERENT: %s vs %s" % (args.a, args.b))
        for problem in problems[:20]:
            print("  " + problem)
        if len(problems) > 20:
            print("  ... and %d more" % (len(problems) - 20))
        return 1
    print("SAME: %d frames, every name, size, centre and pixel matches (%d frame(s) sit at a "
          "different place in the sheet)" % (len(names_a), moved))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command")
    commands.required = True

    p = commands.add_parser("pack", help="folder of frame PNGs -> sheet .png + .txt")
    p.add_argument("folder", help="folder of frame PNGs, all the same size")
    p.add_argument("-o", "--out", help="output path without extension (default: the folder path)")
    p.add_argument("--like", metavar="SHEET.txt",
                   help="copy the centre and frame-name parent from an existing sheet of the "
                        "same character (frames must be the same size)")
    p.add_argument("--center", type=parse_point, metavar="X,Y",
                   help="centre point, in frame pixels from the top left")
    p.add_argument("--parent", help="first half of each frame name: PARENT/file (default: "
                                    "the folder name)")
    p.add_argument("--prefix", help="variant prefix: frames are named PARENT/PREFIX_file")
    p.add_argument("--columns", type=int, help="frames per row (default: roughly square)")
    p.add_argument("--no-name-check", action="store_true",
                   help="do not look for clashing frame names in images/ and new_images/")
    p.set_defaults(run=pack)

    p = commands.add_parser("unpack", help="sheet -> folder of frame PNGs + pack.json")
    p.add_argument("sheet", help="the sheet's .txt file")
    p.add_argument("folder", help="empty folder to write the frames into")
    p.set_defaults(run=unpack)

    p = commands.add_parser("compare", help="check two sheets hold the same frames")
    p.add_argument("a", help="first sheet's .txt file")
    p.add_argument("b", help="second sheet's .txt file")
    p.set_defaults(run=compare)

    args = parser.parse_args()
    try:
        return args.run(args)
    except SheetError as error:
        print("error: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
