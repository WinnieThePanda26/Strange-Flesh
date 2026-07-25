// Strange Flesh © 2017 by Greatest Bear Studios
//
// Strange Flesh is licensed under a
// Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.
//
// You should have received a copy of the license along with this
// work. If not, see <http://creativecommons.org/licenses/by-nc-sa/4.0/>.
//
// This sourcecode has not been minified or obfuscated in any way. Enjoy.
//
// ---------------------------------------------------------------------------
// LAIRS — a self-running "attract" / showcase mode.
//
// Many players never finish the game, so most of its art is never seen. In
// Lairs the Bartender plays himself: he is handed a *private* Controller plus
// an AICore (exactly the mechanism enemies use — see WalkingEntity EntityUpdate,
// "if (this.controller !== controller)"), so his own UpdateState reads AI-driven
// input instead of the keyboard. He strolls across an endless, in-code level
// while a director spawns Joes ahead of him; he grabs each one and smoke-kisses
// it to corruption, showing off the seduction art hands-free.
//
// Reachable straight from the main menu. Exit is free via Start -> pause -> Exit
// to Title (that already calls resetGame()).
// ---------------------------------------------------------------------------

// ---- Tunables --------------------------------------------------------------
var LAIRS_FLOOR_Y = 1180;                       // front collision boundary (matches level0's ~1160-1200 floor)
var LAIRS_BACK_Y = 567;                         // back collision boundary (matches level0)
var LAIRS_SPAWN = { x: 0, y: 825, z: 1000 };    // bartender start (same plane as level0)
// Kissable Joe types only, so the smoke-kiss seduction always lands. Joe0 is
// skipped anyway (FindClosestEnemy ignores un-recruited Joe0); Joe4 is left out
// because it isn't kissable (it would stall the seduce) — a domination/sex path
// for it is a later addition.
var LAIRS_ENEMY_POOL = ["Joe1", "Joe2", "Joe3"];
// Music the show can draw from: the level themes that are actually written to loop as
// a backing bed. Deliberately excludes level0 (the quiet opening bed), level6 (a bare
// ticking loop), final_sex, the endings and credits — see the pick in startLairsMode.
var LAIRS_MUSIC_TRACKS = ["level1", "level2", "level3", "level4", "level5"];
var LAIRS_TARGET_FRESH = 1;                     // max UNCORRUPTED enemy Joes on stage at once; the next is staged as soon
                                                 // as the current one is corrupted, so there's always someone to walk toward
var LAIRS_MAX_TOTAL = 7;                         // hard backstop on total non-player roster
var LAIRS_SPENT_LIFESPAN = 300;                  // frames a recruited ally follows before he's left behind (~5s); corrupt Joes self-die instead
var LAIRS_SPAWN_COOLDOWN = 80;                   // min frames between spawns; short, since the one-at-a-time gate above sets the real pace
var LAIRS_SEX_CHANCE = 0.4;                      // chance a kiss escalates all the way to full sex
var LAIRS_FAP_SPEEDUP = 2;                        // extra stateframes/frame added to a fapping Joe so his
                                                 // corruption reaches orgasm briskly (~4s) instead of ~12s
var LAIRS_ADMIRE_FRAMES = 150;                    // max frames the bartender stays to watch a Joe he just seduced finish
                                                 // (~2.5s: long enough to read as "watching", short enough that the
                                                 //  climax finishes behind him as he walks on rather than holding the show)

// Back-plane decoration. Everything back here is *staged ahead of the camera* and
// retired only once it has scrolled off the left edge — see StageBackgroundPairs /
// StageBackgroundChars — so nothing ever appears or vanishes in view.
var LAIRS_BG_LOOKAHEAD = 900;                     // how far past the right edge back-plane content is staged
var LAIRS_BG_RETIRE_MARGIN = 500;                // how far past the left edge before it's retired
var LAIRS_MAX_BG_PAIRS = 2;                       // background Joe couples alive at once (purely decorative)
var LAIRS_BG_PAIR_GAP_MIN = 1900;                // world-X spacing between couples along the back plane
var LAIRS_BG_PAIR_GAP_MAX = 3400;
var LAIRS_BG_PAIR_Y = 600;                        // back-plane Y for background pairs (behind the bartender at ~825)

// Permanently-corrupt showcase characters on the back plane, alongside the kissing
// pairs — the non-Joe cast the player might never reach, held mid-fap forever.
var LAIRS_BG_CHAR_POOL = ["OfficeAngel", "Admonitor", "EDRider", "StarvingArtist",
                          "PartyAnimal", "Fister", "PunkPuppy", "VirusFromVenus"];
var LAIRS_MAX_BG_CHARS = 4;                       // corrupt showcase characters alive at once (staged + on-screen)
var LAIRS_BG_CHAR_GAP_MIN = 800;                 // world-X spacing between them along the back plane
var LAIRS_BG_CHAR_GAP_MAX = 1700;
var LAIRS_BG_CHAR_Y = 585;                        // back-plane Y for the corrupt showcase characters
var LAIRS_BG_CHAR_FAP_HOLD = 120;                // stateFrames pin: keeps them fapping forever (below the ~240 orgasm ramp)

