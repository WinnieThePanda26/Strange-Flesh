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
// ARCADE — a five-minute survival mode with no story.
//
// The player fights waves of enemies in one walled arena (the club from level 4,
// built in code the way Lairs builds its level) until the lives run out, then
// gets a score. Each wave walks in from off-screen, past the arena walls; the
// next one starts a few seconds after the last enemy of a wave is beaten.
//
// Both ways of beating an enemy score the same, and switching between them
// scores more (see ArcadeDirector.ScoreDefeat), so neither style is the "right"
// one. The best score lives in localStorage["ArcadeBest"], next to the save game
// but separate from it. An arcade run never saves or loads the story game.
//
// In: the main menu's "Arcade" button calls startArcadeMode().
// Out: the results screen (Retry / Exit to Title) or pause -> Exit to Title.
// Every way out ends in resetGame(), which calls endArcadeMode().
// ---------------------------------------------------------------------------

// ---- Tunables --------------------------------------------------------------

// The arena: level 4's club floor, walled in on all four sides.
var ARCADE_HALF_WIDTH = 1300;              // the side walls are at -1300 and +1300
var ARCADE_BACK_Y = -267;                  // back wall (level 4's own)
var ARCADE_FRONT_Y = 132;                  // front edge of the floor (level 4's own)
var ARCADE_CAMERA_TOP_Y = -948;            // top of level 4's backdrop
var ARCADE_MUSIC_TRACK = "level4";

// Lives and rewards
var ARCADE_LIVES = 3;                      // the run ends when the last one is lost
var ARCADE_WAVE_HEALTH_ORBS = 3;           // health orbs dropped when a wave is cleared (5 health each, of 200)
var ARCADE_LIFE_EVERY_WAVES = 5;           // an extra life drops after every 5th wave
var ARCADE_METER_ORBS = 150;               // orbs that fill the HUD's domination / corruption bars
var ARCADE_DROP_LIFETIME = 15 * 60;        // a drop nobody picks up (a popper when the stash is full, say) lasts this long
var ARCADE_DROP_BLINK = 3 * 60;            // ...and blinks for this long at the end of it

// Pacing (frames at 60 per second)
var ARCADE_FIRST_WAVE_DELAY = 150;         // the bartender takes about this long to land
var ARCADE_INTERMISSION = 180;             // breather between waves
var ARCADE_SPAWN_INTERVAL = 75;            // gap between two enemies walking in
var ARCADE_ENTRY_SPEED = 6;                // slowest an enemy outside the walls closes on them, per frame
var ARCADE_WALK_IN_TIMEOUT = 300;          // longest a new enemy's AI is held to walking to his first spot
var ARCADE_NOTICE_DISTANCE = 1800;         // most enemies ignore a player further off than 2000; keep them nearer than this
var ARCADE_WALL_ZONE = 250;                // a leaping enemy this close to a side wall dodges back toward the middle
var ARCADE_WAVE_TIME_LIMIT = 90 * 60;      // a wave not cleared in this long is joined by the next one anyway
var ARCADE_BANNER_FRAMES = 150;            // how long a "Wave 3" banner stays up

// Waves. A wave has a budget to spend on the roster below; an enemy can be picked
// once its fromWave is reached, and costs its cost. Only so many are let into the
// arena at a time; the rest wait their turn outside.
//
// These numbers were set with the test bot (tests/scenarios/12-arcade.js), which
// only punches and never tires: with them it lasts five to eight minutes (waves
// 8 to 10) on three lives. Budget per wave and the stage limit move that the most,
// then the health orbs a cleared wave drops.
var ARCADE_WAVE_BASE_BUDGET = 2;           // budget of wave n = base + n * per-wave
var ARCADE_WAVE_BUDGET_PER_WAVE = 4;
var ARCADE_STAGE_BASE = 5;                 // enemies in the arena at once = base + floor(wave / 2), up to the max
var ARCADE_STAGE_MAX = 12;

