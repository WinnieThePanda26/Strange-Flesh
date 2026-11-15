# Ways to make new art

Three ways to get new sprites for the game, what each would take to match the
existing art, and where each goes wrong. No art was made for this note.

What "matching" means is in [art-style.md](art-style.md): hard-edged pixel art
for a 640x360 screen, characters 125 to 150 pixels tall, 30 to 90 colours with
plum-and-navy darks and coloured outlines, and animation at 8 to 12 frames a
second. Anything new also has to be explicit gay adult art in places, which
narrows every option.

**Recommendation: edit the existing sprites. Commission an artist when you
want a whole new enemy. Do not use AI image tools for sprites that ship.**

## The three options

| | Commission an artist | Edit existing sprites | AI image tools |
|---|---|---|---|
| Good for | New enemies, anything with no close relative in the game | New moves for existing characters, variants, recolours, props, signs | Rough ideas to react to |
| Cost | Money: roughly $500 to $1,500 for a fighting-only enemy, several times that with a corruption sequence | Time and pixel-editing skill | Little money, a lot of clean-up time |
| Matches the style | If the artist is good and is given the guide | By construction: same pixels, same palette | No, not without redrawing |
| Stays consistent across frames | Yes | Yes | No. This is the main problem. |
| Licence position | Clear if agreed in writing | Clear once the media licence is confirmed | Unclear |

### 1. Commissioning an artist

What it takes:

- Someone who does animated pixel art at this size and is happy to draw
  explicit gay content. Both narrow the field; the second more than the first.
- A brief they can work from: [art-style.md](art-style.md), the character
  line-up from the sprite viewer, a list of animations with frame counts, and
  the canvas size and ground row. Ask for one PNG per frame on a fixed canvas.
  The packer and viewer then take it from there with no hand-editing.
- A paid test first: one idle and one walk cycle, checked in the viewer beside
  the player, before agreeing to the rest.

Size of the job, from the frame counts in the style guide:

- A fighting-only enemy is 20 to 30 frames.
- An enemy that can be corrupted, like the existing ones, is 40 to 95.
- A new move for the player is 3 to 8 frames, drawn twice (sober and drunk).

Cost is a rough estimate, not a quote. Public price lists for pixel animation
run from about $10 to $20 a frame for small simple sprites up to $20 a frame
plus a base fee of $100 or more at 128 pixels. These frames are large and
detailed, so expect the upper end or above: perhaps $20 to $50 a frame. Get
quotes.

Problems:

- **Licence.** The game is CC BY-NC-SA 4.0. An artist's work can only go into
  it if they agree, in writing, to release it under that licence (or assign it
  to you). Agree credit at the same time. Without that, you have a picture you
  may look at, not one you may ship.
- **Consistency** depends on the artist. A second artist will not draw like the
  first. One artist for one character.
- It costs real money on a non-commercial project that cannot earn it back.

### 2. Editing existing sprites

This is how the one piece of new art so far was made:
`new_images/bartender_sniff` is three frames built from the player's
smoke-charge poses with a bottle painted into his fist.

What it takes:

- `spritesheet.py unpack` to get frames, a pixel editor (Aseprite, Piskel,
  GIMP), and `spritesheet.py pack --like` to put them back. Canvas, centre and
  palette carry over untouched.
- For recolours, UrsaMaximus's
  [ClusterColor](https://github.com/UrsaMaximus/ClusterColor), the original
  programmer's batch sprite recolouring tool, is the purpose-built option. It
  is a desktop application with no command line and no ready-made download, so
  it has to be built from source with Qt. Palette-swapped enemies are an old
  beat-'em-up habit and a cheap way to get "new" enemies with different stats.

What it can do:

- New moves for existing characters, assembled from poses they already have.
- Variants: a recoloured enemy, a prop in a broken state, a character holding
  something.
- Props and signs. These are small, single frames, and the simplest things to
  draw from scratch in the existing palette.

What it cannot do:

- A new enemy. Rearranged parts of old enemies look like what they are.
- A pose nobody has drawn. If no frame has the arm at that angle, someone has
  to draw the arm, which is option 1 at a small scale.

Problems:

- **Licence.** The source files say Strange Flesh is under CC BY-NC-SA 4.0,
  which allows adaptations as long as they are non-commercial, credited and
  shared under the same licence. I found no licence file for the media itself,
  in this repo or in the unpacked `images/` and `sound/` folders. It is
  reasonable to read the game's licence as
  covering its art, but it is worth asking Greatest Bear Studios before
  publishing edited art. Until then, keeping it in the private `new_images`
  repo is the safe position.
- It only looks good if the edits are done at the pixel level with the existing
  colours. Scaling, rotating or soft brushes break the style at once.

### 3. AI image tools

What it would take to match this game:

- Image generators do not produce pixel art. They produce pictures that look
  like pixel art: the "pixels" are not on a grid, there are thousands of
  colours, and edges are soft. Each output has to be shrunk to true size, cut
  down to a palette, and cleaned up by hand.
- **They do not hold a character still between frames.** An animation is the
  same character redrawn 8 or 20 times with only the pose changing. Generated
  frames drift: the face, the costume, the proportions and the lighting all
  move. Fixing that is redrawing.
- To get near this style at all, a model would have to be tuned on the game's
  own sprites.
- The mainstream hosted tools refuse explicit content, which rules them out for
  a large part of what this game needs. Models that will draw it have to be run
  locally.

Problems:

- **Licence and ownership are unsettled.** The US Copyright Office's position
  (January 2025) is that a picture generated from a prompt has no human author
  and cannot be copyrighted; only a person's own changes to it can be. Art that
  nobody owns cannot be cleanly licensed under CC BY-NC-SA. The tools' own
  terms of use add a second layer.
- **Tuning a model on the original artists' sprites** is the step that would
  make the style match, and it is the one most likely to be objected to, by the
  original artists and by the game's audience, whatever the licence allows.
- The clean-up needed to make the result usable is most of the work of option 2
  anyway, starting from worse material.

Where it could reasonably be used: throwaway sketches to decide what an enemy
should be before briefing an artist. Not for anything that goes in a sheet.

## Why this recommendation

- The two things wanted soonest, new animations for existing characters and
  props, are exactly what editing does well. It is free, the result matches by
  construction, and it has already worked once here.
- A new enemy needs an artist. Nothing else in this list produces one that
  looks like it belongs. The pipeline is ready for that: a style guide to brief
  from, a packer that takes a folder of frames, and a viewer to check the
  result against the player before anything is wired in.
- AI tools fail on the one thing sprite animation needs most, the same
  character in every frame, and bring licence questions the other two do not.

Before publishing any new art, by any route: confirm the media licence with
Greatest Bear Studios, and credit whoever drew or edited it.