// ---- Entry point -----------------------------------------------------------
function startLairsMode()
{
	DismissAllMenus();
	menuStack = [];
	lairsMode = true;

	// Clean slate (mirrors the relevant bits of resetGame()).
	ResetAllAttacks();
	ClearSuspendableSounds();
	clearLevelCache();
	playerStack = [];

	lives = startingLives;
	poppers = 0;
	enemiesDispatched = 0;
	enemiesCorrupted = 0;
	totalEnemies = 0;
	respawnCounter = 0;
	entityFrameskip = 0;
	entityFrameskipCounter = 0;
	neverSaved = true;
	playerFirstSpawn = false;
	startupTimer = 300;   // skip the first-boot red fade; LevelStartTransition covers the intro

	// Build the auto-playing Bartender: a private controller (NOT the global
	// one) makes EntityUpdate drive him from this.ai every frame.
	player = new Bartender();
	player.ChangeAlliance(1);
	player.disableSpawnOnScroll = true;
	player.controller = new Controller();
	player.ai = new LairsBartenderAI(player);   // AICore ctor flips player.controller into impliedKeyup mode

	// Walk through Joes: entity-vs-entity pushing (EntityPush) skips anyone flagged
	// isPassThrough, so the just-seduced Joe standing in front can't wall him in.
	// Level/floor collision and the grab hitbox are separate paths and still apply.
	player.isPassThrough = true;

	hud.Reset();
	enemyinfo.Clear();

	// No HUD in Lairs. Nothing here is at stake — the bartender can't lose — so the
	// health / sex / corruption / domination bars, the lives (cigars), the poppers
	// stash and the floating per-enemy bars would all be reporting on a fight that
	// isn't happening, over the art the mode exists to show. The showcase tally in
	// LairsStats takes their place. endLairsMode() puts them all back.
	hud.enabled = false;
	enemyinfo.enabled = false;

	lairsStats = new LairsStats();
	overlays.push(lairsStats);

	// The popper trainer (LairsTrainer.js), if it's switched on in the Lairs menu.
	// With it off this is plain Lairs and the bartender never touches a popper.
	if (settings.lairsTrainer === 1)
	{
		// A longer hold is meant to leave him drunk for longer, which the engine's
		// 2-minute ceiling is too low to show — long hits would all saturate at it.
		player.maxDrunkTimer = LAIRS_TRAINER_MAX_DRUNK * fps;

		lairsTrainer = new LairsTrainer();
		overlays.push(lairsTrainer);
	}

	// Build and start the endless level (Start positions & adds the player).
	level = BuildLairsLevel();
	level.Start();
	camera.setPosition(player.posX, 540);

	// Random music, from a NAMED list of the level themes — not "everything registered
	// except the title". That pool also holds the set-piece beds: level6 is nothing but
	// a ticking loop that points at itself (it never resolves, it just scratches away
	// under the boss forever), and final_sex / the endings / credits are all cues written
	// to play once at a specific moment. Any of them landing here sounded like a fault.
	var trackKeys = [];
	for (var i = 0; i < LAIRS_MUSIC_TRACKS.length; i++)
	{
		if (GlobalMusic.tracks.hasOwnProperty(LAIRS_MUSIC_TRACKS[i]))
			trackKeys.push(LAIRS_MUSIC_TRACKS[i]);
	}
	var track = (trackKeys.length > 0) ? trackKeys[Math.floor(Math.random() * trackKeys.length)] : "level1";
	GlobalMusic.stop();
	GlobalMusic.setTrack(track);
	GlobalMusic.setVolume(settings.musicLevelGameplay);
	GlobalMusic.play(0.5);

	lairsDirector = new LairsDirector();
	lairsDirector.Seed();   // populate the back plane now, while the transition still covers the screen

	var lst = new LevelStartTransition();
	lst.silent = true;   // its cutscene roar has no business opening a showcase
	lst.Show();
};

// Tear down a Lairs session: restore the HUD and drop the stats panel. Called from
// resetGame(), which is where every exit from the mode funnels through (pause ->
// Exit to Title). Safe to call when Lairs was never entered.
function endLairsMode()
{
	// Backstop: silence every private looping sound still on the stage before the level
	// goes away. Leaving one running is the worst version of this bug — it follows the
	// player out to the main menu with nothing left alive to stop it.
	if (typeof(level) !== "undefined" && level !== null && level.entities)
	{
		for (var s = 0; s < level.entities.list.length; s++)
			LairsSilenceEntity(level.entities.list[s]);
	}

	lairsMode = false;
	lairsDirector = null;

	if (typeof(hud) !== "undefined" && hud !== null)
		hud.enabled = true;
	if (typeof(enemyinfo) !== "undefined" && enemyinfo !== null)
		enemyinfo.enabled = true;

	if (lairsStats !== null)
	{
		var i = overlays.indexOf(lairsStats);
		if (i !== -1)
			overlays.splice(i, 1);
		lairsStats = null;
	}

	if (lairsTrainer !== null)
	{
		var t = overlays.indexOf(lairsTrainer);
		if (t !== -1)
			overlays.splice(t, 1);
		lairsTrainer = null;
	}
};

// ---- Showcase tally --------------------------------------------------------
// The only thing on screen besides the show: how long this session has been running
// and what the bartender has got up to in it. Lives on the overlays list (added in
// startLairsMode, removed in endLairsMode), so it updates and draws with the HUD it
// replaced — and, like the rest of the overlays, stops counting while a menu is up.
function LairsStats()
{
	this.frames = 0;
	this.kissed = 0;    // smoke-kisses landed
	this.fucked = 0;    // sex scenes played out
};

LairsStats.prototype.CountKiss = function() { this.kissed += 1; };
LairsStats.prototype.CountSex  = function() { this.fucked += 1; };

LairsStats.prototype.Update = function()
{
	if (lairsMode)
		this.frames += 1;
};

function LairsFormatTime(frames)
{
	var seconds = Math.floor(frames / fps);
	var mins = Math.floor(seconds / 60);
	var secs = seconds % 60;
	return mins + ":" + (secs < 10 ? "0" : "") + secs;
};