var ARCADE_ROSTER = [
	{ "name":"Joe1",            "cost":1, "fromWave":1 },
	{ "name":"Bottley",         "cost":1, "fromWave":2 },
	{ "name":"Joe2",            "cost":2, "fromWave":2 },
	{ "name":"PunkPuppy",       "cost":2, "fromWave":2 },
	{ "name":"Admonitor",       "cost":2, "fromWave":3 },
	{ "name":"Fister",          "cost":2, "fromWave":3 },
	{ "name":"ColombianRescue", "cost":2, "fromWave":3 },
	{ "name":"Joe3",            "cost":3, "fromWave":4 },
	{ "name":"EDRider",         "cost":3, "fromWave":4 },
	{ "name":"PartyAnimal",     "cost":3, "fromWave":4 },
	{ "name":"Dissolution",     "cost":3, "fromWave":5 },
	{ "name":"VirusFromVenus",  "cost":3, "fromWave":5 },
	{ "name":"Joe4",            "cost":4, "fromWave":6 },
	{ "name":"FartherFigure",   "cost":4, "fromWave":6 }
];

// Scoring
var ARCADE_POINTS_PER_COST = 100;          // a defeat scores this times the enemy's cost, knockout or corruption alike
var ARCADE_SWITCH_MULTIPLIER = 1.5;        // ...times this when it was beaten the other way from the enemy before it
var ARCADE_WAVE_BONUS = 250;               // clearing wave n scores this times n

var ARCADE_BEST_KEY = "ArcadeBest";        // localStorage key; the story save is "SavedGame"

// ---- Best score ------------------------------------------------------------
// Stored as {"score": n, "wave": n}. Anything unreadable counts as no best yet.
function loadArcadeBest()
{
	var best = { "score": 0, "wave": 0 };
	var stored = localStorage.getItem(ARCADE_BEST_KEY);
	if (stored !== null)
	{
		try
		{
			var parsed = JSON.parse(stored);
			if (parsed !== null && typeof(parsed.score) === "number" && isFinite(parsed.score) && parsed.score > 0)
			{
				best.score = Math.floor(parsed.score);
				if (typeof(parsed.wave) === "number" && isFinite(parsed.wave))
					best.wave = Math.floor(parsed.wave);
			}
		}
		catch (err)
		{
			// Not ours or damaged: start from zero, the next best overwrites it.
		}
	}
	return best;
};

function saveArcadeBest(score, wave)
{
	localStorage.setItem(ARCADE_BEST_KEY, JSON.stringify({ "score": score, "wave": wave }));
};

// 12345 -> "12,345"
function ArcadeFormatScore(value)
{
	var digits = String(Math.floor(value));
	var out = "";
	for (var i = 0; i < digits.length; i++)
	{
		if (i > 0 && (digits.length - i) % 3 === 0)
			out += ",";
		out += digits.charAt(i);
	}
	return out;
};

// ---- Entry point -----------------------------------------------------------
function startArcadeMode()
{
	DismissAllMenus();
	menuStack = [];

	// Whatever was running, story level, Lairs or an earlier arcade run, is over.
	endLairsMode();
	endArcadeMode();

	// Clean slate (the same things resetGame() and startLairsMode() reset).
	ResetAllAttacks();
	ClearSuspendableSounds();
	clearLevelCache();
	playerStack = [];

	player = new Bartender();
	player.disableSpawnOnScroll = true;
	player.ChangeAlliance(1);
	player.controller = controller;

	enemyinfo.Clear();
	hud.Reset();

	lives = ARCADE_LIVES;
	poppers = 0;
	enemiesDispatched = 0;
	enemiesCorrupted = 0;
	// The HUD's two meters fill at 45% of totalEnemies (see HUD.Update).
	totalEnemies = Math.ceil(ARCADE_METER_ORBS / 0.45);
	respawnCounter = 0;
	entityFrameskip = 0;
	entityFrameskipCounter = 0;
	neverSaved = true;
	gameOverResumeSaved = false;   // a game over here must never offer the story's "Continue?"
	playerFirstSpawn = false;
	startupTimer = 60;             // skip the first second of the red start-up fade; keep the rest as the intro

	arcadeMode = true;

	level = BuildArcadeLevel();
	level.Start();
	camera.setPosition(0, ARCADE_FRONT_Y - 540);

	// Drop in the way a story game does (smoke descent, a moment of invincibility).
	player.Respawn({ 'x': player.posX, 'y': player.posY, 'z': 1080 });

	GlobalMusic.stop();
	GlobalMusic.setTrack(ARCADE_MUSIC_TRACK);
	GlobalMusic.setVolume(settings.musicLevelGameplay);
	GlobalMusic.play(0.5);

	// The director runs as an overlay: it updates after the entities each frame
	// and draws the wave / score panel over the HUD.
	arcadeDirector = new ArcadeDirector();
	overlays.push(arcadeDirector);
};

