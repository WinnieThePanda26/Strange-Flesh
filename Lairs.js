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
var LAIRS_TARGET_FRESH = 1;                     // max LIVE enemy Joes on stage at once; the next won't arrive until the current one dies
var LAIRS_MAX_TOTAL = 7;                         // hard backstop on total non-player roster
var LAIRS_SPENT_LIFESPAN = 300;                  // frames a recruited ally lingers before poofing (~5s); corrupt Joes self-die instead
var LAIRS_SPAWN_COOLDOWN = 80;                   // min frames between spawns; short, since the one-at-a-time gate above sets the real pace
var LAIRS_SEX_CHANCE = 0.4;                      // chance a kiss escalates all the way to full sex
var LAIRS_DRUNK_CHANCE = 0.12;                   // per-decision chance to hit a popper and go drunk
var LAIRS_FAP_SPEEDUP = 2;                        // extra stateframes/frame added to a fapping Joe so his
                                                 // corruption reaches orgasm briskly (~4s) instead of ~12s
var LAIRS_MAX_BG_PAIRS = 1;                       // background Joe couples on-screen at once (purely decorative)
var LAIRS_BG_PAIR_COOLDOWN = 420;                // frames between background-pair spawns
var LAIRS_BG_PAIR_Y = 600;                        // back-plane Y for background pairs (behind the bartender at ~825)

// Permanently-corrupt showcase characters on the back plane, alongside the kissing
// pairs — the non-Joe cast the player might never reach, held mid-fap forever.
var LAIRS_BG_CHAR_POOL = ["OfficeAngel", "Admonitor", "EDRider", "StarvingArtist",
                          "PartyAnimal", "Fister", "PunkPuppy", "VirusFromVenus"];