LairsStats.prototype.Draw = function()
{
	if (!lairsMode)
		return;

	var rows = [["TIME",   LairsFormatTime(this.frames)],
				["KISSED", String(this.kissed)],
				["FUCKED", String(this.fucked)]];

	// Laid out in render-canvas pixels, because that is the space sstext draws in
	// (it scales its own 3x buffer to the display, so the text stays crisp). The
	// backing panel goes through the normal 1920x1080 virtual transform instead, so
	// convert with k — the two spaces differ by exactly 1080 / c.height.
	var x = 9, y = 8, lineHeight = 11, width = 84;
	var k = 1080.0 / c.height;

	ctx.save();
	var ratioTo1080p = c.height / 1080.0;
	ctx.setTransform(ratioTo1080p, 0, 0, ratioTo1080p, 0, 0);
	ctx.globalAlpha = 0.4;
	ctx.fillStyle = "#12040f";
	drawRoundRect((x - 5) * k, (y - 4) * k, (width + 10) * k,
				  (rows.length * lineHeight + 6) * k, 5 * k, true, false);
	ctx.globalAlpha = 1.0;
	ctx.restore();

	sstext.scale = 1.0;
	sstext.alpha = 1.0;
	sstext.textBaseline = "top";
	sstext.fontSize = 9;
	for (var i = 0; i < rows.length; i++)
	{
		sstext.textAlign = "left";
		sstext.DrawTextWithShadow(rows[i][0], x, y + i * lineHeight, "#e9a8d4");
		sstext.textAlign = "right";
		sstext.DrawTextWithShadow(rows[i][1], x + width, y + i * lineHeight, "#FFF");
	}
};

// ---- Endless level ---------------------------------------------------------
// A dedicated Level built in code: one repeating backdrop tile + a flat floor,
// camera unbounded horizontally. ContainsRect is an intersection test, so the
// big-repX background only draws the on-screen tiles each frame.
function BuildLairsLevel()
{
	var lv = new Level();
	lv.levelName = "lairs";
	lv.displayName = "Lairs";
	lv.musicTrack = "unknown";
	lv.backgroundColor = "#1a0a1e";   // dark plum: blends with the skybox so any uncovered sliver isn't stark black
	lv.spawnPosition = { x: LAIRS_SPAWN.x, y: LAIRS_SPAWN.y, z: LAIRS_SPAWN.z };

	// Sky: pin level0's skybox to the camera (parallax 1) and tile it a few times
	// so it fills the top band above the floor tile at any window width.
	var sky = new RepeatingBackground("level0/skybox");
	sky.parallax = 1;
	sky.posX = 0;
	sky.posY = 0;
	sky.repX = 4;   // 4, not 3: enough tiles to span the widest supported aspect
	sky.repY = 1;
	sky.ReInit();
	lv.background.push(sky);

	// Backdrop: level0's repeat_bg (319x236 -> 957x708 at pxScale 3), placed at
	// y=372 to reach the floor exactly as it does in level0. Tiled across a huge
	// span so the bartender can walk "forever".
	var tileWidth = 957;            // 319 * pxScale
	var bg = new RepeatingBackground("level0/repeat_bg");
	bg.parallax = 0;
	bg.posX = -tileWidth * 100;     // start well to the left of the spawn
	bg.posY = 372;
	bg.repX = 4200;                 // ~4 million px of tiled floor to the right
	bg.repY = 1;
	bg.ReInit();
	lv.background.push(bg);

	// Collision: a flat walkable strip (front floor + back wall), spanning far
	// past anywhere the bartender will reach.
	var FAR = 100000;
	lv.collisionMask.AddLine(-FAR, LAIRS_FLOOR_Y, FAR, LAIRS_FLOOR_Y);   // front floor
	lv.collisionMask.AddLine(-FAR, LAIRS_BACK_Y, FAR, LAIRS_BACK_Y);     // back wall

	// Camera: clamp vertical only (top y=0, bottom y=1080, mirrored from level0),
	// no left/right lines -> horizontally unbounded so the camera scrolls forever.
	lv.cameraMask.AddLine(-FAR, 0, FAR, 0);
	lv.cameraMask.AddLine(-FAR, 1080, FAR, 1080);

	return lv;
};

// ---- Bartender showcase AI -------------------------------------------------
// Same subclassing pattern as JoeAI: AICore.call() + reuse AICore's plumbing,
// override GenerateNewAction to decide what to do next.
function LairsBartenderAI(owner)
{
	AICore.call(this, owner);
	this.searchDistance = 1500;
};

LairsBartenderAI.prototype.GenerateNewAction = function()
{
	var o = this.owner;

	// A trainer hit is being called or is in progress: start nothing new. He stands by
	// so he's free to take it the moment it lands, and doesn't wander off mid-hold.
	// (Poppers are ONLY ever taken on a scheduled hit — see LairsTrainer.TakeTheHit.)
	if (lairsTrainer !== null && lairsTrainer.BlocksNewActions())
	{
		this.QueueAction(new LairsStandbyAction());
		return;
	}

	// Smoke-kiss the nearest FRESH (not-yet-corrupt) enemy ahead of us (he faces and
	// grabs to the right). Ignoring Joes he has already walked past keeps him moving
	// rightward instead of backtracking; skipping already-corrupt Joes keeps him from
	// re-grabbing one he just finished. Sometimes we roll "escalate to sex" so the same
	// Joe gets kissed, corrupted, and then fucked in place — that all happens inside the
	// one seduce action, before he moves on.
	var target = level.FindClosestEnemy(this.owner, this.searchDistance);
	if (target !== null && IsAttackable(target.state) && !IsCorrupt(target.state) &&
		target.posX > o.posX - 120)
	{
		var doSex = (o.sexMeter === o.maxSexMeter) && (Math.random() < LAIRS_SEX_CHANCE);
		this.QueueAction(new LairsSeduceAction(target, doSex));
		return;
	}

	// No fresh target: keep the show moving — stroll right and re-evaluate soon. He
	// never halts for something the viewer can't see; every pause on stage is part of
	// a seduction (the grab/kiss/sex itself, or the beat he spends watching the Joe he
	// just corrupted finish — both live inside LairsSeduceAction).
	this.QueueAction(new LairsStrollAction(45));
};