// Tear down an arcade run. Called from resetGame(), where every way out of the
// mode ends up, and from startArcadeMode() for a retry. Does nothing when no run
// is active, so a story game's resetGame() is unchanged by it.
function endArcadeMode()
{
	if (!arcadeMode)
		return;

	if (arcadeDirector !== null)
	{
		// Quitting half way still counts for the best score.
		arcadeDirector.BankScore();

		var i = overlays.indexOf(arcadeDirector);
		if (i !== -1)
			overlays.splice(i, 1);
	}

	// Nothing from the arena may outlive it: attacks in flight, looping engine
	// sounds (see LairsSilenceEntity), sex or spawn sound effects, a takeover.
	if (level !== null && level.levelName === "arcade")
	{
		for (var s = 0; s < level.entities.list.length; s++)
			LairsSilenceEntity(level.entities.list[s]);
	}
	ResetAllAttacks();
	ClearSuspendableSounds();
	playerStack = [];
	entityFrameskip = 0;
	entityFrameskipCounter = 0;
	camera.enableRatchet = false;

	arcadeMode = false;
	arcadeDirector = null;
};

// ---- The arena -------------------------------------------------------------
// A Level built in code: level 4's club backdrop and floor, with a wall at each
// end. The camera stops at the walls, so anything beyond them is off-screen at
// every aspect ratio, which is where the waves come from.
function BuildArcadeLevel()
{
	var lv = new Level();
	lv.levelName = "arcade";
	lv.displayName = "";                      // the director announces the waves itself
	lv.musicTrack = ARCADE_MUSIC_TRACK;
	lv.zombiesCanSpawn = false;               // every enemy in here is one the director sent
	lv.backgroundColor = "#000000";
	lv.spawnPosition = { x: 0, y: Math.round((ARCADE_BACK_Y + ARCADE_FRONT_Y) / 2) };

	// Backdrop. Laid out on level 4's own tile grid (it starts at x = -1200 there,
	// 1152 to a tile) so the furniture below sits where it was drawn to sit.
	var tileWidth = 1152;                     // 384 * pxScale
	var bg = new RepeatingBackground(animatedElementLibrary["clubbg"]);
	bg.parallax = 0;
	bg.posX = -1200 - tileWidth * 2;
	bg.posY = ARCADE_CAMERA_TOP_Y;
	bg.repX = 7;                              // -3504 .. 4560: well past both walls
	bg.repY = 1;
	lv.background.push(bg);

	// The lounge furniture from the first screens of level 4, at its original
	// positions and again one arena-width over, so the back wall isn't bare.
	var furniture = [
		["club_bgtable",  -453, -858], ["club_bgcouch", -879, -889], ["club_bg2couch", -198, -888],
		["club_table",    -456, -534], ["club_couch",   -933, -746], ["club_2couch",   -162, -639],
		["club_couch",     717, -747], ["club_2couch",  1488, -738]
	];
	for (var f = 0; f < furniture.length; f++)
	{
		var piece = new RepeatingBackground(animatedElementLibrary[furniture[f][0]]);
		piece.parallax = 0;
		piece.posX = furniture[f][1];
		piece.posY = furniture[f][2];
		lv.background.push(piece);
	}

	// Level 4's drifting foreground smoke.
	var smoke = new RepeatingBackground("foreground_smoke1", "screen");
	smoke.parallax = -0.6;
	smoke.posX = -1650 - tileWidth * 2;
	smoke.posY = -402;
	smoke.repX = 8;
	smoke.floatYAmplitude = 20;
	smoke.floatYPeriodInFrames = 600;
	smoke.floatYShiftInFrames = 160;
	lv.foreground.push(smoke);

	// Collision: a closed box. The walls stop everybody; enemies get in past them
	// because a newly spawned entity ignores level collision until it has arrived
	// (WalkingEntity's newlySpawned, the same thing EntitySpawner relies on).
	var w = ARCADE_HALF_WIDTH;
	lv.collisionMask.AddLine(-w - 2000, ARCADE_BACK_Y, w + 2000, ARCADE_BACK_Y);
	lv.collisionMask.AddLine(-w - 2000, ARCADE_FRONT_Y, w + 2000, ARCADE_FRONT_Y);
	lv.collisionMask.AddLine(-w, ARCADE_BACK_Y, -w, ARCADE_FRONT_Y);
	lv.collisionMask.AddLine(w, ARCADE_BACK_Y, w, ARCADE_FRONT_Y);

	// Camera: the mask is collided with a circle as tall as the view, which at
	// 16:9 leaves 420 of view either side of it (CanvasCamera widens the circle by
	// the extra width in widescreen). So lines 420 inside the walls put the edge
	// of the view exactly on the walls at any aspect ratio.
	var cameraInset = (1920 - 1080) / 2;
	lv.cameraMask.AddLine(-w - 2000, ARCADE_CAMERA_TOP_Y, w + 2000, ARCADE_CAMERA_TOP_Y);
	lv.cameraMask.AddLine(-w - 2000, ARCADE_FRONT_Y, w + 2000, ARCADE_FRONT_Y);
	lv.cameraMask.AddLine(-w + cameraInset, ARCADE_CAMERA_TOP_Y - 200, -w + cameraInset, ARCADE_FRONT_Y + 200);
	lv.cameraMask.AddLine(w - cameraInset, ARCADE_CAMERA_TOP_Y - 200, w - cameraInset, ARCADE_FRONT_Y + 200);

	return lv;
};