var LAIRS_MAX_BG_CHARS = 2;                       // corrupt showcase characters on-screen at once
var LAIRS_BG_CHAR_COOLDOWN = 330;                // frames between corrupt-character spawns
var LAIRS_BG_CHAR_Y = 585;                        // back-plane Y for the corrupt showcase characters
var LAIRS_BG_CHAR_FAP_HOLD = 120;                // stateFrames pin: keeps them fapping forever (below the ~240 orgasm ramp)
var LAIRS_BG_CHAR_LIFESPAN = 900;                // frames a corrupt character stays before rotating out (~15s) so the cast varies even when the camera barely scrolls

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

	// Build and start the endless level (Start positions & adds the player).
	level = BuildLairsLevel();
	level.Start();
	camera.setPosition(player.posX, 540);

	// Random music: any registered gameplay track (keys are the level names).
	var trackKeys = [];
	for (var k in GlobalMusic.tracks)
	{
		if (GlobalMusic.tracks.hasOwnProperty(k) && k !== "title")
			trackKeys.push(k);
	}
	var track = (trackKeys.length > 0) ? trackKeys[Math.floor(Math.random() * trackKeys.length)] : "level1";
	GlobalMusic.stop();
	GlobalMusic.setTrack(track);
	GlobalMusic.setVolume(settings.musicLevelGameplay);
	GlobalMusic.play(0.5);

	lairsDirector = new LairsDirector();

	var lst = new LevelStartTransition();
	lst.Show();
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
	sky.repX = 3;
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

	// Occasionally hit a popper and get drunk — the smoke-kiss and sex animations
	// have their own drunk variants, so this adds "when drunk" versions for free.
	if (o.drunkTimer <= 0 && poppers > 0 && Math.random() < LAIRS_DRUNK_CHANCE)
	{
		this.QueueAction(new LairsPopperAction());
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

	// No fresh target. If a Joe he already seduced is still finishing his corruption
	// nearby, LINGER (idle in place) so he doesn't stroll off and outrun the climax
	// (which would cull the fapping Joe mid-animation — he'd appear to vanish). Only
	// once the stage is clear does he stroll on to meet the next spawn.
	var list = level.entities.list;
	for (var i = 0; i < list.length; i++)
	{
		var e = list[i];
		if (e.isLairsJoe && !IsDeadOrDying(e.state) &&
			(IsCorrupt(e.state) || IsCaptive(e.state)) &&
			Math.abs(e.posX - o.posX) < 1400)
		{
			this.QueueAction(new LairsLingerAction(30));
			return;
		}
	}

	// Stage clear: keep the show moving — stroll to the right and re-evaluate soon.
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

// Linger: stand still (press nothing) for a beat so a just-corrupted Joe can finish
// his climax right here before the bartender strolls on to the next spawn.
function LairsLingerAction(frames)
{
	BasicAction.call(this);
	this.framesToWait = frames;
};

LairsLingerAction.prototype.Update = function()
{
	// Deliberately no input — impliedKeyup lets the released keys settle him to idle.
	this.timer += 1;
	if (this.timer > this.framesToWait)
		this.ended = true;
};

LairsLingerAction.prototype.Complete = function() { this.ended = true; };

// Work a Joe: approach and grab. The Bartender's own grab logic decides the
// outcome — grabbing a fresh Joe starts a Drag (we then press smoke for a
// SmokeKiss that corrupts him), while grabbing a fapping *corrupt* Joe at full
// sex-meter starts the full sex animation instead. Either finisher is self-running
// once entered, so we just wait for him to return to Walk. If doSex is set, once
// the kiss has corrupted the Joe we stay on him and grab again for the full sex
// animation — the Bartender's grab does sex when he grabs a corrupt fuckable target
// at full sex-meter (the director keeps the meter topped).
//   0 approach, 1 grab, 2 smoke (kiss), 3 kiss finishing,
//   4 wait for corruption, 5 approach for sex, 6 grab for sex, 7 sex finishing
function LairsSeduceAction(target, doSex)
{
	BasicAction.call(this);
	this.target = target;
	this.doSex = !!doSex;
	this.phase = 0;
	this.phaseTimer = 0;
	// The grab hitbox reaches X 100..300 (Bartender.grabAttack SetBounds(100,-28,300,28)),
	// but body collision stops the Bartender ~150px short of a target, so we must fire
	// the grab from *within* that reach — never try to close nearer than collision allows,
	// or he just shoves the Joe along forever.
	this.grabRangeX = 260;   // fire the grab once the target is inside the grab hitbox
	this.grabRangeY = 26;    // and roughly on the same Y plane (box half-height is 28)
	this.timeout = 1100;     // hard safety cap covering the full kiss-then-sex combo
};

// States that mean a finisher (kiss or sex) is committed and self-running.
function LairsIsFinisherState(s)
{
	return s === States.SmokeKiss ||
		   s === States.PrepareSexTop || s === States.BeforeSexTop ||
		   s === States.CaptiveSexTop || s === States.AfterSexTop;
}

LairsSeduceAction.prototype.Update = function()
{
	this.timer += 1;
	this.phaseTimer += 1;

	var o = this.owner;
	var t = this.target;

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
			else this.ended = true;
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
	else                                // phase 7: sex finishing
	{
		if (o.state === States.Walk) this.ended = true;
	}
};

LairsSeduceAction.prototype.Complete = function() { this.ended = true; };

// Popper: hit the poppers button to go drunk. Poppers only register from Walk
// (they trigger the Sniff gesture, after which drunkTimer ramps up).
function LairsPopperAction()
{
	BasicAction.call(this);
	this.timeout = 60;
};

LairsPopperAction.prototype.Update = function()
{
	this.timer += 1;
	this.owner.controller.poppersKeyDown();
	if (this.owner.state === States.Sniff || this.owner.drunkTimer > 0 || this.timer > this.timeout)
		this.ended = true;
};

LairsPopperAction.prototype.Complete = function() { this.ended = true; };

// ---- Director --------------------------------------------------------------
// Keeps the star alive and feeds him a steady trickle of showcase Joes from the
// right edge. Update() is called each frame from updateAll() while lairsMode.
function LairsDirector()
{
	this.spawnTimer = 45;         // first Joe arrives quickly
	this.bgPairTimer = 120;       // first background couple a little after
	this.bgPairs = [];            // active background couples (pairs of looping kiss effects)
	this.kissAnimL = null;        // shared horny-kiss animation templates, grabbed lazily
	this.kissAnimR = null;
	this.bgCharTimer = 200;       // first corrupt showcase character a bit later still
	this.bgChars = [];            // active permanently-corrupt back-plane characters
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
	// (spawn gating), cull far-behind stragglers, and retire "spent" Joes. A seduced
	// Joe gets recruit()ed and would then follow the bartender forever, so once it has
	// had a few seconds to show its reaction we poof it away — keeping the frame
	// focused on the current seduction instead of a growing cheering mob.
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

		if (e.alliance === 2 && !IsDeadOrDying(e.state) && !e.recruited)
		{
			// Count every LIVE enemy Joe — fresh, being kissed, or still fapping toward
			// orgasm. Holding the next spawn until the current one has fully finished and
			// died keeps just one live Joe on stage at a time (LAIRS_TARGET_FRESH), so
			// corrupt Joes never stack up. The bartender lingers beside each one until it's
			// done rather than marching on (see LairsBartenderAI.GenerateNewAction).
			freshCount += 1;
		}
		else if (e.recruited && !IsCorrupt(e.state) && !busy)
		{
			// A recruited ally would follow the bartender forever (it never falls
			// behind on its own), so retire it after a short while. Corrupt Joes are
			// deliberately NOT touched here — they run their own fap -> orgasm -> death
			// animation and clean themselves up; poofing them early made them "vanish".
			if (typeof(e.lairsSpentTimer) !== "number")
				e.lairsSpentTimer = LAIRS_SPENT_LIFESPAN;
			else
				e.lairsSpentTimer -= 1;

			if (e.lairsSpentTimer <= 0)
			{
				LairsPoof(e);
				level.entities.Remove(e);
				i -= 1;
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
		// Off the left edge, or somehow already gone -> retire the couple.
		if (p.left.state === States.Dead || p.right.state === States.Dead ||
			p.left.posX < camera.boundingRect.xMin - 300)
		{
			p.left.Die();
			p.right.Die();
			this.bgPairs.splice(i, 1);
		}
	}

	if (this.bgPairTimer > 0)
		this.bgPairTimer -= 1;

	if (this.bgPairTimer === 0 && this.bgPairs.length < LAIRS_MAX_BG_PAIRS)
	{
		this.SpawnBackgroundPair();
		this.bgPairTimer = LAIRS_BG_PAIR_COOLDOWN;
	}
};

// Pick a back-plane X inside the *visible* area, biased to the left or right flank so
// the couple/character frames the star instead of covering him. Placing them on-screen
// (rather than off the right edge) means they're seen even when the slow one-at-a-time
// pacing keeps the bartender — and so the camera — nearly stationary. When the camera
// does scroll, they drift with the world and off-screen ones are retired as before.
function LairsBackPlaneX()
{
	var vis = camera.boundingRect.xMax - camera.boundingRect.xMin;
	if (!(vis > 0))
		vis = getVirtualScreenWidth();
	var side = (Math.random() < 0.5) ? (0.10 + Math.random() * 0.24)    // left flank
	                                 : (0.60 + Math.random() * 0.26);   // right flank
	return camera.boundingRect.xMin + vis * side;
};

LairsDirector.prototype.SpawnBackgroundPair = function()
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

	var px = LairsBackPlaneX();
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

		// Off the left edge (or somehow gone) -> retire quietly (no poof: it's off-screen).
		if (typeof(e.posX) !== "number" || e.state === States.Dead ||
			e.posX < camera.boundingRect.xMin - 300)
		{
			level.entities.Remove(e);
			this.bgChars.splice(i, 1);
			continue;
		}

		// Rotate the cast: after a while, poof this one out so a different character can
		// take its place — otherwise, when the foreground pacing keeps the camera nearly
		// still, the same two would stand there forever.
		e.lairsBgLife -= 1;
		if (e.lairsBgLife <= 0)
		{
			LairsPoof(e);
			level.entities.Remove(e);
			this.bgChars.splice(i, 1);
			continue;
		}

		// Hold him mid-corruption forever: keep him in the fapping Corrupt state and pin
		// stateFrames below the orgasm ramp (fapSpeed only bottoms out, triggering climax,
		// once stateFrames reaches ~240-300 — so capping it well under that loops the fap).
		if (e.state !== States.Corrupt && !IsDeadOrDying(e.state))
			e.ChangeState(States.Corrupt);
		if (e.stateFrames > LAIRS_BG_CHAR_FAP_HOLD)
			e.stateFrames = LAIRS_BG_CHAR_FAP_HOLD;
	}

	if (this.bgCharTimer > 0)
		this.bgCharTimer -= 1;

	if (this.bgCharTimer === 0 && this.bgChars.length < LAIRS_MAX_BG_CHARS)
	{
		this.SpawnBackgroundChar();
		this.bgCharTimer = LAIRS_BG_CHAR_COOLDOWN;
	}
};

LairsDirector.prototype.SpawnBackgroundChar = function()
{
	// Pick a character not already on the back plane, so the concurrent pair are always
	// two different members of the cast rather than duplicates.
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
		return;

	var MyClass = stringToFunction(name);
	if (typeof(MyClass) !== "function")
		return;

	var e = new MyClass();
	e.isLairsBgChar = true;   // exempt from the foreground roster counting and the far-behind cull
	e.lairsBgLife = LAIRS_BG_CHAR_LIFESPAN + Math.floor(Math.random() * 300);   // jitter so the two don't rotate in lockstep

	var px = LairsBackPlaneX();
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
	LairsPoof(e);   // a puff of smoke covers him appearing on-screen (and rotating out)
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