LairsBartenderAI.prototype.Update = function() { AICore.prototype.Update.call(this); };
LairsBartenderAI.prototype.QueueAction = AICore.prototype.QueueAction;
LairsBartenderAI.prototype.Flush = AICore.prototype.Flush;
LairsBartenderAI.prototype.CancelCurrentAction = AICore.prototype.CancelCurrentAction;
LairsBartenderAI.prototype.Draw = function() { AICore.prototype.Draw.call(this); };

// ---- Actions ---------------------------------------------------------------
// Stroll: hold right for a while so he keeps advancing between targets.
function LairsStrollAction(frames)
{
	BasicAction.call(this);
	this.framesToWait = frames;
};

LairsStrollAction.prototype.Update = function()
{
	this.owner.controller.rightKeyDown();
	this.owner.facing = 1;
	this.timer += 1;
	if (this.timer > this.framesToWait)
		this.ended = true;
};

LairsStrollAction.prototype.Complete = function() { this.ended = true; };

// Stand by: hold still for the duration of a trainer hit — the countdown, the hit
// itself and the hold — so the moment is his and yours and nothing else moves.
function LairsStandbyAction()
{
	BasicAction.call(this);
	this.timeout = 900;   // never strand him if the trainer goes away mid-hold
};

LairsStandbyAction.prototype.Update = function()
{
	// Deliberately no input — impliedKeyup settles him to idle (the drunk sway, once
	// he's had a hit).
	this.timer += 1;
	if (lairsTrainer === null || !lairsTrainer.BlocksNewActions() || this.timer > this.timeout)
		this.ended = true;
};

LairsStandbyAction.prototype.Complete = function() { this.ended = true; };

// Work a Joe: approach and grab. The Bartender's own grab logic decides the
// outcome — grabbing a fresh Joe starts a Drag (we then press smoke for a
// SmokeKiss that corrupts him), while grabbing a fapping *corrupt* Joe at full
// sex-meter starts the full sex animation instead. Either finisher is self-running
// once entered, so we just wait for him to return to Walk. If doSex is set, once
// the kiss has corrupted the Joe we stay on him and grab again for the full sex
// animation — the Bartender's grab does sex when he grabs a corrupt fuckable target
// at full sex-meter (the director keeps the meter topped).
// The action ends with an "admire" beat: he stands where he is, facing the Joe he
// just corrupted, until that Joe's fap/orgasm has run out. That is the only time he
// stops without an animation of his own playing, and the reason for it is right
// there on screen next to him.
//   0 approach, 1 grab, 2 smoke (kiss), 3 kiss finishing,
//   4 wait for corruption, 5 approach for sex, 6 grab for sex, 7 sex finishing,
//   8 admire
function LairsSeduceAction(target, doSex)
{
	BasicAction.call(this);
	this.target = target;
	this.doSex = !!doSex;
	this.phase = 0;
	this.phaseTimer = 0;
	this.lastOwnerState = -1;   // for the stats tally: spot the frame each action lands
	this.countedSex = false;
	// The grab hitbox reaches X 100..300 (Bartender.grabAttack SetBounds(100,-28,300,28)),
	// but body collision stops the Bartender ~150px short of a target, so we must fire
	// the grab from *within* that reach — never try to close nearer than collision allows,
	// or he just shoves the Joe along forever.
	this.grabRangeX = 260;   // fire the grab once the target is inside the grab hitbox
	this.grabRangeY = 26;    // and roughly on the same Y plane (box half-height is 28)
	this.timeout = 1400;     // hard safety cap covering the full kiss-then-sex-then-admire run
};

// States that mean a finisher (kiss or sex) is committed and self-running.
function LairsIsFinisherState(s)
{
	return s === States.SmokeKiss || LairsIsSexState(s);
}

function LairsIsSexState(s)
{
	return s === States.PrepareSexTop || s === States.BeforeSexTop ||
		   s === States.CaptiveSexTop || s === States.AfterSexTop;
}