// The enemies a wave is made of, as a list of constructor names: spend the wave's
// budget on random picks from the part of the roster this wave has unlocked.
function ArcadeBuildWave(wave)
{
	var budget = ARCADE_WAVE_BASE_BUDGET + wave * ARCADE_WAVE_BUDGET_PER_WAVE;
	var names = [];
	while (budget > 0)
	{
		var affordable = [];
		for (var i = 0; i < ARCADE_ROSTER.length; i++)
		{
			if (ARCADE_ROSTER[i].fromWave <= wave && ARCADE_ROSTER[i].cost <= budget)
				affordable.push(ARCADE_ROSTER[i]);
		}
		if (affordable.length === 0)
			break;
		var pick = affordable[Math.floor(Math.random() * affordable.length)];
		names.push(pick.name);
		budget -= pick.cost;
	}
	return names;
};

function ArcadeCostOf(name)
{
	for (var i = 0; i < ARCADE_ROSTER.length; i++)
	{
		if (ARCADE_ROSTER[i].name === name)
			return ARCADE_ROSTER[i].cost;
	}
	return 1;
};

// ---- Director --------------------------------------------------------------
// Runs the waves and keeps the score. It sits on the overlays list (added in
// startArcadeMode, removed in endArcadeMode): Update() runs once a frame after
// the entities, Draw() puts the panel on screen.
function ArcadeDirector()
{
	this.wave = 0;                 // the wave being fought (0 before the first)
	this.score = 0;
	this.knockouts = 0;
	this.corruptions = 0;
	this.lastStyle = null;         // "knockout" or "corruption": how the previous enemy was beaten

	var best = loadArcadeBest();
	this.best = best.score;        // the best before this run; BankScore() raises it
	this.newBest = false;

	this.enemies = [];             // enemies sent in and not yet beaten: { entity, cost }
	this.queue = [];               // names still to send in for this wave
	this.waveActive = false;
	this.waveFrames = 0;           // how long the current wave has been going
	this.intermission = ARCADE_FIRST_WAVE_DELAY;
	this.spawnTimer = 0;
	this.nextSide = (Math.random() < 0.5) ? -1 : 1;
	this.finished = false;

	this.frames = 0;               // length of the run
	this.bannerText = [];
	this.bannerTimer = 0;
	this.awardText = "";
	this.awardTimer = 0;
};

// An enemy is beaten once it is dead or dying, or once it has turned (a corrupt
// enemy is harmless and finishes itself off; no need to make the wave wait for it).
function ArcadeIsBeaten(entity)
{
	return IsDeadOrDying(entity.state) || IsCorrupt(entity.state);
};

