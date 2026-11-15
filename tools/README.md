# Tools

Things for working on the game that are not part of it. Nothing here is loaded
by `index.html` or `editor.html`.

| Tool | What it is for |
|---|---|
| [`sprites/spritesheet.py`](#spritesheetpy) | Pack a folder of frames into a sprite sheet, unpack a sheet, compare two sheets |
| [`sprites/roundtrip.js`](#roundtripjs) | Prove the packer against the running game |
| [`sprite-viewer/`](#sprite-viewer) | Look at any entity's animations, or any sheet, in the browser |
| [`sprites/survey.py`](#surveypy) | Measure the existing art |

Background reading: [docs/sprites.md](../docs/sprites.md) (the format and how
animation works), [docs/art-style.md](../docs/art-style.md),
[docs/art-options.md](../docs/art-options.md).

**Art is never committed to this repo.** `images/` and `new_images/` are
gitignored. Unpack frames into `new_images/` or outside the repo, not into
`tools/` or `docs/`.

## spritesheet.py

Python 3 and [Pillow](https://pillow.readthedocs.io) (`pip install pillow`).

### pack

```bash
python3 tools/sprites/spritesheet.py pack new_images/joe1_wave --like images/joe1/sheet_Joe1_Normal.txt
```

Takes a folder of PNGs, one per frame, all the same size, and writes
`new_images/joe1_wave.png` and `new_images/joe1_wave.txt` beside the folder.

- **Order and names.** Frames go in name order, with `walk2` before `walk10`.
  `walk1.png` in a folder called `joe1` becomes the frame `joe1/walk1`.
- **The centre point** comes from the first of these that is given:
  1. `--center X,Y`
  2. `"center"` in the folder's `pack.json`
  3. `--like SHEET.txt`: copied from an existing sheet of the same character
  4. a guess: the bottom middle of what is drawn in the first frame. The packer
     says when it has guessed. Check it in the viewer.
- **Layout.** A grid, as near square as it can be. `--columns N` sets the row
  length.
- **The PNG** is written with a palette when the frames have 256 colours or
  fewer, like the original sheets, and as full colour otherwise. Either way no
  pixel changes.

| Option | Effect |
|---|---|
| `-o PATH` | Where to write, without extension. Default: the folder's own path. |
| `--like SHEET.txt` | Copy the centre and the name parent from this sheet. Frames must be the same size as its frames. |
| `--center X,Y` | Centre point, in pixels from the frame's top left. |
| `--parent NAME` | First half of the frame names. Default: the folder's name. |
| `--prefix NAME` | Name frames `parent/NAME_file`, for variants (`drunk`, `boner`, `broken`). |
| `--columns N` | Frames per row. |
| `--no-name-check` | Skip the search for clashing names (below). |

It stops with an explanation if the frames are not all one size or two frames
would get the same name. It warns if:

- the centre was guessed;
- a frame name is already used by another sheet in `images/` or `new_images/`.
  The game finds frames by name, so one would silently replace the other;
- the sheet is more than 4096 pixels on a side, which some phones cannot load.

**pack.json** is optional. Put it in the folder when the defaults are not
enough. `unpack` writes one.

```json
{
 "parent": "bartender",
 "center": [71, 143],
 "columns": 3,
 "frames": [
  {"file": "sniff1.png", "name": "bartender/sniff1"},
  {"file": "sniff2.png", "name": "bartender/sniff2", "center": [70, 143]}
 ]
}
```

Every key is optional. `frames` sets the order, and can give a frame its own
name or its own centre. PNGs in the folder that `frames` does not list are
added at the end, so new frames can be dropped in without touching the file.

### unpack

```bash
python3 tools/sprites/spritesheet.py unpack images/joe1/sheet_Joe1_Normal.txt new_images/work/joe1_normal
```

Writes one PNG per frame into an empty folder, plus a `pack.json` that records
the names, order, centre and column count. Packing that folder gives back the
same sheet. Use it to get frames to edit or to draw over.

### compare

```bash
python3 tools/sprites/spritesheet.py compare A.txt B.txt
```

Says whether two sheets hold the same frames: same names in the same order,
same sizes, same centres, same pixels. Where the frames sit inside the PNG may
differ. Exit code 0 when they match.

## roundtrip.js

```bash
node tools/sprites/roundtrip.js
```

The proof that the packer is right. For each sheet it unpacks, repacks with a
different number of columns so every frame moves, and then loads the game
twice in headless Chrome: once normally, once with the repacked sheet served
in place of the original. In both it draws every frame through the game's own
sprite code, facing right and mirrored, and plays a 240-frame scene in the test
arena. Every pixel has to match.

| Command | What it checks |
|---|---|
| `node tools/sprites/roundtrip.js` | The player's basic sheet and the OfficeAngel (about 10 seconds) |
| `node tools/sprites/roundtrip.js --all` | Every sheet in `images/` and `new_images/` (about a minute and a half) |
| `node tools/sprites/roundtrip.js path/to/sheet.txt` | The sheets named |
| `node tools/sprites/roundtrip.js --self-test` | Moves one centre by one pixel and passes only if that is caught |
| `... --keep DIR` | Keep the repacked sheets and two screenshots of the scene in `DIR` |

Needs what the tests need (the media pack, Chrome, the playtest skill's
`node_modules`; see `tests/README.md`) plus Python 3 with Pillow.

## Sprite viewer

```bash
python3 serve.py
```

then open `http://localhost:8000/tools/sprite-viewer/`.

A page like the level editor. It loads the game's own code and art, builds real
entities, and plays their animation states through the game's animation and
sprite code.

**Looking at an entity**

- Pick an **Entity** and a **State**. Every entity that sets up animations is
  listed. Entries starting with `·` are animations the entity keeps outside its
  states: effects it spawns, items it drops.
- **Enter from** plays the short transition a state has when it follows a
  particular state (idle after walk, for example).
- **Variant** swaps in prefixed frames: type `drunk` for the Bartender, `boner`
  for a Joe, `broken` for a prop.
- **Move speed** drives walk and run cycles, which play faster the faster the
  entity moves. Nothing moves in the viewer, so the slider stands in.

**Playback**

| Control | Key | Effect |
|---|---|---|
| Play / Pause | Space | |
| Restart | R | Start the state again from the top |
| Frame | Left, Right | Step to the previous or next picture |
| Tick | `,` and `.` | Step one game update (1/60 s) |
| Speed | | Slow motion |
| Replay one-shots | | Start a finished one-shot again after half a second |

The strip under the stage shows every frame of the state, numbered the way
`GetLastFrameIndex()` numbers them. Click one to jump to it.

**What is drawn over the sprite**

- **Yellow cross**: the centre point, where the entity's position is. The white
  line is the ground.
- **Dashed blue box**: the edges of the frame. Paler boxes are decorator
  layers.
- **Red box**: `hitRect`, the area on the ground where the entity can be hit.
  **Green box**: its height. **Green circle**: its collision radius.
- **Attack boxes**: tick an attack in the list, or leave "Attack boxes that
  name this state" on. The box is blue while the attack warms up, red while it
  can hit, and magenta while it cools down, timed from the start of the state
  as in the game. Step by tick to see which picture is showing when the box
  turns red. The numbers beside each attack are warm-up + active + cool-down in
  ticks.

**Now showing** lists what gameplay code would read at this moment: the frame
index, whether the frame is new this tick, the frame's name, size, place in the
sheet and centre.

**Looking at a sheet nobody uses yet**

- **Loaded**: any sheet the game already loads.
- **Path**: a sheet under the repo, such as `new_images/joe1_wave.txt`.
- **Files**: pick a `.png` and its `.txt` from anywhere on disk.

Runs of numbered frames become states (`walk1`…`walk8` plays as `walk`). Set
the speed with **Frames/sec**.

- **Centre**: the arrow buttons (or Shift + arrow keys) move the art against
  the cross. The `--center X,Y` shown beside them is what to give the packer.
- **Compare** draws another entity faintly behind, to check size and footing
  against the player or a Joe.

A sheet loaded this way replaces any frames of the same name, so after loading
a repacked sheet you can switch to the entity and see it with the new art.

**Links.** The page takes `?entity=Joe1&state=walk`, `?sheet=PATH`, and also
`&frame=N`, `&paused=1`, `&view=both|right|left`, `&zoom=1..8`.

## survey.py

```bash
python3 tools/sprites/survey.py
```

Reads every sheet and prints what the style guide's numbers are based on.

| Command | Prints |
|---|---|
| `survey.py` | Per sheet: frames, frame size, centre, colours, drawn size |
| `survey.py --actions` | Frames per action in each sheet |
| `survey.py --outline` | The colours on the outer edge of each character |
| `survey.py --palette SHEET.txt 40` | The 40 most used colours in one sheet |

## Other people's tools

- [ClusterColor](https://github.com/UrsaMaximus/ClusterColor) is the original
  programmer's batch sprite recolouring tool (C++ and Qt, MIT licence). It is a
  desktop application with no command line and no published builds, so nothing
  here calls it. It is the right tool for palette-swapped variants; build it
  from source with Qt.
- `DevScripts/WM-Sprite-Sheet-Creator.jsx` is the Photoshop script the original
  sheets were made with: one layer per frame, with layer groups named
  `parentName=...`, `centerX=...`, `centerY=...` and `prefix=...`.
  `spritesheet.py` writes the same format without Photoshop.