LairsSeduceAction.prototype.Update = function()
{
	this.timer += 1;
	this.phaseTimer += 1;

	var o = this.owner;
	var t = this.target;

	// Tally for the stats panel, on the frame the kiss or sex actually lands (the state
	// is entered) rather than when we press the button — a grab that whiffs doesn't
	// count. The sex sequence walks through several states, so it only counts once.
	if (lairsStats !== null && o.state !== this.lastOwnerState)
	{
		if (o.state === States.SmokeKiss)
			lairsStats.CountKiss();
		else if (LairsIsSexState(o.state) && !this.countedSex)
		{
			this.countedSex = true;
			lairsStats.CountSex();
		}
		this.lastOwnerState = o.state;
	}

	// Hard cap: never hang, even if a state machine gets into an odd spot.
	if (this.timer > this.timeout)
	{
		this.ended = true;
		return;
	}

	// Target vanished before we secured it -> abandon (only matters while chasing it).
	if ((this.phase < 2 || this.phase === 4 || this.phase === 5) &&
		(t === null || IsDeadOrDying(t.state)))
	{
		this.ended = true;
		return;
	}

	var distX = t ? (t.posX - o.posX) : 0;
	var distY = t ? (t.posY - o.posY) : 0;
	var faceDir = (distX > 0) ? 1 : (distX < 0 ? -1 : o.facing);

	// Shared "walk into grab range" helper used by the kiss and sex approaches.
	var approach = function()
	{
		o.facing = faceDir;
		if (Math.abs(distX) > this.grabRangeX)
		{
			if (distX > 0) o.controller.rightKeyDown();
			else o.controller.leftKeyDown();
		}
		if (Math.abs(distY) > this.grabRangeY)
		{
			if (distY > 0) o.controller.downKeyDown();
			else o.controller.upKeyDown();
		}
		return (Math.abs(distX) <= this.grabRangeX && Math.abs(distY) <= this.grabRangeY);
	}.bind(this);

	if (this.phase === 0)               // approach for the kiss
	{
		if (approach()) { this.phase = 1; this.phaseTimer = 0; }
	}
	else if (this.phase === 1)          // grab
	{
		o.facing = faceDir;
		o.controller.grabKeyDown();
		if (o.state === States.Drag) { this.phase = 2; this.phaseTimer = 0; }
		else if (LairsIsFinisherState(o.state)) { this.phase = 3; this.phaseTimer = 0; }
		else if (o.state === States.GrabFail || (o.state === States.Walk && this.phaseTimer > 25))
		{ this.phase = 0; this.phaseTimer = 0; }   // missed — re-approach
	}
	else if (this.phase === 2)          // in Drag: press smoke for the kiss
	{
		o.controller.grabKeyDown();
		if (this.phaseTimer > 12) o.controller.smokeKeyDown();
		if (LairsIsFinisherState(o.state)) { this.phase = 3; this.phaseTimer = 0; }
		else if (o.state === States.Walk && this.phaseTimer > 30) this.ended = true;
	}
	else if (this.phase === 3)          // kiss finishing; then maybe escalate to sex
	{
		if (o.state === States.Walk)
		{
			if (this.doSex) { this.phase = 4; this.phaseTimer = 0; }
			else { this.phase = 8; this.phaseTimer = 0; }
		}
	}
	else if (this.phase === 4)          // wait for the Joe to finish corrupting (fappable)
	{
		if (t.state === States.Corrupt || t.state === States.PreCorrupt)
		{ this.phase = 5; this.phaseTimer = 0; }
		else if (this.phaseTimer > 240) this.ended = true;   // never got there — move on
	}
	else if (this.phase === 5)          // approach the fapping Joe for sex
	{
		if (approach()) { this.phase = 6; this.phaseTimer = 0; }
		else if (this.phaseTimer > 180) this.ended = true;
	}
	else if (this.phase === 6)          // grab a corrupt Joe -> sex
	{
		o.facing = faceDir;
		o.controller.grabKeyDown();
		if (LairsIsFinisherState(o.state)) { this.phase = 7; this.phaseTimer = 0; }
		else if (o.state === States.Drag) { this.phase = 7; this.phaseTimer = 0; }  // fell back to a kiss; still fine
		else if (o.state === States.GrabFail || (o.state === States.Walk && this.phaseTimer > 25))
		{ this.phase = 5; this.phaseTimer = 0; }
	}
	else if (this.phase === 7)          // sex finishing
	{
		if (o.state === States.Walk) { this.phase = 8; this.phaseTimer = 0; }
	}
	else                                // phase 8: stay and watch him finish
	{
		// No movement input (impliedKeyup settles him to idle), just turn to face the
		// Joe. He leaves the moment the Joe starts dying, or after the cap if the
		// corruption fizzled out some other way.
		o.facing = faceDir;
		var stillGoing = (t !== null && !IsDeadOrDying(t.state) &&
						  (this.phaseTimer < 30 || IsCorrupt(t.state)));   // grace frames: the corruption takes a moment to start
		if (!stillGoing || this.phaseTimer > LAIRS_ADMIRE_FRAMES)
			this.ended = true;
	}
};

LairsSeduceAction.prototype.Complete = function() { this.ended = true; };

// Popper: hit the poppers button to go drunk. Poppers only register from Walk
// (they trigger the Sniff gesture, after which drunkTimer ramps up). Queued only by
// the trainer, on a called hit — he never takes one on his own.
function LairsPopperAction()
{
	BasicAction.call(this);
	this.timeout = 600;   // generous: if a hit had to be forced into a scene he was already
	                      // committed to, he still takes it as soon as that scene lets go
};

LairsPopperAction.prototype.Update = function()
{
	this.timer += 1;

	// Tap, don't hold. poppersActivate() is only true on the frame of a *fresh* keydown,
	// and impliedKeyup won't release a button that gets re-pressed every frame — so
	// holding it offers the hit exactly once, and if he happens to be mid-kiss at that
	// instant the hit is simply lost. Tapping keeps offering it until he can take it.
	if (this.timer % 4 === 1)
		this.owner.controller.poppersKeyDown();

	// Done once the gesture is underway. Deliberately NOT keyed off drunkTimer: he is
	// usually still drunk from the last hit, and this has to land every time it's called.
	if (this.owner.state === States.Sniff || this.timer > this.timeout)
		this.ended = true;
};

LairsPopperAction.prototype.Complete = function() { this.ended = true; };

// ---- Director --------------------------------------------------------------
// Keeps the star alive and feeds him a steady trickle of showcase Joes from the
// right edge. Update() is called each frame from updateAll() while lairsMode.
function LairsDirector()
{
	this.spawnTimer = 45;         // first Joe arrives quickly
	this.bgPairs = [];            // active background couples (pairs of looping kiss effects)
	this.kissAnimL = null;        // shared horny-kiss animation templates, grabbed lazily
	this.kissAnimR = null;
	this.bgChars = [];            // active permanently-corrupt back-plane characters

	// Back-plane "frontiers": the world X up to which each kind of decoration has been
	// staged. New pieces are always placed AT the frontier, which is kept ahead of the
	// camera's right edge — so they are already standing there when the bartender walks
	// up to them, rather than materializing in view.
	this.bgPairFrontierX = 0;
	this.bgCharFrontierX = 0;
};