ArcadeDirector.prototype.Update = function()
{
	if (!arcadeMode || this.finished || level === null || level.levelName !== "arcade")
		return;

	this.frames += 1;
	if (this.bannerTimer > 0)
		this.bannerTimer -= 1;
	if (this.awardTimer > 0)
		this.awardTimer -= 1;

	// Score whoever has just been beaten, and count who is still fighting.
	var hostile = 0;
	for (var i = 0; i < this.enemies.length; i++)
	{
		var e = this.enemies[i].entity;
		if (ArcadeIsBeaten(e))
		{
			this.ScoreDefeat(e, this.enemies[i].cost);
			this.enemies.splice(i, 1);
			i -= 1;
			continue;
		}

		this.KeepInArena(this.enemies[i]);

		// A recruited enemy is on the player's side for a while. He doesn't hold
		// the wave up; he is still on the books for when he turns back.
		if (e.alliance === 2)
			hostile += 1;
	}

	this.ExpireDrops();

	if (this.waveActive)
	{
		if (this.spawnTimer > 0)
			this.spawnTimer -= 1;

		if (this.queue.length > 0)
		{
			if (this.spawnTimer === 0 && hostile < this.StageLimit())
			{
				this.SpawnEnemy(this.queue.shift());
				this.spawnTimer = ARCADE_SPAWN_INTERVAL;
			}
		}
		else if (hostile === 0)
		{
			this.WaveCleared();
		}

		// Out of time: the next wave comes in on top of this one's stragglers (no
		// bonus, no reward). It keeps the pressure on a player who is stalling, and
		// it means one enemy nobody can get at never leaves a run with nothing to do.
		this.waveFrames += 1;
		if (this.waveActive && this.waveFrames > ARCADE_WAVE_TIME_LIMIT)
			this.StartWave();
	}
	else
	{
		this.intermission -= 1;
		if (this.intermission <= 0)
			this.StartWave();
	}
};

ArcadeDirector.prototype.StageLimit = function()
{
	return Math.min(ARCADE_STAGE_BASE + Math.floor(this.wave / 2), ARCADE_STAGE_MAX);
};

ArcadeDirector.prototype.StartWave = function()
{
	this.wave += 1;
	// (After a timed-out wave, whoever of it was still waiting outside comes first.)
	this.queue = this.queue.concat(ArcadeBuildWave(this.wave));
	this.waveActive = true;
	this.waveFrames = 0;
	this.spawnTimer = 0;
	this.ShowBanner(["Wave " + this.wave]);
};

ArcadeDirector.prototype.WaveCleared = function()
{
	this.waveActive = false;
	this.intermission = ARCADE_INTERMISSION;

	var bonus = ARCADE_WAVE_BONUS * this.wave;
	this.score += bonus;
	this.ShowBanner(["Wave " + this.wave + " cleared", "+" + ArcadeFormatScore(bonus)]);

	// The reward falls in around the middle of the screen.
	for (var i = 0; i < ARCADE_WAVE_HEALTH_ORBS; i++)
		this.DropOrb(ORB_HEALTH);
	if (this.wave % ARCADE_LIFE_EVERY_WAVES === 0)
		this.DropOrb(ORB_LIFE);
};

ArcadeDirector.prototype.DropOrb = function(kind)
{
	var source = {
		posX: clamp(camera.posX + (Math.random() - 0.5) * 500, -ARCADE_HALF_WIDTH + 200, ARCADE_HALF_WIDTH - 200),
		posY: (ARCADE_BACK_Y + ARCADE_FRONT_Y) / 2 + (Math.random() - 0.5) * 120,
		posZ: 500,
		velX: 0, velY: 0, velZ: 0
	};
	level.entities.AddEntity(new CollectableOrb(kind, false, source, 0, 0, 1));
};

// A run has no end, so what is dropped and not picked up would pile up on the
// floor: poppers while the stash is full, health while he is unhurt. Anything
// lying there too long blinks, then goes. (An orb counts its own frames on the
// floor in orb.timer, and draws at orb.alpha until it is picked up.)
ArcadeDirector.prototype.ExpireDrops = function()
{
	var list = level.entities.list;
	for (var i = 0; i < list.length; i++)
	{
		var orb = list[i];
		if (!(orb instanceof CollectableOrb) || orb.collected)
			continue;

		if (orb.timer > ARCADE_DROP_LIFETIME)
			orb.Die();
		else if (orb.timer > ARCADE_DROP_LIFETIME - ARCADE_DROP_BLINK)
			orb.alpha = (Math.floor(orb.timer / 6) % 2 === 0) ? 1.0 : 0.25;
	}
};

