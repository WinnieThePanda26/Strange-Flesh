/*
 * hooks.js — test-only hooks for Strange Flesh.
 *
 * This file is NOT part of the game. index.html and the include() list in
 * StrangeFlesh.js never reference it; tests/run.js injects it into the page
 * (before the game's own scripts run) and nothing else loads it.
 *
 * It gives the tests a deterministic game:
 *   - the game's setInterval(tick) is swallowed, so nothing updates until a
 *     test calls SFTest.step(n), which runs n frames;
 *   - Math.random is replaced by a seeded generator (SFTest.seed(n));
 *   - drawing is taken off requestAnimationFrame once SFTest.freeze() is called;
 *     from then on every step is one updateAll() followed by one drawAll(). The
 *     draw is not optional: some game logic (footsteps, smoke puffs, the
 *     StarvingArtist's walk) reads animation flags that only a draw refreshes,
 *     so "one draw per update" is part of what makes a run reproducible. Draw
 *     code gets its own random stream so it can never disturb gameplay's;
 *   - level files are loaded synchronously from text handed in by the runner.
 *
 * Plain ES5, like the game.
 */
(function ()
{
	if (window.SFTest)
		return;

	var T = window.SFTest = {};

	T.frame = 0;			// frames (update + draw) since the last newGame()
	T.defaultSeed = 1;
	T.levelText = {};		// level name -> descriptor JSON text (set by the runner)
	T.tickSwallowed = 0;
	T.liveDraw = true;

	//////////////////////////////
	// Seeded random numbers
	//////////////////////////////
	function makeRng(seed)
	{
		var s = seed >>> 0;
		var rng = function()
		{
			rng.calls += 1;
			s = (s + 0x6D2B79F5) | 0;
			var t = Math.imul(s ^ (s >>> 15), 1 | s);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		rng.calls = 0;
		rng.seed = function(n) { s = n >>> 0; rng.calls = 0; };
		rng.state = function() { return s >>> 0; };
		return rng;
	}

	var gameRandom = makeRng(T.defaultSeed);
	var drawRandom = makeRng(7);
	Math.random = gameRandom;

	T.seed = function(n) { gameRandom.seed(n); };
	T.rngState = function() { return gameRandom.state(); };
	T.rngCalls = function() { return gameRandom.calls; };

	//////////////////////////////
	// Timers
	//////////////////////////////
	var realSetInterval = window.setInterval;
	var realRAF = window.requestAnimationFrame;

	// The game starts its update loop with setInterval(tick, ...) (StrangeFlesh()
	// and setFPS()). Swallow exactly that; every other interval is left alone.
	window.setInterval = function(fn)
	{
		if (typeof fn === "function" && fn.name === "tick")
		{
			T.tickSwallowed += 1;
			return 0;
		}
		return realSetInterval.apply(window, arguments);
	};

	function withDrawRandom(fn, arg)
	{
		var previous = Math.random;
		Math.random = drawRandom;
		try { fn(arg); }
		finally { Math.random = previous; }
	}

	// Drawing runs live (so the loading screen works) until freeze(); after that
	// the game's requestAnimationFrame(drawAll) calls are dropped.
	window.requestAnimationFrame = function(callback)
	{
		if (!T.liveDraw)
			return 0;
		return realRAF.call(window, function(timestamp) { withDrawRandom(callback, timestamp); });
	};

	T.freeze = function() { T.liveDraw = false; };

	// Draw one frame right now. Called after every update (see frame() below).
	T.draw = function()
	{
		updated = true;
		withDrawRandom(drawAll);
	};

	// One frame of the game as the tests define it: an update, then a draw.
	function frame()
	{
		updateAll();
		T.draw();
		T.frame += 1;
	}

	//////////////////////////////
	// Input
	//////////////////////////////
	var BUTTONS = ["up", "down", "left", "right", "punch", "smoke", "grab", "special", "jump", "start", "poppers", "any"];
	T.BUTTONS = BUTTONS;

	T.press = function(button) { controller[button + "KeyDown"](); };
	T.release = function(button) { if (controller[button]) controller[button + "KeyUp"](); };

	T.releaseAll = function()
	{
		for (var i = 0; i < BUTTONS.length; i++)
			T.release(BUTTONS[i]);
	};

	// Press a button, run `frames` updates, release it.
	T.hold = function(button, frames)
	{
		T.press(button);
		T.step(frames);
		T.release(button);
	};

	// A short press: down for `frames` updates (default 2), then up.
	T.tap = function(button, frames)
	{
		T.hold(button, frames || 2);
	};

	// Put the controller's frame counters back to a freshly-constructed state.
	function resetController()
	{
		T.releaseAll();
		var fresh = new Controller();
		for (var key in fresh)
		{
			if (fresh.hasOwnProperty(key) && typeof fresh[key] === "number")
				controller[key] = fresh[key];
		}
		for (var i = 0; i < BUTTONS.length; i++)
			controller[BUTTONS[i]] = false;
	}

	//////////////////////////////
	// Stepping
	//////////////////////////////
	T.onBeforeStep = null;		// optional function(frame), e.g. replay or the bot

	T.step = function(n)
	{
		if (typeof n === "undefined")
			n = 1;
		for (var i = 0; i < n; i++)
		{
			if (!GlobalResourceLoader.AllReady())
				throw new Error("SFTest.step: game is not ready (a level or resource is still loading)");
			if (T.onBeforeStep !== null)
				T.onBeforeStep(T.frame);
			frame();
		}
	};

	// Step until predicate() is true. Returns the number of frames it took, or -1
	// if maxFrames passed first.
	T.stepUntil = function(predicate, maxFrames)
	{
		for (var i = 0; i <= maxFrames; i++)
		{
			if (predicate())
				return i;
			if (i < maxFrames)
				T.step(1);
		}
		return -1;
	};

	//////////////////////////////
	// Levels and game setup
	//////////////////////////////

	// Same job as the game's loadLevelFromURL, but a level whose text the runner
	// already handed over loads synchronously instead of by XMLHttpRequest. A
	// transition box then changes level inside the frame that triggers it, the
	// way it already does for a level that is in the cache.
	function installLevelLoader()
	{
		if (T.realLoadLevelFromURL)
			return;
		T.realLoadLevelFromURL = loadLevelFromURL;
		loadLevelFromURL = function(urlStr, inGameTransition, onStarted)
		{
			if (!levelcache.hasOwnProperty(urlStr) && T.levelText.hasOwnProperty(urlStr))
			{
				levelcache[urlStr] = new Level();
				loadLevel(levelcache[urlStr], T.levelText[urlStr], urlStr, inGameTransition, onStarted);
				return;
			}
			return T.realLoadLevelFromURL(urlStr, inGameTransition, onStarted);
		};
	}

	// End an arcade run an earlier test left going. The game banks the score of a
	// run that is quit half way; a test starts with whatever best score it set up
	// itself, so that run's score is dropped first.
	function dropArcadeRun()
	{
		if (arcadeDirector !== null)
			arcadeDirector.score = 0;
		endArcadeMode();
	}

	// Start a fresh game in the named level: what resetGame() does, minus the
	// title flow (cutscene, main menu), with the level loaded synchronously.
	//   opts.seed    random seed (default SFTest.defaultSeed)
	//   opts.settle  step until the player has landed and can act (default true)
	T.newGame = function(levelName, opts)
	{
		opts = opts || {};
		installLevelLoader();

		if (!T.levelText.hasOwnProperty(levelName))
			throw new Error("SFTest.newGame: unknown level '" + levelName + "'");

		T.seed(typeof opts.seed === "undefined" ? T.defaultSeed : opts.seed);
		T.frame = 0;
		T.onBeforeStep = null;

		endLairsMode();
		dropArcadeRun();
		resetController();
		ResetAllAttacks();

		menuStack = [];
		playerStack = [];
		level = null;
		nextObjectID = 0;
		activeCombatTimer = 0;
		soundWaveTrigger = 0;
		zombieNeverSpawned = true;
		continuesUsed = 0;
		gameOverResumeSaved = false;
		pause = false;

		player = new Bartender();
		player.disableSpawnOnScroll = true;
		player.ChangeAlliance(1);
		player.controller = controller;

		enemyinfo.Clear();
		hud.Reset();
		ClearSuspendableSounds();

		neverSaved = true;
		lives = startingLives;
		poppers = 0;
		enemiesDispatched = 0;
		enemiesCorrupted = 0;
		totalEnemies = 948;

		playerFirstSpawn = true;
		startupTimer = 0;
		respawnCounter = 0;
		entityFrameskip = 0;
		entityFrameskipCounter = 0;

		clearLevelCache();
		loadLevelFromURL(levelName, false);

		if (opts.settle !== false)
			T.settle();
	};

	// Start an arcade run the way the main menu's "Arcade" button does (it calls
	// startArcadeMode()), with the same seeding and bookkeeping as newGame().
	//   opts.seed    random seed (default SFTest.defaultSeed)
	//   opts.settle  step until the player has landed and can act (default true)
	T.newArcade = function(opts)
	{
		opts = opts || {};
		installLevelLoader();

		T.seed(typeof opts.seed === "undefined" ? T.defaultSeed : opts.seed);
		T.frame = 0;
		T.onBeforeStep = null;

		dropArcadeRun();
		resetController();
		nextObjectID = 0;
		activeCombatTimer = 0;
		soundWaveTrigger = 0;
		pause = false;

		startArcadeMode();

		if (opts.settle !== false)
			T.settle();
	};

	// Step until the player is on the ground in the Walk state.
	T.settle = function(maxFrames)
	{
		var frames = T.stepUntil(function() { return player.state === States.Walk && player.posZ === 0; }, maxFrames || 900);
		if (frames === -1)
			throw new Error("SFTest.settle: player never landed (state " + GetStateName(player.state) + ", z " + player.posZ + ")");
		return frames;
	};

	// Create an entity by constructor name and add it to the current level, at
	// full health unless props says otherwise.
	T.spawn = function(typeName, x, y, props)
	{
		var Constructor = window[typeName];
		if (typeof Constructor !== "function")
			throw new Error("SFTest.spawn: no such entity type '" + typeName + "'");
		var entity = new Constructor();
		entity.posX = x;
		entity.posY = y;
		entity.posZ = 0;
		// Levels give every entity its health explicitly; do the same here.
		if (typeof entity.maxHealth === "number")
			entity.health = entity.maxHealth;
		if (props)
		{
			for (var key in props)
			{
				if (props.hasOwnProperty(key))
					entity[key] = props[key];
			}
		}
		level.entities.AddEntity(entity);
		return entity;
	};

	T.typeName = function(obj)
	{
		return (obj && obj.constructor && obj.constructor.name) ? obj.constructor.name : "?";
	};

	// Entities of a type in the current level ("*" or nothing for all of them).
	T.entities = function(typeName)
	{
		var found = [];
		for (var i = 0; i < level.entities.list.length; i++)
		{
			if (!typeName || typeName === "*" || T.typeName(level.entities.list[i]) === typeName)
				found.push(level.entities.list[i]);
		}
		return found;
	};

	// Put the player somewhere, standing still (for tests that are about a trigger,
	// not about the walk to it).
	T.teleport = function(x, y)
	{
		player.posX = x;
		player.posY = y;
		player.posZ = 0;
		player.velX = 0;
		player.velY = 0;
		player.velZ = 0;
	};

	// The transition box in the current level that leads to the named level.
	T.exitTo = function(targetLevel)
	{
		for (var i = 0; i < level.transitions.length; i++)
		{
			if (level.transitions[i].changeLevel && level.transitions[i].targetLevel === targetLevel)
				return level.transitions[i];
		}
		return null;
	};

	// The nearest live enemy to the player within maxDistance (or null).
	T.nearestEnemy = function(maxDistance)
	{
		var enemies = T.enemies();
		var best = null;
		var bestDistance = (typeof maxDistance === "undefined") ? Number.MAX_VALUE : maxDistance;
		for (var i = 0; i < enemies.length; i++)
		{
			var d = distance(player.posX, player.posY, enemies[i].posX, enemies[i].posY);
			if (d < bestDistance)
			{
				bestDistance = d;
				best = enemies[i];
			}
		}
		return best;
	};

	// Live enemies (alliance 2, with health, not already dying).
	T.enemies = function()
	{
		var found = [];
		for (var i = 0; i < level.entities.list.length; i++)
		{
			var e = level.entities.list[i];
			if (e.alliance === 2 && !IsDeadOrDying(e.state))
				found.push(e);
		}
		return found;
	};

	// Orbs lying in the level (not yet picked up). kind: ORB_DOMINATE etc., or
	// nothing for all kinds. A picked-up orb then flies to the HUD and only counts
	// when it arrives: see orbsInFlight().
	T.orbs = function(kind)
	{
		var found = [];
		for (var i = 0; i < level.entities.list.length; i++)
		{
			var e = level.entities.list[i];
			if (e instanceof CollectableOrb && (typeof kind === "undefined" || e.kind === kind))
				found.push(e);
		}
		return found;
	};

	T.orbsInFlight = function() { return hud.orbs.length; };

	//////////////////////////////
	// State summaries
	//////////////////////////////
	function round(value)
	{
		return (typeof value === "number") ? Math.round(value * 1000) / 1000 : value;
	}

	T.describe = function(e)
	{
		if (!e)
			return null;
		return {
			type: T.typeName(e),
			id: e.objectID,
			x: round(e.posX), y: round(e.posY), z: round(e.posZ),
			state: GetStateName(e.state),
			health: round(e.health),
			alliance: e.alliance
		};
	};

	// Every entity a level holds apart from the player and loose orbs: the ones
	// in play, the ones waiting off-screen to spawn, and the ones held back by a
	// skirmish. Returned as sorted "Type@x,y" strings so two rosters compare easily.
	// grid: snap positions to this many pixels (a save game stores them on a 3px grid).
	T.roster = function(levelObj, grid)
	{
		levelObj = levelObj || level;
		grid = grid || 1;
		var seen = [];
		var lists = [levelObj.entities.list, levelObj.entitiesToSpawn];
		for (var s = 0; s < levelObj.skirmishes.length; s++)
			lists.push(levelObj.skirmishes[s].entities.list);

		var rows = [];
		for (var l = 0; l < lists.length; l++)
		{
			for (var i = 0; i < lists[l].length; i++)
			{
				var e = lists[l][i];
				if (e === player || e instanceof CollectableOrb || seen.indexOf(e) !== -1)
					continue;
				seen.push(e);
				rows.push(T.typeName(e) + "@" + Math.round(e.posX / grid) * grid + "," + Math.round(e.posY / grid) * grid);
			}
		}
		rows.sort();
		return rows;
	};

	// The things a save game is supposed to carry.
	T.progress = function(grid)
	{
		return {
			level: level.levelName,
			lives: lives,
			poppers: poppers,
			health: round(player.health),
			sexMeter: round(player.sexMeter),
			enemiesDispatched: enemiesDispatched,
			enemiesCorrupted: enemiesCorrupted,
			continuesUsed: continuesUsed,
			x: Math.round(player.posX / (grid || 1)) * (grid || 1),
			y: Math.round(player.posY / (grid || 1)) * (grid || 1),
			roster: T.roster(level, grid)
		};
	};

	// A readable picture of the game, for failure dumps and comparisons.
	T.snapshot = function()
	{
		var snap = {
			frame: T.frame,
			level: level ? level.levelName : null,
			menu: menuStack.length ? T.typeName(menuStack[menuStack.length - 1]) : null,
			menuDepth: menuStack.length,
			lives: lives,
			poppers: poppers,
			enemiesDispatched: enemiesDispatched,
			enemiesCorrupted: enemiesCorrupted,
			activeAttacks: activeAttacks.length,
			rngCalls: gameRandom.calls,
			player: T.describe(player),
			captive: player && player.captive ? T.describe(player.captive) : null,
			entities: [],
			waitingToSpawn: 0,
			skirmishes: []
		};
		if (player)
			snap.player.sexMeter = round(player.sexMeter);
		if (level)
		{
			for (var i = 0; i < level.entities.list.length; i++)
			{
				if (level.entities.list[i] !== player)
					snap.entities.push(T.describe(level.entities.list[i]));
			}
			snap.waitingToSpawn = level.entitiesToSpawn.length;
			for (var j = 0; j < level.skirmishes.length; j++)
			{
				snap.skirmishes.push({
					started: level.skirmishes[j].started,
					finished: level.skirmishes[j].finished,
					waiting: level.skirmishes[j].entities.list.length
				});
			}
		}
		return snap;
	};

	// A hash of everything gameplay-relevant. Two runs that agree on this every
	// frame are, for testing purposes, the same run. The random generator's state
	// is included because it is the first thing to move when behaviour changes.
	T.digest = function()
	{
		var parts = [T.frame, level ? level.levelName : "", menuStack.length, lives, poppers,
					 enemiesDispatched, enemiesCorrupted, activeAttacks.length, gameRandom.state()];
		if (level)
		{
			parts.push(level.entities.list.length, level.entities.effects.length, level.entitiesToSpawn.length);
			for (var i = 0; i < level.entities.list.length; i++)
			{
				var e = level.entities.list[i];
				parts.push(T.typeName(e), e.posX, e.posY, e.posZ, e.velX, e.velY, e.velZ, e.state, e.health, e.facing);
			}
		}
		var str = parts.join("|");
		var hash = 5381;
		for (var j = 0; j < str.length; j++)
			hash = ((hash << 5) + hash + str.charCodeAt(j)) | 0;
		return hash >>> 0;
	};

	// Throw if any entity has a position or health that is not a finite number.
	T.checkSane = function()
	{
		for (var i = 0; i < level.entities.list.length; i++)
		{
			var e = level.entities.list[i];
			if (!isFinite(e.posX) || !isFinite(e.posY) || !isFinite(e.posZ))
				throw new Error("frame " + T.frame + ": " + T.typeName(e) + " has a non-finite position (" + e.posX + ", " + e.posY + ", " + e.posZ + ")");
			if (typeof e.health !== "undefined" && !isFinite(e.health))
				throw new Error("frame " + T.frame + ": " + T.typeName(e) + " has non-finite health (" + e.health + ")");
		}
	};

	//////////////////////////////
	// Input recording and replay
	//////////////////////////////

	// A recording is a list of [frame, button, isDown] events: the controller's
	// buttons are compared against the previous frame just before each update.
	// (A press and release that both fall between two updates is not seen.)
	var recorder = null;

	function sampleButtons(frame)
	{
		for (var i = 0; i < BUTTONS.length; i++)
		{
			var down = !!controller[BUTTONS[i]];
			if (down !== recorder.down[i])
			{
				recorder.down[i] = down;
				recorder.events.push([frame, BUTTONS[i], down ? 1 : 0]);
			}
		}
	}

	// Start recording and run the game in real time (60 updates a second) so a
	// person can play it. digestEvery: frames between stored state digests.
	T.startRecording = function(digestEvery)
	{
		recorder = { events: [], digests: [], down: [], digestEvery: digestEvery || 60, timer: 0, error: null };
		for (var i = 0; i < BUTTONS.length; i++)
			recorder.down.push(false);

		recorder.timer = realSetInterval.call(window, function()
		{
			if (recorder === null || recorder.error !== null || !GlobalResourceLoader.AllReady())
				return;
			try
			{
				if (T.onBeforeStep !== null)
					T.onBeforeStep(T.frame);
				sampleButtons(T.frame);
				frame();
				if (T.frame % recorder.digestEvery === 0)
					recorder.digests.push([T.frame, T.digest()]);
			}
			catch (err)
			{
				recorder.error = String(err && err.stack ? err.stack : err);
			}
		}, 1000 / 60);
	};

	// What has been recorded so far (the runner polls this, so nothing is lost if
	// the window is simply closed).
	T.recordingSoFar = function()
	{
		if (recorder === null)
			return null;
		return { frames: T.frame, events: recorder.events, digests: recorder.digests, error: recorder.error };
	};

	T.stopRecording = function()
	{
		if (recorder === null)
			return null;
		clearInterval(recorder.timer);
		var result = T.recordingSoFar();
		recorder = null;
		return result;
	};

	// Run the game at normal speed (60 frames a second), for watching in a
	// visible window. beforeFrame(frame) is called before every update and
	// returns false to stop.
	T.runRealtime = function(beforeFrame)
	{
		var timer = realSetInterval.call(window, function()
		{
			try
			{
				if (!GlobalResourceLoader.AllReady())
					return;
				if (beforeFrame(T.frame) === false)
				{
					clearInterval(timer);
					T.releaseAll();
					return;
				}
				frame();
			}
			catch (err)
			{
				clearInterval(timer);
				throw err;
			}
		}, 1000 / 60);
	};

	// Play a recording back for `frames` updates. Returns the digests taken at the
	// same frames the recording stored them, for the caller to compare.
	T.replay = function(events, frames, digestEvery)
	{
		var next = 0;
		var digests = [];
		T.onBeforeStep = function(frame)
		{
			while (next < events.length && events[next][0] <= frame)
			{
				if (events[next][2])
					controller[events[next][1] + "KeyDown"]();
				else
					controller[events[next][1] + "KeyUp"]();
				next += 1;
			}
		};
		try
		{
			while (T.frame < frames)
			{
				T.step(1);
				if (T.frame % digestEvery === 0)
					digests.push([T.frame, T.digest()]);
			}
		}
		finally
		{
			T.onBeforeStep = null;
		}
		return digests;
	};
})();