// Dress the opening screen. Called from startLairsMode() while the LevelStartTransition
// still covers everything, so the back plane is already populated when the curtain lifts
// (the director itself doesn't tick until the transition is off the menu stack).
LairsDirector.prototype.Seed = function()
{
	this.bgPairFrontierX = camera.boundingRect.xMin + 300;
	this.bgCharFrontierX = camera.boundingRect.xMin + 200;
	this.StageBackgroundPairs();
	this.StageBackgroundChars();
};

LairsDirector.prototype.Update = function()
{
	if (player === null)
		return;

	// Keep the star alive and always ready to act: full health so he never dies,
	// a full sex-meter so a grab on a corrupt Joe becomes sex, and poppers on hand
	// so he can go drunk. Don't refill the sex-meter mid-sex (it drains itself then).
	player.health = player.maxHealth;
	if (player.state === States.Walk)
		player.sexMeter = player.maxSexMeter;
	poppers = maxPoppers;

	// One pass over the entities to: count how many fresh enemies are still around
	// (spawn gating), cull far-behind stragglers, and cut loose "spent" Joes. A seduced
	// Joe gets recruit()ed and would then follow the bartender forever, so after a few
	// seconds of showing its reaction we drop its AI and let the show walk away from it
	// — keeping the frame on the current seduction instead of a growing cheering mob.
	var freshCount = 0;
	var otherCount = 0;
	var list = level.entities.list;
	for (var i = 0; i < list.length; i++)
	{
		var e = list[i];
		if (e === player)
			continue;

		// Drop anything that has fallen well behind the camera (Joes and stray
		// pickup orbs alike, so nothing leaks off the left edge). Background corrupt
		// characters are exempt — UpdateBackgroundChars retires them on its own.
		if (typeof(e.posX) === "number" && !e.isLairsBgChar && e.posX < camera.boundingRect.xMin - 1200)
		{
			level.entities.Remove(e);
			i -= 1;
			continue;
		}

		// Only our spawned Joes count toward the roster / caps below. Orbs dropped by
		// orgasming Joes are also entities, but they must not inflate the counts or
		// they'd choke off spawning and trip the backstop.
		if (!e.isLairsJoe)
			continue;

		otherCount += 1;

		// While a Joe is being smoke-kissed, drain his health so the kiss finalizes
		// into full corruption (the fapping Corrupt state) rather than a temporary
		// recruit — that's what shows the corruption art and makes him a sex target.
		if (e.state === States.CaptiveSmokeKiss)
			e.health = 0;

		// Nudge a fapping Joe toward his climax (fap ramps to orgasm at stateFrames
		// ~700). This plays the whole corruption -> orgasm -> death animation briskly
		// so corrupt Joes finish and clear the stage instead of fapping for ~12s and
		// stacking up on top of each other.
		if (e.state === States.Corrupt)
			e.stateFrames += LAIRS_FAP_SPEEDUP;

		// A Joe we're actively grabbing/kissing/fucking must never be retired.
		var busy = (e === player.captive) || IsCaptive(e.state);

		if (e.alliance === 2 && !IsDeadOrDying(e.state) && !e.recruited && !IsCorrupt(e.state))
		{
			// Count only Joes still waiting to be seduced (fresh, or mid-kiss). Once a Joe
			// is corrupted he stops gating, so the next one is staged off-screen right away
			// and is walking in by the time the bartender is done here — that's what keeps
			// him moving forward instead of standing around waiting for a spawn.
			freshCount += 1;
		}
		else if (e.recruited && !IsCorrupt(e.state) && !busy)
		{
			// A recruited ally follows the bartender forever, so it would never fall
			// behind on its own. After a few seconds cut it loose: drop its AI so it
			// stands where it is, the camera walks away from it, and the off-screen cull
			// above collects it. (Nothing is poofed in view.) Corrupt Joes are deliberately
			// NOT touched here — they run their own fap -> orgasm -> death animation.
			if (typeof(e.lairsSpentTimer) !== "number")
				e.lairsSpentTimer = LAIRS_SPENT_LIFESPAN;
			else
				e.lairsSpentTimer -= 1;

			if (e.lairsSpentTimer <= 0 && e.ai !== null)
			{
				e.ai.Flush();
				e.ai = null;
				e.isPassThrough = true;
			}
		}
	}

	// Hard backstop so a stationary stretch (e.g. long sex) can't pile Joes up without
	// bound. Retire the furthest-BACK spent Joe (nearest the left edge / off-screen), so
	// on-screen corruptions are never the ones cut short.
	if (otherCount > LAIRS_MAX_TOTAL)
	{
		var trim = null;
		var trimX = Number.MAX_VALUE;
		for (var j = 0; j < list.length; j++)
		{
			var c = list[j];
			if (c.isLairsJoe && (IsCorrupt(c.state) || c.recruited) &&
				c !== player.captive && !IsCaptive(c.state) && c.posX < trimX)
			{
				trimX = c.posX;
				trim = c;
			}
		}
		if (trim !== null)
		{
			LairsPoof(trim);
			level.entities.Remove(trim);
		}
	}

	if (this.spawnTimer > 0)
		this.spawnTimer -= 1;

	// Maintain a small pool of fresh Joes: spawn one only when the pool drops below
	// target, so a new Joe arrives roughly as each one is seduced (1-in-1-out).
	if (this.spawnTimer === 0 && freshCount < LAIRS_TARGET_FRESH && otherCount < LAIRS_MAX_TOTAL)
	{
		this.SpawnEnemy();
		this.spawnTimer = LAIRS_SPAWN_COOLDOWN;
	}

	this.UpdateBackgroundPairs();
	this.UpdateBackgroundChars();
};