// Send one enemy in: put it outside a side wall, which is always off-screen, and
// have it walk to a spot on that side of the player.
ArcadeDirector.prototype.SpawnEnemy = function(name)
{
	var MyClass = stringToFunction(name);
	if (typeof(MyClass) !== "function")
		return;

	var e = new MyClass();

	// Left and right take turns. The exception is an enemy who cannot be walked
	// over to the player (see below): he does not come in by a wall so far off that
	// he would stand there without noticing him, the arena being wider than most
	// enemies can see.
	var side = this.nextSide;
	this.nextSide = -this.nextSide;
	if (!ArcadeCanWalk(e) && Math.abs(side * ARCADE_HALF_WIDTH - player.posX) > ARCADE_NOTICE_DISTANCE)
		side = -side;

	var margin = e.collisionRadius + 40;
	var spawnX = side * (ARCADE_HALF_WIDTH + 300);
	var spawnY = ARCADE_BACK_Y + margin + Math.random() * (ARCADE_FRONT_Y - ARCADE_BACK_Y - 2 * margin);

	// Close enough to the player to pick the fight, never outside the walls.
	var targetX = clamp(player.posX + side * (450 + Math.random() * 250),
						-ARCADE_HALF_WIDTH + margin + 60, ARCADE_HALF_WIDTH - margin - 60);

	e.ChangeAlliance(2);
	e.Respawn({ 'x': spawnX, 'y': spawnY, 'z': 0 });
	if (e.hasOwnProperty("facing"))
		e.facing = -side;

	// The same two things EntitySpawner does to walk a new enemy on stage.
	e.newlySpawned = true;
	e.newlySpawnedTargetX = targetX;
	e.newlySpawnedTargetY = spawnY;

	// The walk is an order at the head of his AI's queue, and nothing else runs
	// until it is done. So it is only given to an enemy who can walk (a
	// ColombianRescue moves by leaping and would stand at the wall obeying it for
	// ever; his own AI heads for the screen, and KeepInArena sees him in), it is
	// satisfied by getting near the spot, and it times out.
	if (e.ai !== null && ArcadeCanWalk(e))
	{
		var walkIn = new GoToPointAction(targetX, spawnY, 60, false);
		walkIn.timeout = ARCADE_WALK_IN_TIMEOUT;
		e.ai.QueueAction(walkIn);
	}
	if (e.ai !== null)
		ArcadeSteerOffWalls(e.ai);

	level.entities.AddEntity(e);
	this.enemies.push({ "entity": e, "cost": ArcadeCostOf(name), "lastX": spawnX });
};

// True if this enemy moves when he holds a direction on the ground. (His top
// speed depends on his state, so ask about the walking state.)
function ArcadeCanWalk(e)
{
	if (e.MustJumpToMove || typeof(e.GetMoveMaxVelocity) !== "function")
		return true;   // GoToPointAction jumps for him / nothing to ask

	var state = e.state;
	e.state = States.Walk;
	var speed = e.GetMoveMaxVelocity();
	e.state = state;
	return speed > 0;
};

// The leaping enemies (ColombianRescue, FartherFigure) never close on the player
// once they are on screen: each leap is a dodge, left or right according to
// whether they stand above or below him, or a hop away if he is near. In a
// corridor that keeps them hovering about. In a box it walks them into a side
// wall and holds them there, hopping on the spot.
//
// So in the arena, when one of them plans a leap while next to a side wall, the
// leap is made a dodge toward the middle. This wraps the one AI object it is
// given and touches nothing else; an AI whose actions have no dodge to steer
// (every other enemy) is left exactly as it was.
function ArcadeSteerOffWalls(ai)
{
	if (typeof(ai.GenerateNewAction) !== "function" || !ai.hasOwnProperty("actionQueue"))
		return;

	var generate = ai.GenerateNewAction;
	ai.GenerateNewAction = function()
	{
		generate.call(this);

		var owner = this.owner;
		if (!arcadeMode || Math.abs(owner.posX) < ARCADE_HALF_WIDTH - owner.collisionRadius - ARCADE_WALL_ZONE)
			return;

		for (var i = 0; i < this.actionQueue.length; i++)
		{
			var action = this.actionQueue[i];
			if (action.hasOwnProperty("dodge") && action.hasOwnProperty("dodgeHoriz") && action.hasOwnProperty("dodgeRight"))
			{
				action.dodge = true;
				action.dodgeHoriz = true;
				action.dodgeRight = (owner.posX < 0);
			}
		}
	};
};

