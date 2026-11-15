# Art style guide

What the existing art does, so that new art sits beside it without standing
out. Sizes, colour counts and frame counts were measured from the media pack
with [`tools/sprites/survey.py`](../tools/sprites/survey.py); run it to see the
numbers for every sheet. The notes on shading and outlines come from looking at
the sprites enlarged, and are marked "by eye".

How sheets and animation work is in [sprites.md](sprites.md).

## Pixel scale

- **One art pixel is one pixel of a 640x360 screen.** The game scales that
  screen up to the window with hard edges, so at 1080p each art pixel is a 3x3
  block.
- Nothing is rotated or resized when drawn. The pixels you draw are the pixels
  shown, apart from mirroring.
- Think of the canvas as 640x360. A 128-pixel character is a third of the
  screen tall.
- Edges are hard. No character, enemy or effect sheet has a single
  half-transparent pixel: a pixel is either there or not. Only the prop sheets
  (`sheet_Props`, `sheet_Debris`) have soft edges, and they look softer than
  everything else for it. Keep new art hard-edged.
- Draw facing right. The game mirrors for left.

## Sizes

Standing pose, in pixels: what is drawn, the canvas it is drawn on, and where
the centre point is on that canvas.

| Character | Kind | Drawn (w x h) | Canvas | Centre |
|---|---|---|---|---|
| Bartender (player) | player | 107 x 117 | 150 x 160 | 71, 143 |
| Joe0 | office worker | 40 x 128 | 104 x 137 | 48, 128 |
| Joe1 | thin Joe | 35 x 128 | 165 x 150 | 65, 139 |
| Joe2 | | 56 x 130 | 200 x 152 | 84, 135 |
| Joe3 | | 75 x 137 | 167 x 170 | 74, 153 |
| Joe4 | big Joe | 108 x 150 | 240 x 180 | 90, 168 |
| Joe5 | last boss | 239 x 226 | 287 x 329 | 166, 304 |
| OfficeAngel | small | 48 x 88 | 128 x 128 | 64, 98 |
| Bottley | tiny | 38 x 31 | 235 x 111 | 70, 96 |
| PunkPuppy | four legs | 85 x 81 | 154 x 188 | 78, 128 |
| Fister | | 99 x 101 | 231 x 119 | 78, 100 |
| PartyAnimal | | 93 x 122 | 123 x 155 | 70, 147 |
| VirusFromVenus | | 116 x 130 | 211 x 162 | 80, 130 |
| ColombianRescue | | 109 x 105 | 229 x 180 | 122, 157 |
| Dissolution | | 95 x 99 | 175 x 174 | 108, 140 |
| StarvingArtist | wide, low | 145 x 102 | 212 x 134 | 100, 105 |
| EDRider | rider | 178 x 130 | 245 x 188 | 120, 152 |
| Admonitor | large | 170 x 156 | 265 x 200 | 157, 165 |

What to take from it:

- **A person is 125 to 150 pixels tall.** The Joes go from 128 (Joe0, Joe1) to
  150 (Joe4), getting wider much faster than they get taller: 35 wide to 108
  wide. The player is only 117 tall because he stands in a crouch; he is as
  wide as Joe4.
- **Monsters are 80 to 130 tall** and vary in shape more than in height.
- **The canvas is much bigger than the standing pose**, usually 1.5 to 3 times
  as wide. It has to hold the widest frame of every animation in the sheet: a
  swing, a fall, a projectile. Work out the biggest pose first, then fix the
  canvas.
- When one character's poses differ a lot in size, the art uses a second canvas
  in a second sheet. The player's basic moves are on 150x160 and his attacks on
  223x166, each with its own centre.
- **Feet.** The centre sits between the feet, with the lowest foot pixel 3 to 6
  rows below it. Leave at least that many rows under the centre.
- Props are on a 152x236 canvas and are about 60 x 110 drawn. Their broken
  pieces are 32x32.

## Colour

Measured:

- A character sheet mostly uses **30 to 90 colours**. The middle sheet has 53.
  The player has 60, Joe1 35, Bottley 28. Admonitor and ColombianRescue are
  the high end at about 120.
- There is no single palette shared by the whole game. Each character has its
  own set of colour ramps.
- Smoke is a flat grey silhouette of one to three colours (`#63737b`,
  `#717171`, `#848484`), brightened by the game when it is drawn.

By eye, the habits that hold across characters:

- **The darks are never grey or pure black.** They are deep plum and navy:
  `#290029`, `#181839`, `#080000` on the player; `#2e2b52`, `#201723` on Joe1;
  `#220609` on Joe2 and Joe3; `#00262e` on the boss.
- **Shading shifts hue, not just brightness.** Shadows lean purple or blue,
  highlights lean pale yellow or cyan. Skin runs peach to pink to plum:
  `#ffefd6`, `#f7cea5`, `#de846b` on the player; `#ecb88c`, `#d48a9a`,
  `#b9557e` on Joe1.
- **Three to five steps per material**, in flat, clean-edged patches. No
  dithering, no gradients, no noise.
- **Small hard highlights**: two to four pixels of near-white on buttons,
  knuckles, boots and glass.
- A few families of colour turn up everywhere: mint and teal (`#d6f7f7`,
  `#8cbdad`, `#297b84`, `#87d378`), crimson (`#ef3131`, `#b5395a`), purple
  (`#63397b`, `#39085a`). The backdrops are dusky plum (`#5c4458` in the test
  arena). New characters that draw from those families will look at home.