// Purely decorative Joe couples kissing on a back plane. They loop forever (their
// interaction never ends), scroll with the world, and are removed once they pass
// off the left edge. They are effects, not entities, so they're never targeted or
// counted — the bartender ignores them entirely.
LairsDirector.prototype.UpdateBackgroundPairs = function()
{
	for (var i = this.bgPairs.length - 1; i >= 0; i--)
	{
		var p = this.bgPairs[i];
		// Off the left edge, or somehow already gone -> retire the couple. Nothing is
		// ever retired while it could still be on screen.
		if (p.left.state === States.Dead || p.right.state === States.Dead ||
			p.left.posX < camera.boundingRect.xMin - LAIRS_BG_RETIRE_MARGIN)
		{
			p.left.Die();
			p.right.Die();
			this.bgPairs.splice(i, 1);
		}
	}

	this.StageBackgroundPairs();
};

// Advance the couple frontier: place couples along the back plane, spaced out, until
// the staged span reaches past the right edge of the screen.
LairsDirector.prototype.StageBackgroundPairs = function()
{
	var limit = camera.boundingRect.xMax + LAIRS_BG_LOOKAHEAD;
	var guard = 0;
	while (this.bgPairFrontierX < limit && this.bgPairs.length < LAIRS_MAX_BG_PAIRS && guard++ < 6)
	{
		this.SpawnBackgroundPair(this.bgPairFrontierX);
		this.bgPairFrontierX += LAIRS_BG_PAIR_GAP_MIN +
			Math.random() * (LAIRS_BG_PAIR_GAP_MAX - LAIRS_BG_PAIR_GAP_MIN);
	}

	// If the live cap (rather than the lookahead) stopped the loop, the frontier can be
	// left behind the camera — shove it back off-screen so the next couple still walks
	// into frame instead of appearing in the middle of it.
	this.bgPairFrontierX = Math.max(this.bgPairFrontierX, camera.boundingRect.xMax + 400);
};

LairsDirector.prototype.SpawnBackgroundPair = function(px)
{
	// Grab the shared horny-kiss animation templates once (all Joe types use the
	// joe1 kiss sprites) from a throwaway Joe.
	if (this.kissAnimL === null)
	{
		try
		{
			var tmp = new Joe1();
			this.kissAnimL = tmp.hornyKissLeftAnim;
			this.kissAnimR = tmp.hornyKissRightAnim;
		}
		catch (e) { return; }
	}
	if (!this.kissAnimL || !this.kissAnimR || typeof(EffectAnimation) !== "function")
		return;

	var py = LAIRS_BG_PAIR_Y + (Math.random() * 60 - 30);

	// Two looping kiss halves (left partner + right partner) placed at the same
	// point so they read as one couple. repeat = 1 makes the animation loop forever.
	var left = new EffectAnimation(this.kissAnimL, null, false);
	left.EffectAnimationAnim.repeat = 1;
	left.posX = px; left.posY = py; left.posZ = 0;
	left.orderBonus = -150;   // sit behind the foreground action
	left.alpha = 0.92;

	var right = new EffectAnimation(this.kissAnimR, null, false);
	right.EffectAnimationAnim.repeat = 1;
	right.posX = px; right.posY = py; right.posZ = 0;
	right.orderBonus = -150;
	right.alpha = 0.92;

	level.entities.AddEffect(left);
	level.entities.AddEffect(right);
	this.bgPairs.push({ left: left, right: right });
};

// Permanently-corrupt showcase characters on the back plane. Unlike the foreground
// Joes (who get seduced live), these are the non-Joe cast dropped straight into the
// fapping Corrupt state and *held* there — the game's corruption art on permanent
// display for players who'd never reach these characters. They're neutral (never
// targeted), AI-less, pass-through, drawn behind the action, and scroll off the left
// edge like the kiss pairs.
LairsDirector.prototype.UpdateBackgroundChars = function()
{
	for (var i = this.bgChars.length - 1; i >= 0; i--)
	{
		var e = this.bgChars[i];

		// Off the left edge (or somehow gone) -> retire quietly. This is the ONLY way one
		// of them leaves: they are never timed out or poofed while they could be in view.
		if (typeof(e.posX) !== "number" || e.state === States.Dead ||
			e.posX < camera.boundingRect.xMin - LAIRS_BG_RETIRE_MARGIN)
		{
			LairsSilenceEntity(e);   // nothing of his may outlive him
			level.entities.Remove(e);
			this.bgChars.splice(i, 1);
			continue;
		}

		// He is scenery: he never rides, fights or revs, so nothing he owns should be
		// making noise (see LairsSilenceEntity for why this has to be every frame).
		LairsSilenceEntity(e);

		// Hold him mid-corruption forever: keep him in the fapping Corrupt state and pin
		// stateFrames below the orgasm ramp (fapSpeed only bottoms out, triggering climax,
		// once stateFrames reaches ~240-300 — so capping it well under that loops the fap).
		if (e.state !== States.Corrupt && !IsDeadOrDying(e.state))
			e.ChangeState(States.Corrupt);
		if (e.stateFrames > LAIRS_BG_CHAR_FAP_HOLD)
			e.stateFrames = LAIRS_BG_CHAR_FAP_HOLD;
	}

	this.StageBackgroundChars();
};