// Get an enemy into the arena and keep him there.
//
// newlySpawned is what lets him through the wall, and the engine only clears it
// within 50 of the point he was sent to. A fight can start before he gets there,
// so clear it as soon as he is inside: from then on the walls hold him.
//
// Not every enemy walks to that point. A ColombianRescue stops at throwing range
// from the player, and won't throw from off-screen, so with the player near a
// wall he would stand outside it for ever and the wave would never end. So while
// anyone is outside the walls, which is always off-screen, he closes on them at
// ARCADE_ENTRY_SPEED at least, whatever his AI is doing.
ArcadeDirector.prototype.KeepInArena = function(record)
{
	var e = record.entity;
	if (IsCaptive(e.state))
		return;

	// As far out as a wall lets him stand once the walls apply to him.
	var wallX = ARCADE_HALF_WIDTH - e.collisionRadius;
	if (Math.abs(e.posX) <= wallX + 1)
	{
		e.newlySpawned = false;
	}
	else
	{
		var side = (e.posX < 0) ? -1 : 1;
		var allowed = Math.max(Math.abs(record.lastX) - ARCADE_ENTRY_SPEED, wallX - 5);
		if (Math.abs(e.posX) > allowed)
			e.posX = side * allowed;

		if (!e.newlySpawned)
		{
			e.newlySpawned = true;
			e.newlySpawnedTargetX = side * (wallX - 100);
			e.newlySpawnedTargetY = e.posY;
		}
	}

	// The same goes for anyone the player has run a whole arena away from: out of
	// sight and too far off to notice him, he closes the distance.
	var gap = e.posX - player.posX;
	if (Math.abs(gap) > ARCADE_NOTICE_DISTANCE && !camera.boundingRect.PointIntersect(e.posX, e.posY))
		e.posX -= ((gap > 0) ? 1 : -1) * Math.min(ARCADE_ENTRY_SPEED, Math.abs(gap) - ARCADE_NOTICE_DISTANCE);

	record.lastX = e.posX;

	// With no collision out there he can also drift past the front or back of the
	// floor, and would then come in on the wrong side of that line, out of reach.
	e.posY = clamp(e.posY, ARCADE_BACK_Y + e.collisionRadius, ARCADE_FRONT_Y - e.collisionRadius);
};

// Points for one beaten enemy. A knockout and a corruption are worth the same;
// beating an enemy the other way from the one before is worth more, so mixing
// the two styles outscores sticking to either.
ArcadeDirector.prototype.ScoreDefeat = function(e, cost)
{
	var style = (e.corrupted || IsCorrupt(e.state)) ? "corruption" : "knockout";
	var points = ARCADE_POINTS_PER_COST * cost;
	var switched = (this.lastStyle !== null && this.lastStyle !== style);
	if (switched)
		points = Math.round(points * ARCADE_SWITCH_MULTIPLIER);

	if (style === "corruption")
		this.corruptions += 1;
	else
		this.knockouts += 1;
	this.lastStyle = style;
	this.score += points;

	this.awardText = (style === "corruption" ? "Corrupted" : "Knockout") + " +" + ArcadeFormatScore(points) +
					 (switched ? "  switch x" + ARCADE_SWITCH_MULTIPLIER : "");
	this.awardTimer = 120;
};

ArcadeDirector.prototype.ShowBanner = function(lines)
{
	this.bannerText = lines;
	this.bannerTimer = ARCADE_BANNER_FRAMES;
};

// Write the best score if this run has beaten it. Safe to call more than once.
ArcadeDirector.prototype.BankScore = function()
{
	if (this.score > this.best)
	{
		this.best = this.score;
		this.newBest = true;
		saveArcadeBest(this.score, this.wave);
	}
};

// The last life is gone (called from updateAll in place of the story's game over).
ArcadeDirector.prototype.EndRun = function()
{
	if (this.finished)
		return;
	this.finished = true;

	this.BankScore();
	GlobalMusic.stop(2.0);
	ShowArcadeResults(this);
};

