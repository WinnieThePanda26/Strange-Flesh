# Sprites and animation

How a drawing becomes something that moves in the game: the sheet files, how
frames become animation states, what the centre point does, how timing and
layers work, and where gameplay hooks into animation. Written from the code;
line links point at the code each claim comes from.

The tools that go with this are in [`tools/`](../tools/README.md). The look of
the art is in [art-style.md](art-style.md).

## The short version

1. Draw each frame as its own PNG, all on the same size canvas, facing right.
2. Pack the folder: `python3 tools/sprites/spritesheet.py pack FOLDER --like EXISTING_SHEET.txt`.
   This writes `FOLDER.png` and `FOLDER.txt`.
3. Look at it in the sprite viewer (`python3 serve.py`, then
   `http://localhost:8000/tools/sprite-viewer/`). Check the centre point and the
   mirrored version.
4. Register the sheet with one `AddImageResource` line, and add the frames to an
   animation state in the entity's `animationSetup()`.

Art never goes into this repo. See [Where art lives](#where-art-lives).

## Sheet files

A sprite sheet is two files with the same name: a PNG holding every frame, and
a `.txt` holding JSON that says where each frame is. The only new-art example
so far is `new_images/bartender_sniff.png` and `.txt`:

```json
{"width":450,"height":160,"frames":[
 {"name":"bartender/sniff1","width":150,"height":160,"originX":0,"originY":0,"centerX":71,"centerY":143},
 {"name":"bartender/sniff2","width":150,"height":160,"originX":150,"originY":0,"centerX":71,"centerY":143},
 {"name":"bartender/sniff3","width":150,"height":160,"originX":300,"originY":0,"centerX":71,"centerY":143}]}
```

| Field | Meaning |
|---|---|
| `width`, `height` (top level) | Size of the PNG. **The game never reads these.** `sheet_GagExplosion.txt` says 1730x1820 for a 3936x182 image and works. |
| `frames[].name` | The frame's name, and its key in the game's one global table of sprites. Animations ask for frames by this name. |
| `frames[].width`, `height` | Size of the frame, in pixels. |
| `frames[].originX`, `originY` | Top-left corner of the frame inside the PNG. |
| `frames[].centerX`, `centerY` | The centre point, in pixels from the frame's own top-left corner. See [The centre point](#the-centre-point). |

All seven frame fields are required and are whole numbers. Nothing else is read.

What the 81 existing sheets have in common (the game does not require any of
this, but the tools assume the first two):

- Every frame in a sheet is the same size, laid out in a grid, left to right
  then top to bottom.
- Every frame in a sheet has the same centre. Nine sheets have a few frames
  with their own centre (a projectile sharing a sheet with its thrower, for
  example).
- Names are `parent/action` plus a number from 1: `bartender/walk1` …
  `bartender/walk8`. The parent is usually the character. Variants put a prefix
  after the slash: `bartender/drunk_walk1` (see [Variants](#variants-prefixes)).
- The PNG has a palette (256 colours or fewer) and hard-edged transparency.
  This is a file-size choice. The browser decodes any PNG.

### How a sheet is loaded

- `GlobalResourceLoader.AddImageResource(key, "path/to/sheet.txt")` queues a
  sheet. A path ending in `.txt` means "sheet": the loader fetches the JSON and
  the PNG beside it ([ResourceLoader.js:21](../ResourceLoader.js#L21)). The
  `key` only has to be unique; a second call with the same key is ignored
  ([ResourceLoader.js:757](../ResourceLoader.js#L757)). These calls sit at the
  top level of the entity's file, so they run when the file is included, for
  example [Bartender.js:2410](../Bartender.js#L2410).
- When both files have arrived, `GenerateSprites` makes one `Sprite` per frame
  and stores it under the frame's name
  ([ResourceLoader.js:87](../ResourceLoader.js#L87)).
- A path ending in `.png` is a single image. It becomes one sprite named after
  the `key`, with its centre at its top-left corner (0, 0)
  ([ResourceLoader.js:93](../ResourceLoader.js#L93)). Backgrounds, signs and
  HUD icons are loaded this way.

Two things to know about names:

- **A name that is not in any sheet draws nothing, with no error.**
  `GetSprite` hands back an empty sprite for any name it has not seen
  ([ResourceLoader.js:983](../ResourceLoader.js#L983)), and an empty sprite
  skips its draw. A missing frame in an animation is a typo to look for.
- **Two sheets with the same frame name: the one that loads last wins.** Load
  order is not fixed. The packer warns about clashes.

## Scale

The game draws to a 640x360 canvas and scales that up to the window
([StrangeFlesh.js:104](../StrangeFlesh.js#L104)). Game code works in a
1920x1080 space, three times larger.

- **One sprite pixel is one pixel of the 640x360 canvas**, and three world
  units. Sprites are drawn with `DrawSprite3x`, which multiplies by 3
  ([ResourceLoader.js:318](../ResourceLoader.js#L318)), and the camera scales
  by 360/1080 ([CanvasCamera.js:108](../CanvasCamera.js#L108)).
- Numbers in entity code (positions, hit boxes, speeds) are world units. Divide
  by 3 to get sprite pixels. Entities carry `this.scale = 3.0` and write sizes
  as `this.scale * pixels` for this reason
  ([WalkingEntity.js:187](../WalkingEntity.js#L187)).
- Decorator offsets are the exception: they are in sprite pixels (see
  [Decorator layers](#decorator-layers)).

## The centre point

An entity has a position on the ground, `posX`, `posY`, and a height above it,
`posZ`. The centre point is the pixel of the frame that is drawn at that
position: `DrawSprite3x` puts the frame's top-left corner at
`-centerX * 3, -centerY * 3` from where the entity is
([ResourceLoader.js:323](../ResourceLoader.js#L323), called from
[Animation.js:200](../Animation.js#L200) with `-posZ` as the height).

So for anything that stands on the ground, **the centre is where its feet meet
the ground**, midway between them. The player's frames are 150x160 with the
centre at (71, 143): his boots reach row 146, three rows lower, because the
near foot is drawn a little lower than the far one. The rows below that are
spare canvas. Standing characters all sit like this, with the lowest pixel of
the feet 3 to 6 rows below the centre. Shadows, hit boxes and the order things are drawn in
([EntityList.js:79](../EntityList.js#L79), by `posY`) all hang off the same
point, so a centre that is a few pixels off shows up as feet that float, sink
or slide when the character turns.

The centre is the same for every frame of an animation in nearly all the
existing art. Keep it that way: draw every frame on the same canvas with the
ground in the same place, and let the pose move inside the canvas. A character
that lunges forward does it by being drawn further right in the frame, not by
moving the centre.

The centre may be outside the frame. `sheet_Bartender_Joe4Sex_Spitroast_Smoke`
has `centerX` of -63: a small frame drawn well to the right of the entity.

### Mirroring

Sheets hold one facing only: **right**. The left-facing version is made at draw
time by mirroring the frame about the vertical line through the centre point
([ResourceLoader.js:325](../ResourceLoader.js#L325), using
`drawImageFlipped` at [ResourceLoader.js:129](../ResourceLoader.js#L129)).
Nothing is stored flipped; that halves the game's sprite memory, which matters
on phones.

What follows from that:

- The mirror line is the left edge of pixel column `centerX`. A frame whose
  centre is not in the middle swings out the other way when mirrored: the
  player's attack frames are 223 wide with the centre at 73, so the punch
  reaches 150 pixels right when facing right and 150 left when facing left.
- Anything with a handedness flips with it: writing, a logo, a scar, which hand
  holds the bottle. If it must not flip, it needs its own animation that does
  not mirror (see `inheritFacing` below).
- Whether an animation mirrors at all is set per animation, by `inheritFacing`
  ([Animation.js:507](../Animation.js#L507),
  [Animation.js:986](../Animation.js#L986)):

| `inheritFacing` | Drawn mirrored when |
|---|---|
| 0 (default) | never |
| 1 | the owner faces left. This is what characters use. |
| 2 | the owner faces right, for art drawn facing left |
| 3 | always |

## From frames to animation states

Three kinds of object, all in [Animation.js](../Animation.js):

- **`Animation`**: a list of frames with a position that runs from 0 to 1
  ([Animation.js:493](../Animation.js#L493)).
- **`AnimationState`**: one main `Animation`, plus optional decorator
  animations drawn on top and optional transition animations
  ([Animation.js:300](../Animation.js#L300)).
- **`AnimationModel`**: an entity's named states and which one is current
  ([Animation.js:12](../Animation.js#L12)). Each entity has one, as
  `this.animationModel`.

An entity builds its states once, in `animationSetup()`, called from its
constructor. A whole state from
[OfficeAngel.js:414](../OfficeAngel.js#L414):

```js
var walkAnim = new Animation(this);
walkAnim.repeat = 1;                 // loops
walkAnim.dynamicRate = 1;            // plays faster the faster she moves
walkAnim.inheritFacing = 1;          // mirrored when facing left
walkAnim.matchPosition = true;
walkAnim.AddSequentialFrames("officeangel/walking{0}",1,4);
walkAnim.SetDurationInSeconds(6.4);
var walkState = new AnimationState();
walkState.SetMainAnimation(walkAnim);
this.animationModel.AddState("walk", walkState);
```

Gameplay then picks a state by name every tick, from the entity's
`UpdateState`: `this.animationModel.ChangeState("walk")`. Asking for the state
that is already playing does nothing; asking for a different one restarts it
([Animation.js:78](../Animation.js#L78)). A name with no state falls back to
`"idle"`, so every entity needs an `"idle"`
([Animation.js:158](../Animation.js#L158)).

Ways to add frames:

| Call | Adds |
|---|---|
| `AddFrame(name)` | one frame ([Animation.js:750](../Animation.js#L750)) |
| `AddSequentialFrames("x/walk{0}", 1, 8)` | `walk1` … `walk8`. Give the numbers the other way round to play backwards ([Animation.js:691](../Animation.js#L691)) |
| `HoldFrame(name, n)` | the same frame `n` times, to hold it ([Animation.js:836](../Animation.js#L836)) |
| `AddBlankFrame()`, `AddBlankFrames(n)` | frames that draw nothing ([Animation.js:846](../Animation.js#L846)) |
| `new Animation(owner, "x/puff{0}", 3, 0.6, 0)` | shorthand: frames 1 to 3, 0.6 seconds, repeat mode 0 ([Animation.js:537](../Animation.js#L537)) |

**Frame index.** Frames are numbered from 0 in the order they were added. Held
and blank frames each take a number. This index is what gameplay hooks use (see
[Gameplay hooks](#gameplay-hooks)), and it is not the number in the frame's
name: `officeangel/idle{0}` 2 to 13 are frames 0 to 11.

## Timing

The game updates 60 times a second. On each update the current state's
animation moves its position forward by `baseRate`
([Animation.js:895](../Animation.js#L895), called from
[WalkingEntity.js:602](../WalkingEntity.js#L602)). Each frame has a position
between 0 and 1, and the frame on screen is the last one whose position has
been passed ([Animation.js:991](../Animation.js#L991)).

Sheets hold no timing. All of it is in `animationSetup()`.

**How long the whole animation takes**

| Call | Effect |
|---|---|
| `SetDurationInSeconds(s)` | one pass takes `s` seconds ([Animation.js:880](../Animation.js#L880)) |
| `SetDurationByFramerate(fps)` | each frame lasts 60/`fps` ticks ([Animation.js:885](../Animation.js#L885)) |
| `MatchFramerate(other)` | same time per frame as another animation ([Animation.js:890](../Animation.js#L890)) |
| nothing | 4 seconds. That is the default `baseRate` and is never what you want ([Animation.js:510](../Animation.js#L510)) |

**How the time is shared between frames**

- `AddFrame` and friends space every frame evenly. Each call re-spaces all of
  them, so it undoes any hand timing done before it.
- `SetPosition(index, position)` moves one frame's start, as a fraction of the
  whole ([Animation.js:870](../Animation.js#L870)). Call it after the last
  `AddFrame`. The player's jump does this
  ([Bartender.js:2522](../Bartender.js#L2522)).
- `AddFrameAtFramerate(name, fps)` and `AddSequentialFramesAtFramerate` give
  each frame its own length, then `NormalizeAnimationTiming()` turns the total
  into the duration ([Animation.js:712](../Animation.js#L712),
  [Animation.js:738](../Animation.js#L738)). Use these for an animation whose
  parts run at different speeds.
- `AddTimedFrame(name, seconds)` puts a frame at a time in seconds. It uses the
  duration as it is at that moment, so set the duration first
  ([Animation.js:763](../Animation.js#L763)).

**What happens at the end**: `repeat`
([Animation.js:550](../Animation.js#L550))

| `repeat` | Behaviour |
|---|---|
| 0 | One-shot. Stops on the last frame and sets `done`. |
| 1 | Loop. |
| 2 | Bounce: forward to the end, back to the loop start, and so on. |
| 3 | For transitions only: runs to whichever end is nearer, then is done. |

`SetLoopByFrame(start, end)` makes a loop or bounce cover only part of the
animation, so it can have a lead-in that plays once
([Animation.js:817](../Animation.js#L817)).

**Speed that follows movement**: with `dynamicRate = 1` each update moves the
position by `baseRate` times the owner's speed
([Animation.js:901](../Animation.js#L901)). The duration is then the time at a
speed of 1, which is why walk cycles say 6.4 seconds: at a walking speed of 8
that is 0.8 seconds. A stationary owner freezes the animation.

**Carrying position between states**: when a state starts, its animation can
pick up where the last one was, so that walk and run stay in step
([Animation.js:1035](../Animation.js#L1035)).

| `matchPosition` | Starts at |
|---|---|
| 0 or `false` (default) | the beginning |
| 1 or `true` | the previous state's position |
| 2 | one minus the previous state's position |

Setting `sendPosition = false` on an animation makes it hand on 0 instead of
its position ([Animation.js:458](../Animation.js#L458)).

## Decorator layers

A state can have extra animations drawn over the main one:
`state.AddDecoratorAnimation(anim)`. The model draws the main frame, then each
decorator in the order added ([Animation.js:153](../Animation.js#L153)). They
are how the player smokes while walking: the legs and body are the main
animation, the smoking arm is a decorator shared by several states
([Bartender.js:2681](../Bartender.js#L2681)).

- A decorator runs on its own clock, with its own `repeat` and duration. It is
  updated every tick alongside the main animation
  ([Animation.js:346](../Animation.js#L346)).
- A decorator is restarted when its state is entered, unless the previous state
  had the very same animation object in the same slot. Sharing one object
  between "smokewalk" and "smokeidle" is what keeps the arm from restarting
  when the player stops ([Animation.js:473](../Animation.js#L473)).
- **Offsets.** Each frame of the *main* animation can carry an offset, the
  second and third arguments of `AddFrame(name, offsetX, offsetY)` or
  `SetDecoratorOffset(index, x, y)`. Decorators are moved by the offset of
  whichever main frame is showing, so the arm bobs with the walk. Offsets are
  in sprite pixels, and X flips with facing
  ([Animation.js:228](../Animation.js#L228),
  [Animation.js:244](../Animation.js#L244)). A decorator with
  `useDecoratorOffset = false` ignores them.
- A decorator frame is a normal frame from a sheet, with the same centre as the
  body it sits on. Draw it on the same canvas as the body.
- Use blank frames to hide a decorator for part of the animation
  ([Bartender.js:2836](../Bartender.js#L2836)).
- `blendMode` and `alpha` are per animation. Smoke uses `"lighter"`
  ([Bartender.js:2442](../Bartender.js#L2442)).

An entity that needs something drawn *between* layers overrides `DrawSprite`
and calls `DrawBase()` and `DrawDecorator(n)` itself. The player does this to
put a grabbed enemy behind his forearm
([Bartender.js:470](../Bartender.js#L470)).

One trap: while a transition is playing, decorators that use offsets are not
drawn. `AnimationState.GetFrame` stores the transition animation where a frame
is expected ([Animation.js:425](../Animation.js#L425)), so the offset comes out
as not-a-number. No state has both today.

## Transitions

A state can have a short animation that plays first when it is entered from
one particular state: `idleState.AddTransitionAnimation("walk", walkToIdle)`
plays `walkToIdle` whenever "idle" follows "walk", then goes on to the idle
loop ([Animation.js:453](../Animation.js#L453),
[Bartender.js:2465](../Bartender.js#L2465)). While it plays, it stands in for
the main animation.

## Variants (prefixes)

`animationModel.ApplyPrefix("drunk")` swaps every frame in every state for the
frame with `drunk_` after the slash, where one exists: `bartender/walk1`
becomes `bartender/drunk_walk1`. Frames with no such twin stay as they are.
`ClearPrefix` swaps them back ([Animation.js:588](../Animation.js#L588)).

The game uses `drunk` (the player), `boner` (the Joes) and `broken` (props).
To add a variant, draw the same frames, pack them with `--prefix NAME`, and
register the sheet. No animation code changes.

## Gameplay hooks

Gameplay reads the animation in four ways. All of them break quietly if the
art changes and the code does not, so check them when frames are added or
removed.

**1. "The animation reached frame N."** For a footstep, a projectile, a
wing-flap:

```js
if (this.animationModel.WasLastFrameActivation(4))
    this.wingflapSFX.Play(0.3);
```

`WasLastFrameActivation(n)` is true on the one tick where frame index `n` first
appears ([Animation.js:287](../Animation.js#L287)). The longer form is
`GetLastFrameIndex() === n && GetLastFrameWasTransition()`. Examples:
[FartherFigure.js:139](../FartherFigure.js#L139),
[PartyAnimal.js:194](../PartyAnimal.js#L194), and the player's footsteps on
walk frames 0 and 4 ([Bartender.js:1005](../Bartender.js#L1005)).

- `n` is the frame index described above, not the number in the frame's name.
- These flags are refreshed when the frame is **drawn**, not when it is
  updated ([Animation.js:1011](../Animation.js#L1011)). The game draws once
  per update, so this works, but code that steps the game without drawing gets
  different results. The test harness draws for this reason.

**2. "The animation finished."** `AnimationIsComplete("getup")` is true once a
one-shot has run out ([Animation.js:96](../Animation.js#L96)). State machines
use it to move on ([OfficeAngel.js:261](../OfficeAngel.js#L261)). The length of
a get-up, a death or a corruption scene is therefore the length of its
animation.

**3. "The loop came round."** `endFrame` and `startFrame` are true on the tick
a loop wraps, and `AnimationLoopHitEnd` says whether it ever has
([Animation.js:108](../Animation.js#L108)).

**4. Attacks, which do not read the animation at all.** An `Attack` counts
ticks: `warmupframes`, then `attackFrames` during which it can hit, then
`cooldownframes` ([Combat.js:69](../Combat.js#L69),
[Combat.js:343](../Combat.js#L343)). The player starts the attack and the
animation on the same tick
([Bartender.js:1079](../Bartender.js#L1079)); the attack's `animationTriggered`
field names the state to play. After that they run separately. The light punch
is a 0.18 second, 3-frame animation, and an attack of 1 + 1 + 17 ticks
([Bartender.js:229](../Bartender.js#L229),
[Bartender.js:2560](../Bartender.js#L2560)). If a new punch has a longer
wind-up, the animation and `warmupframes` both have to change, or the hit lands
before the fist does. The sprite viewer shows the two against each other.

## Hit boxes

Hit boxes are not in the sheet. They are numbers in the entity's constructor,
in world units (three per sprite pixel), measured from the centre point:

| Field | What it is |
|---|---|
| `hitRect` | The area on the ground where attacks can reach the entity: a rectangle in X (left and right) and Y (depth into the screen) ([WalkingEntity.js:202](../WalkingEntity.js#L202)) |
| `zHeight` | How tall the entity is, for attacks ([WalkingEntity.js:187](../WalkingEntity.js#L187)) |
| `collisionRadius` | The circle that stops entities walking through each other and through walls |
| `attack.attackbox`, `zHeight`, `zSize` | Where an attack reaches on the ground, and the band of height it covers ([Combat.js:35](../Combat.js#L35)). The box is mirrored when the owner faces left ([Combat.js:181](../Combat.js#L181)). |

A new character needs these set. They are tuning more than measurement:
`zHeight` is written as `this.scale` times a height in sprite pixels, and
existing characters use 100 to 130 whatever their size (the player is 117
pixels tall and uses 110; the last boss is 226 tall and uses 120).

## The tools

Details and every option are in [`tools/README.md`](../tools/README.md).

| Tool | Use |
|---|---|
| `tools/sprites/spritesheet.py pack` | Folder of frame PNGs to a sheet. Works out every `originX`/`originY`; takes the centre from `--like`, `--center` or a guess. |
| `tools/sprites/spritesheet.py unpack` | A sheet back to frame PNGs, to edit existing art. |
| `tools/sprites/spritesheet.py compare` | Do two sheets hold the same frames? |
| `tools/sprites/roundtrip.js` | Proves the packer: repacks sheets and checks the game draws them pixel for pixel the same. |
| `tools/sprite-viewer/` | Plays any entity's states, or any sheet, with the centre, frame edges, hit boxes and mirrored version shown. |
| `tools/sprites/survey.py` | Measures the existing art (sizes, colours, frames per action). |

### Adding an animation to an existing character

1. Find the sheet the character's similar frames are in, and draw on the same
   size canvas with the feet in the same place. Unpacking that sheet gives you
   frames to draw over.
2. `python3 tools/sprites/spritesheet.py pack new_images/joe1_wave --like images/joe1/sheet_Joe1_Normal.txt`.
   `--like` copies the centre and the `joe1/` name parent, and refuses frames
   of a different size.
3. Open the viewer with `?sheet=new_images/joe1_wave.txt`, set Compare to the
   character's idle, and check the feet and the mirrored side.
4. In the character's file, add
   `GlobalResourceLoader.AddImageResource("sheet_Joe1_Wave","new_images/joe1_wave.txt");`
   next to its other sheets, and a state in `animationSetup()`.
5. Reload the viewer and pick the entity and the new state to see it with its
   real timing and hit boxes.

### Adding a new character

1. Pick a canvas size with room for the widest pose, and a ground row. Draw
   everything on it.
2. Pack with `--parent yourcharacter`. With no `--center` the packer guesses
   the bottom middle of the first frame and says so. In the viewer, nudge the
   centre with the arrow buttons until the cross sits between the feet, then
   repack with the `--center X,Y` it shows.
3. Copy an existing enemy file of the same kind (see `CLAUDE.md`, "Entities"),
   add an `include()` line for it in `JoeLevelAssets.js`, and write its
   `animationSetup()`. It needs at least `"idle"`.
4. Set `hitRect`, `zHeight` and `collisionRadius` to fit, checking in the
   viewer.

### Adding a prop or a sign

A single PNG with no `.txt` is enough when it is one picture drawn from its
top-left corner (signs, backgrounds). A prop that can break needs a sheet: the
whole version, a `broken_` version of each frame, and its pieces. See
`images/props/sheet_Props.txt` and [PottedPlant.js](../PottedPlant.js).

### After changing art

- Changing a sheet's layout, or repacking it, changes nothing in play.
- Changing frame counts, durations or attack timing changes gameplay and so
  breaks the replay tests. Run `node tests/run.js`; if the change was meant,
  re-baseline as `tests/README.md` describes.

## Where art lives

- `images/` and `sound/` are the original media pack. They are gitignored and
  are not in this repo.
- `new_images/` is new art. It is gitignored here and versioned in its own
  private, local repo.
- **Never commit art, from either folder, to this repo.** That includes frames
  unpacked from a sheet. Unpack into `new_images/` or somewhere outside the
  repo, not into `tools/` or `docs/`.