// Advance the character frontier — same staging rule as the couples above.
LairsDirector.prototype.StageBackgroundChars = function()
{
	var limit = camera.boundingRect.xMax + LAIRS_BG_LOOKAHEAD;
	var guard = 0;
	while (this.bgCharFrontierX < limit && this.bgChars.length < LAIRS_MAX_BG_CHARS && guard++ < 6)
	{
		// Only advance past a slot that actually got filled. SpawnBackgroundChar declines
		// when every name it rolls is already on stage, and advancing anyway would walk the
		// frontier off to the right — leaving the back plane bare until the camera caught up.
		if (!this.SpawnBackgroundChar(this.bgCharFrontierX))
			break;
		this.bgCharFrontierX += LAIRS_BG_CHAR_GAP_MIN +
			Math.random() * (LAIRS_BG_CHAR_GAP_MAX - LAIRS_BG_CHAR_GAP_MIN);
	}

	this.bgCharFrontierX = Math.max(this.bgCharFrontierX, camera.boundingRect.xMax + 400);
};

LairsDirector.prototype.SpawnBackgroundChar = function(px)
{
	// Pick a character not already on the back plane, so the ones on stage together are
	// always different members of the cast rather than duplicates.
	var taken = {};
	for (var t = 0; t < this.bgChars.length; t++)
		taken[this.bgChars[t].constructor.name] = true;
	var name = null;
	for (var tries = 0; tries < 10; tries++)
	{
		var cand = LAIRS_BG_CHAR_POOL[Math.floor(Math.random() * LAIRS_BG_CHAR_POOL.length)];
		if (!taken[cand]) { name = cand; break; }
	}
	if (name === null)
		return false;

	var MyClass = stringToFunction(name);
	if (typeof(MyClass) !== "function")
		return false;

	var e = new MyClass();
	e.isLairsBgChar = true;   // exempt from the foreground roster counting and the far-behind cull

	var py = LAIRS_BG_CHAR_Y + (Math.random() * 40 - 20);

	if ("ReInit" in e) e.ReInit(level);
	// Neutral alliance so FindClosestEnemy skips him (the bartender never walks over to
	// seduce a background prop), no AI so he just stands and faps where he's placed.
	if ("ChangeAlliance" in e) e.ChangeAlliance(0);
	if ("Respawn" in e) e.Respawn({ x: px, y: py, z: 0 });
	e.ai = null;
	e.isPassThrough = true;              // never blocks or gets shoved by the bartender
	e.disableSpawnOnScroll = true;
	e.posY = py;                         // ensure the back-plane depth even if Respawn reset it
	if (e.hasOwnProperty("facing"))
		e.facing = (Math.random() < 0.5) ? 1 : -1;
	e.orderBonus = -200;                 // draw behind the foreground action

	// Straight into the fapping Corrupt state; UpdateBackgroundChars keeps him there.
	e.ChangeState(States.Corrupt);

	level.entities.AddEntity(e);
	this.bgChars.push(e);
	return true;
};

// Silence any looping sound a cast member owns privately — the EDRider's engine, the
// boss's fireball loop. Those are started AND stopped from inside a single state branch
// (States.Walk, for the engine), which works fine when the character is being played
// normally. A Lairs background character is pinned in Corrupt forever, so if it ever
// touches that branch — one frame of Walk as it lands on spawn is enough — the loop
// starts and nothing ever stops it again: it outlives the character, survives the pause
// menu, and keeps going after the session is over. Music.stop() is a no-op when nothing
// is playing, so this is safe to call every frame.
function LairsSilenceEntity(e)
{
	if ("engineNoise" in e && e.engineNoise !== null && typeof(e.engineNoise.stop) === "function")
		e.engineNoise.stop();
	if ("fireballSFX" in e && e.fireballSFX !== null && typeof(e.fireballSFX.stop) === "function")
		e.fireballSFX.stop();
};

// Small smoke poof to cover a Joe leaving the show (mirrors SpawnEntityTransitionPuff).
function LairsPoof(e)
{
	if (typeof(SmokeExplosion) !== "function")
		return;
	var w = ("hitRect" in e && e.hitRect) ? e.hitRect.width() : 200;
	var h = e.zHeight || 200;
	var smoke = new SmokeExplosion(e.posX, e.posY, e.posZ + h / 2.0, w, h, 3.0);
	level.entities.AddEffect(smoke);
};

LairsDirector.prototype.SpawnEnemy = function()
{
	var name = LAIRS_ENEMY_POOL[Math.floor(Math.random() * LAIRS_ENEMY_POOL.length)];
	var MyClass = stringToFunction(name);
	if (typeof(MyClass) !== "function")
		return;

	var e = new MyClass();
	e.isLairsJoe = true;   // marks it as one of our showcase Joes (vs. dropped orbs etc.)
	var spawnX = camera.boundingRect.xMax + 500;
	var spawnY = player.posY;

	if ("ReInit" in e) e.ReInit(level);
	if ("ChangeAlliance" in e) e.ChangeAlliance(2);
	if ("Respawn" in e) e.Respawn({ x: spawnX, y: spawnY, z: 0 });
	if (e.hasOwnProperty("facing")) e.facing = -1;   // face the oncoming bartender

	// Keep it a civil demo: showcase Joes don't fight back, they just get seduced.
	if (e.ai && ("pacifist" in e.ai))
		e.ai.pacifist = true;

	// Amble a little onto the screen, then idle where the bartender will reach them.
	if (e.ai !== null && typeof(GoToPointAction) === "function")
		e.ai.QueueAction(new GoToPointAction(spawnX - 700, spawnY, 10, false));

	level.entities.AddEntity(e);
};