// ---- Wave / score panel ----------------------------------------------------
// Top centre, just below where the touch controls put their pause button, and
// clear of the HUD's bars in the two top corners.
ArcadeDirector.prototype.Draw = function()
{
	if (!arcadeMode)
		return;

	// Text is laid out in render-canvas pixels, the space sstext draws in. The
	// backing panel goes through the 1920x1080 virtual transform, so convert with
	// k (see LairsStats.Draw). Everything hangs off the centre of the screen, which
	// is half the virtual width: 960 at 16:9, more in widescreen.
	var k = 1080.0 / c.height;
	var centerX = getVirtualScreenWidth() / 2 / k;
	var panelWidth = 190, panelHeight = 25, panelY = 43;
	var columnOffset = 62;

	ctx.save();
	var ratioTo1080p = c.height / 1080.0;
	ctx.setTransform(ratioTo1080p, 0, 0, ratioTo1080p, 0, 0);
	ctx.globalAlpha = 0.45;
	ctx.fillStyle = "#12040f";
	drawRoundRect((centerX - panelWidth / 2) * k, panelY * k, panelWidth * k, panelHeight * k, 5 * k, true, false);
	ctx.globalAlpha = 1.0;
	ctx.restore();

	var columns = [["WAVE",  String(Math.max(this.wave, 1)),             -columnOffset],
				   ["SCORE", ArcadeFormatScore(this.score),               0],
				   ["BEST",  ArcadeFormatScore(Math.max(this.best, this.score)), columnOffset]];

	sstext.scale = 1.0;
	sstext.alpha = 1.0;
	sstext.textAlign = "center";
	sstext.textBaseline = "top";
	for (var i = 0; i < columns.length; i++)
	{
		sstext.fontSize = 8;
		sstext.DrawTextWithShadow(columns[i][0], centerX + columns[i][2], panelY + 2, "#e9a8d4");
		sstext.fontSize = 12;
		sstext.DrawTextWithShadow(columns[i][1], centerX + columns[i][2], panelY + 11,
								  (i === 2 && this.score > this.best) ? "#ffe066" : "#FFF");
	}

	// What the last defeat scored, under the panel
	if (this.awardTimer > 0)
	{
		sstext.alpha = normalizeValue(this.awardTimer, 0, 30);
		sstext.fontSize = 9;
		sstext.DrawTextWithShadow(this.awardText, centerX, panelY + panelHeight + 4, "#FFF");
	}

	// Wave banner
	if (this.bannerTimer > 0)
	{
		sstext.alpha = Math.min(normalizeValue(this.bannerTimer, 0, 30),
								normalizeValue(ARCADE_BANNER_FRAMES - this.bannerTimer, 0, 15));
		sstext.textBaseline = "middle";
		for (var b = 0; b < this.bannerText.length; b++)
		{
			sstext.fontSize = (b === 0) ? 30 : 18;
			sstext.DrawTextWithShadow(this.bannerText[b], centerX, 112 + b * 28, (b === 0) ? "#FFF" : "#e9a8d4");
		}
	}

	sstext.alpha = 1.0;
};

// ---- Results screen --------------------------------------------------------
function ShowArcadeResults(director)
{
	var seconds = Math.floor(director.frames / fps);
	var time = Math.floor(seconds / 60) + ":" + (seconds % 60 < 10 ? "0" : "") + (seconds % 60);

	var menu = new SettingsMenu();
	menu.useGlobalBackground = false;   // blur the arena as it is now, whatever was open before
	menu.allowBackout = false;          // Retry or Exit: there is no run to go back to
	menu.title = "Run Over";
	menu.items = [
		{ "element":"spacer", "size":34, "fontSize":30, "text":"Score  " + ArcadeFormatScore(director.score) },
		{ "element":"spacer", "size":24,
		  "text":director.newBest ? "New best!" : "Best  " + ArcadeFormatScore(director.best) },
		{ "element":"spacer", "size":24,
		  "text":"Wave " + Math.max(director.wave, 1) + "   -   " + time },
		{ "element":"spacer", "size":24,
		  "text":director.knockouts + " knocked out   -   " + director.corruptions + " corrupted" },
		{ "element":"spacer", "size":20 },
		{ "element":"button", "label":"Retry", "onClick":function()
			{
				startArcadeMode();
			}
		},
		{ "element":"button", "label":"Exit to Title", "onClick":function()
			{
				GlobalMusic.ClearAlternate();
				GlobalMusic.stop(0.25);
				DismissAllMenus();
				resetGame();
			}
		}
	];
	menu.Show();
};