- Light comes from above: tops of heads, shoulders and fists are lightest.

To copy a palette exactly:
`python3 tools/sprites/survey.py --palette images/joe1/sheet_Joe1_Normal.txt 40`.

## Outlines

**There is no black outline.** The outer edge of a sprite is the darkest shade
of whatever it borders, so the edge is coloured and changes along the figure.
Measured as the colours of the pixels that touch transparency:

| Sheet | Edge is mostly |
|---|---|
| Player | near-black `#080000`, `#000010` (half the edge), then navy and plum |
| Joe0, Joe1 | navy `#2e2b52` and plum `#201723` (about 40%) |
| Joe2, Joe3 | dark maroon `#220609` |
| Joe5 | dark teal `#00262e` (half) and plum `#331b3b` |
| OfficeAngel | slate `#2b3844` (a third); her wings have light green edges |
| PunkPuppy | mid teal `#4c907d`; no dark edge on the white fur |
| Fister | purple `#753273` |
| Bottley | pale `#ffe3c0`: glass with no dark edge at all |

- The player has the darkest edge in the cast, which helps him read against
  any background and any crowd.
- Human enemies have a dark coloured edge. Monsters often have a mid-tone edge,
  and pale parts (wings, fur, glass, bone) are left with no dark edge.
- Inside the figure, the same dark tone is used as a 1-pixel line to part limbs
  from the body, and not much else. Forms are separated by colour more than by
  line.
- The edge is one pixel wide.

## Proportions and pose (by eye)

- Caricature, top-heavy: huge shoulders, arms and fists; small hips, short
  legs, small feet. Heads are about a fifth of the height.
- Three-quarter view, facing right, seen from slightly above. The far foot is
  drawn a little higher than the near one.
- Idle poses are loaded, not neutral: fists up, weight low.
- Every enemy has a strong, different silhouette. Shape tells them apart before
  colour does.

## Frames per action

Counted from the frame names in each sheet. Timings are from the
`animationSetup()` code.

| Action | Frames | Typical length |
|---|---|---|
| Idle | 1 for most enemies; 6 to 8 where it moves (player 8, Joe5 8, OfficeAngel 12) | 1 to 2 s loop |
| Walk | 4 to 8 (OfficeAngel 4, Bottley 6, Joe1 7, player 8). PunkPuppy has 12 | about 0.6 to 0.8 s per cycle at walking speed |
| Run | 8 (player) | |
| Jump | 4 (player) | 0.5 s |
| Light attack | 3 to 5 (player punch 3, kick 5; PunkPuppy 4) | 0.18 to 0.3 s |
| Heavy or wind-up attack | 6 to 18 (player tackle 6, Fister 7, Joe1 8, StarvingArtist 9, VirusFromVenus 13, Joe2 17, Joe5 guitar 18) | 0.5 s and up |
| Hit stun | 1 for every enemy; 4 for the player | 0.5 s hold |
| Fall / knockout | 4 to 6 (up to 9 to 12 for a few) | 0.4 s |
| Get up | 2 to 7 (Fister, PunkPuppy and PartyAnimal 2; player and Joe2 6) | 0.3 s |
| Corruption (the change) | 4 to 22 | 2 s |
| Corrupted loop | 4 to 16 | 1.5 s loop |
| Orgasm | 6 to 24 | 2.4 s |

- Most animation plays at **8 to 12 frames a second**. Fast attacks play at
  about 17.
- Whole enemies: Fister 41 frames, EDRider 42, PartyAnimal 62, PunkPuppy 63,
  OfficeAngel 71, ColombianRescue 74, Dissolution 88, StarvingArtist 96.
- **The corruption sequence is half the work.** An enemy's change, loop and
  orgasm together are 17 to 57 frames, about as many as all its fighting
  moves.
- A fighting-only enemy can be done in about 20 to 30 frames: idle 1, walk 4 to
  8, attack 4 to 9, hit stun 1, fall 4 to 6, get up 2.
- The Joes are far bigger jobs: Joe1 has 146 frames over four sheets, before
  the scenes he shares with the player.
- The player's everyday moves are 194 frames in three sheets (Basic, Attack,
  WithCaptive), and each of those sheets exists twice: once normal and once
  `drunk_`. **A new move for the player has to be drawn in both versions**, or
  he snaps back to sober art when drunk.

## File conventions

- One PNG per frame, all on the same canvas, named `action` plus a number from
  1: `walk1.png` … `walk8.png`.
- The packer turns `walk1.png` in a folder called `punkpuppy` into the frame
  `punkpuppy/walk1`.
- A variant of a whole set takes a prefix: `drunk_`, `boner_`, `broken_`.
- A part drawn as a separate layer over the body is named after the frame it
  goes with: `grab4_foreground`, `smokekissjoe9_decorator`.
- Packed sheets end up with a palette automatically if they have 256 colours or
  fewer, like the originals.

## A checklist for new art

1. Same pixel scale: drawn at 1x for a 640x360 screen, hard edges, no soft
   pixels.
2. Height in the range for its kind (person 125 to 150, monster 80 to 130).
3. Feet on the same row in every frame of the sheet.
4. Darks are plum or navy, not black or grey. Edge is the dark shade of the
   local colour.
5. 30 to 90 colours, in flat patches of 3 to 5 steps.
6. Frame counts near the table above, so it moves like the rest.
7. Looks right mirrored: check in the sprite viewer.
8. Standing beside the player and a Joe in the viewer (Compare), it looks like
   the same game.
