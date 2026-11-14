/*
 * bot.js — a simple player bot for the tests. Test-only, injected by
 * tests/run.js alongside hooks.js; the game never loads it.
 *
 * The bot only ever touches the game through the controller's buttons, the same
 * as a person would. It has two layers:
 *
 *   - primitives (SFTest.bot.moveToward / fight / drive) that the scenario tests
 *     use to walk somewhere or beat somebody up without scripting every frame;
 *   - a level-clearing brain (SFTest.bot.clearLevel) that fights what is in the
 *     way and walks to the level's exit, used to catch softlocks and broken
 *     triggers. It is not trying to play well, only to get through.
 *
 * Plain ES5, like the game.
 */
(function ()
{
	var T = window.SFTest;
	var Bot = T.bot = {};

	//////////////////////////////
	// Button intents
	//////////////////////////////
	var DRIVEN = ["up", "down", "left", "right", "punch", "smoke", "grab", "jump"];
	var want = {};
	var taps = {};		// button -> { hold: frames left down, cool: frames left before it may be pressed again }

	function clearWants()
	{
		for (var i = 0; i < DRIVEN.length; i++)
			want[DRIVEN[i]] = false;
	}

	function applyWants()
	{
		for (var i = 0; i < DRIVEN.length; i++)
		{
			var b = DRIVEN[i];
			if (taps[b])
			{
				if (taps[b].hold > 0)
				{
					want[b] = true;
					taps[b].hold -= 1;
				}
				else if (taps[b].cool > 0)
				{
					want[b] = false;
					taps[b].cool -= 1;
				}
				else
				{
					taps[b] = null;
				}
			}
			if (want[b] && !controller[b])
			{
				// Two quick presses of a direction are a double-tap (run / sidehop).
				// The bot only walks, so wait out the double-tap window first.
				if (i < 4 && controller[b + "FramesSinceShortTap"] <= controller.doubleTapPressGap + 1)
					continue;
				T.press(b);
			}
			else if (!want[b] && controller[b])
				T.release(b);
		}
	}

	// Ask for a short press. Ignored while an earlier tap of the same button is
	// still playing out, so calling it every frame gives a steady rhythm.
	Bot.tap = function(button, holdFrames, coolFrames)
	{
		if (!taps[button])
			taps[button] = { hold: holdFrames, cool: coolFrames };
	};

	Bot.hold = function(button) { want[button] = true; };

	Bot.reset = function()
	{
		taps = {};
		clearWants();
		applyWants();
	};

	//////////////////////////////
	// Primitives (call once per frame from a drive() policy)
	//////////////////////////////

	// Walk toward a point. Returns true once within the tolerances.
	Bot.moveToward = function(x, y, tolX, tolY)
	{
		var dx = x - player.posX;
		var dy = y - player.posY;
		if (dx > tolX) want.right = true;
		else if (dx < -tolX) want.left = true;
		if (dy > tolY) want.down = true;
		else if (dy < -tolY) want.up = true;
		return Math.abs(dx) <= tolX && Math.abs(dy) <= tolY;
	};

	// Get within a band of distances in front of a target, facing it. Returns true
	// once there. The default band suits a punch or grab (the bartender's attack
	// boxes reach 100-300 ahead); blown smoke lands 420-780 ahead.
	Bot.approach = function(target, minX, maxX)
	{
		if (typeof minX === "undefined") { minX = 120; maxX = 270; }
		var dx = target.posX - player.posX;
		var dy = target.posY - player.posY;
		var side = (dx >= 0) ? 1 : -1;
		var inX = Math.abs(dx) >= minX && Math.abs(dx) <= maxX;
		var inY = Math.abs(dy) <= 22;

		if (!inY)
		{
			if (dy > 0) want.down = true;
			else want.up = true;
		}
		if (!inX)
		{
			if (target.posX - side * (minX + maxX) / 2 > player.posX) want.right = true;
			else want.left = true;
		}
		else if (player.facing !== side)
		{
			if (side > 0) want.right = true;
			else want.left = true;
		}
		return inX && inY && player.facing === side;
	};

	// Walk up to a target and punch it whenever it can be hit.
	Bot.fight = function(target)
	{
		if (Bot.approach(target) && IsAttackable(target.state))
			Bot.tap("punch", 3, 9);
	};

	// Rough-house policy for tests that just need some progress made: fight the
	// nearest enemy within `range`, otherwise pick up a dropped meter orb,
	// otherwise walk right.
	Bot.brawl = function(range)
	{
		var enemy = T.nearestEnemy(range);
		if (enemy !== null && enemy.health > 0 && !IsCorrupt(enemy.state))
		{
			Bot.fight(enemy);
			return;
		}
		var orbs = T.orbs(ORB_DOMINATE).concat(T.orbs(ORB_CORRUPT));
		if (orbs.length)
			Bot.moveToward(orbs[0].posX, orbs[0].posY, 10, 10);
		else
			want.right = true;
	};

	// Run the game with `policy()` deciding the buttons each frame, until
	// `done()` returns true. Returns the frames taken, or -1 if maxFrames ran out.
	Bot.drive = function(policy, done, maxFrames)
	{
		var result = -1;
		for (var i = 0; i <= maxFrames; i++)
		{
			if (done())
			{
				result = i;
				break;
			}
			if (i === maxFrames)
				break;
			clearWants();
			policy();
			applyWants();
			T.step(1);
		}
		Bot.reset();
		return result;
	};
	//////////////////////////////
	// Navigation: distance-to-goal over a grid of walkable cells
	//////////////////////////////
	// The level's collision mask is sampled on a grid (a cell is walkable if a
	// circle the player's size is not pushed out of it), then a breadth-first
	// flood from the goal gives every reachable cell its distance to the goal.
	// Walking downhill on that field is the route. No per-level waypoints.
	var CELL = 45;

	function isFree(x, y, radius)
	{
		var eject = level.collisionMask.Collide(x, y, radius, player);
		return Math.abs(eject.x) + Math.abs(eject.y) < 0.01;
	}

	function buildField(goal)
	{
		var lines = level.collisionMask.lines;
		var xMin = Math.min(player.posX, goal.xMin), xMax = Math.max(player.posX, goal.xMax);
		var yMin = Math.min(player.posY, goal.yMin), yMax = Math.max(player.posY, goal.yMax);
		for (var i = 0; i < lines.length; i++)
		{
			var l = lines[i];
			if (isFinite(l.x1) && isFinite(l.x2) && l.x1 !== null && l.x2 !== null)
			{
				xMin = Math.min(xMin, l.x1, l.x2);
				xMax = Math.max(xMax, l.x1, l.x2);
			}
			if (isFinite(l.y1) && isFinite(l.y2) && l.y1 !== null && l.y2 !== null)
			{
				yMin = Math.min(yMin, l.y1, l.y2);
				yMax = Math.max(yMax, l.y1, l.y2);
			}
		}
		xMin -= 2 * CELL; yMin -= 2 * CELL; xMax += 2 * CELL; yMax += 2 * CELL;

		var field = {
			xMin: xMin, yMin: yMin,
			cols: Math.ceil((xMax - xMin) / CELL) + 1,
			rows: Math.ceil((yMax - yMin) / CELL) + 1,
			lineCount: lines.length,
			levelName: level.levelName
		};
		var cols = field.cols, rows = field.rows;
		var radius = player.collisionRadius;
		var free = field.free = new Uint8Array(cols * rows);
		var dist = field.dist = new Int32Array(cols * rows);

		for (var r = 0; r < rows; r++)
		{
			for (var c = 0; c < cols; c++)
			{
				free[r * cols + c] = isFree(xMin + c * CELL, yMin + r * CELL, radius) ? 1 : 0;
				dist[r * cols + c] = -1;
			}
		}

		// Seed the flood with every walkable cell inside the goal.
		var queue = [];
		for (var gr = 0; gr < rows; gr++)
		{
			for (var gc = 0; gc < cols; gc++)
			{
				var gx = xMin + gc * CELL, gy = yMin + gr * CELL;
				if (free[gr * cols + gc] && gx >= goal.xMin && gx <= goal.xMax && gy >= goal.yMin && gy <= goal.yMax)
				{
					dist[gr * cols + gc] = 0;
					queue.push(gr * cols + gc);
				}
			}
		}
		field.goalCells = queue.length;

		var head = 0;
		while (head < queue.length)
		{
			var cell = queue[head++];
			var cr = Math.floor(cell / cols), cc = cell % cols;
			for (var dr = -1; dr <= 1; dr++)
			{
				for (var dc = -1; dc <= 1; dc++)
				{
					if (dr === 0 && dc === 0)
						continue;
					var nr = cr + dr, nc = cc + dc;
					if (nr < 0 || nc < 0 || nr >= rows || nc >= cols)
						continue;
					var n = nr * cols + nc;
					if (!free[n] || dist[n] !== -1)
						continue;
					// No squeezing diagonally past a corner, and nothing in between.
					if (dr !== 0 && dc !== 0 && (!free[cr * cols + nc] || !free[nr * cols + cc]))
						continue;
					if (!isFree(xMin + (cc + dc / 2) * CELL, yMin + (cr + dr / 2) * CELL, radius))
						continue;
					dist[n] = dist[cell] + 1;
					queue.push(n);
				}
			}
		}
		return field;
	}

	// The field cell nearest a point that has a route to the goal (searching a few
	// cells around it), or -1.
	function reachableCellNear(field, x, y)
	{
		var c0 = Math.round((x - field.xMin) / CELL), r0 = Math.round((y - field.yMin) / CELL);
		var best = -1, bestD = Number.MAX_VALUE;
		for (var dr = -3; dr <= 3; dr++)
		{
			for (var dc = -3; dc <= 3; dc++)
			{
				var r = r0 + dr, c = c0 + dc;
				if (r < 0 || c < 0 || r >= field.rows || c >= field.cols)
					continue;
				var n = r * field.cols + c;
				if (field.dist[n] < 0)
					continue;
				var d = Math.abs(dr) + Math.abs(dc);
				if (d < bestD)
				{
					bestD = d;
					best = n;
				}
			}
		}
		return best;
	}

	// Follow the field downhill `steps` cells from `cell`; returns the cell reached.
	function downhill(field, cell, steps)
	{
		var cols = field.cols;
		for (var s = 0; s < steps; s++)
		{
			var r = Math.floor(cell / cols), c = cell % cols;
			var best = cell;
			for (var dr = -1; dr <= 1; dr++)
			{
				for (var dc = -1; dc <= 1; dc++)
				{
					var nr = r + dr, nc = c + dc;
					if (nr < 0 || nc < 0 || nr >= field.rows || nc >= cols)
						continue;
					var n = nr * cols + nc;
					if (field.dist[n] < 0 || field.dist[n] >= field.dist[best])
						continue;
					if (dr !== 0 && dc !== 0 && (!field.free[r * cols + nc] || !field.free[nr * cols + c]))
						continue;
					best = n;
				}
			}
			if (best === cell)
				break;
			cell = best;
		}
		return cell;
	}

	//////////////////////////////
	// The level-clearing brain
	//////////////////////////////
	function activeSkirmish()
	{
		for (var i = 0; i < level.skirmishes.length; i++)
		{
			if (level.skirmishes[i].started && !level.skirmishes[i].finished)
				return level.skirmishes[i];
		}
		return null;
	}

	function finishedSkirmishes()
	{
		var n = 0;
		for (var i = 0; i < level.skirmishes.length; i++)
		{
			if (level.skirmishes[i].finished)
				n += 1;
		}
		return n;
	}

	// Make a brain that plays the current level toward its exit to `exitLevel`.
	//   opts.stuckFrames   frames without any progress before giving up (default 1800)
	//   opts.keepAlive     top lives back up so the bot never reaches game over (default true)
	Bot.makeBrain = function(exitLevel, opts)
	{
		opts = opts || {};
		var exit = T.exitTo(exitLevel);
		if (exit === null)
			throw new Error("bot: this level has no transition box to '" + exitLevel + "'");

		var brain = {
			startLevel: level.levelName,
			exitLevel: exitLevel,
			goal: exit.box,
			stuckFrames: opts.stuckFrames || 1800,
			keepAlive: opts.keepAlive !== false,
			field: null,
			bestDist: Number.MAX_VALUE,
			lastProgressFrame: T.frame,
			lastProgressWhy: "start",
			doing: "starting",
			deaths: 0,
			lastLives: lives,
			skirmishesDone: 0,
			skirmishWasActive: false,
			dispatched: enemiesDispatched,
			corrupted: enemiesCorrupted,
			target: null,
			targetHealth: 0,
			targetSince: 0,
			ignoreUntil: {},
			posHistory: [],
			smashUntil: 0,
			jiggleUntil: 0,
			jiggleDir: "up",
			blockedCount: 0,
			log: [],
			outcome: null
		};

		function note(text)
		{
			if (brain.log.length < 200)
				brain.log.push(T.frame + ": " + text);
		}

		function progress(why)
		{
			brain.lastProgressFrame = T.frame;
			brain.lastProgressWhy = why;
		}

		function pickTarget()
		{
			var skirmish = activeSkirmish();
			var enemies = T.enemies();
			var best = null, bestScore = Number.MAX_VALUE;
			for (var i = 0; i < enemies.length; i++)
			{
				var e = enemies[i];
				if (brain.ignoreUntil[e.objectID] > T.frame)
					continue;
				if (!(e.health > 0) || IsCorrupt(e.state) || e.broken)
					continue;
				var dx = Math.abs(e.posX - player.posX), dy = Math.abs(e.posY - player.posY);
				if (skirmish !== null)
				{
					if (!skirmish.box.PointIntersect(e.posX, e.posY))
						continue;
				}
				else if (dx > 650 || dy > 320)
				{
					continue;
				}
				var score = dx + 2 * dy;
				if (score < bestScore)
				{
					bestScore = score;
					best = e;
				}
			}
			return best;
		}

		function navigate()
		{
			var lines = level.collisionMask.lines.length;
			if (brain.field === null || brain.field.lineCount !== lines || brain.field.levelName !== level.levelName)
			{
				brain.field = buildField(brain.goal);
				note("route planned (" + brain.field.cols + "x" + brain.field.rows + " cells)");
			}
			var field = brain.field;
			var here = reachableCellNear(field, player.posX, player.posY);
			if (here === -1)
			{
				// No walkable route from here: head straight for the exit and let the
				// stuck timer report it if that goes nowhere.
				brain.doing = "no route to the exit; walking straight at it";
				Bot.moveToward((brain.goal.xMin + brain.goal.xMax) / 2, (brain.goal.yMin + brain.goal.yMax) / 2, 10, 10);
				return;
			}
			if (field.dist[here] < brain.bestDist)
			{
				brain.bestDist = field.dist[here];
				progress("closer to the exit");
			}
			var ahead = downhill(field, here, brain.blockedCount > 0 ? 1 : 3);
			var tx = field.xMin + (ahead % field.cols) * CELL;
			var ty = field.yMin + Math.floor(ahead / field.cols) * CELL;
			if (field.dist[here] === 0)
			{
				tx = (brain.goal.xMin + brain.goal.xMax) / 2;
				ty = (brain.goal.yMin + brain.goal.yMax) / 2;
			}
			brain.doing = "walking to the exit (" + field.dist[here] + " cells away)";
			Bot.moveToward(tx, ty, 10, 8);
		}

		// One frame of thinking. Sets the buttons; returns an outcome string when
		// the run is over, otherwise null.
		brain.tick = function()
		{
			if (brain.outcome !== null)
				return brain.outcome;

			if (level.levelName !== brain.startLevel)
			{
				brain.outcome = (level.levelName === brain.exitLevel) ? "exit" : "wrong-level";
				Bot.reset();
				return brain.outcome;
			}
			if (menuStack.length > 0)
			{
				brain.outcome = "menu";
				brain.doing = "a " + T.typeName(menuStack[menuStack.length - 1]) + " screen opened";
				Bot.reset();
				return brain.outcome;
			}

			// Bookkeeping: deaths, skirmishes, the meters.
			if (lives < brain.lastLives)
			{
				brain.deaths += brain.lastLives - lives;
				note("died (" + brain.deaths + " so far)");
			}
			if (brain.keepAlive && lives < 2)
				lives = 2;
			brain.lastLives = lives;

			var skirmish = activeSkirmish();
			if (skirmish !== null && !brain.skirmishWasActive)
				note("skirmish started");
			brain.skirmishWasActive = skirmish !== null;
			var done = finishedSkirmishes();
			if (done > brain.skirmishesDone)
			{
				brain.skirmishesDone = done;
				note("skirmish cleared");
				progress("cleared a skirmish");
			}
			if (enemiesDispatched + enemiesCorrupted > brain.dispatched + brain.corrupted)
			{
				brain.dispatched = enemiesDispatched;
				brain.corrupted = enemiesCorrupted;
				progress("collected an orb");
			}

			if (T.frame - brain.lastProgressFrame > brain.stuckFrames)
			{
				brain.outcome = "stuck";
				Bot.reset();
				return brain.outcome;
			}

			clearWants();

			// Fight whoever is in the way.
			var target = pickTarget();
			if (target !== brain.target)
			{
				brain.target = target;
				brain.targetSince = T.frame;
				brain.targetHealth = target ? target.health : 0;
			}
			if (target !== null)
			{
				if (target.health < brain.targetHealth)
				{
					brain.targetHealth = target.health;
					brain.targetSince = T.frame;
					progress("hurt a " + T.typeName(target));
				}
				if (T.frame - brain.targetSince > 600)
				{
					// Ten seconds without landing anything: leave it for a while.
					brain.ignoreUntil[target.objectID] = T.frame + 1200;
					note("gave up on a " + T.typeName(target) + " at " + Math.round(target.posX) + "," + Math.round(target.posY));
				}
				brain.doing = "fighting a " + T.typeName(target);
				Bot.fight(target);
			}
			else if (skirmish !== null)
			{
				brain.doing = "locked in a skirmish with nobody left to fight";
				Bot.moveToward(skirmish.box.centerX(), skirmish.box.centerY(), 60, 40);
			}
			else
			{
				// Pick up a nearby orb on the way past, otherwise head for the exit.
				var orb = null, orbDistance = 350;
				for (var i = 0; i < level.entities.list.length; i++)
				{
					var e = level.entities.list[i];
					if (!(e instanceof CollectableOrb) || e.collected)
						continue;
					if (e.kind === ORB_HEALTH && player.health >= player.maxHealth)
						continue;
					if (e.kind === ORB_POPPERS && poppers >= maxPoppers)
						continue;
					var d = distance(player.posX, player.posY, e.posX, e.posY);
					if (d < orbDistance && e.timer > 60)
					{
						orbDistance = d;
						orb = e;
					}
				}
				if (orb !== null && T.frame - brain.lastProgressFrame < 300)
				{
					brain.doing = "picking up an orb";
					Bot.moveToward(orb.posX, orb.posY, 10, 10);
				}
				else
				{
					navigate();
				}
			}

			// Something solid in the way that the map does not know about (a door,
			// a vending machine): punch it, and if that does not help, sidestep.
			var moving = want.left || want.right || want.up || want.down;
			brain.posHistory.push([player.posX, player.posY]);
			if (brain.posHistory.length > 45)
				brain.posHistory.shift();
			if (T.frame < brain.jiggleUntil)
			{
				want.left = want.right = false;
				want.up = (brain.jiggleDir === "up");
				want.down = !want.up;
			}
			else if (T.frame < brain.smashUntil)
			{
				Bot.tap("punch", 3, 9);
			}
			else if (moving && brain.posHistory.length === 45 && player.state === States.Walk)
			{
				var old = brain.posHistory[0];
				if (distance(old[0], old[1], player.posX, player.posY) < 12)
				{
					brain.blockedCount += 1;
					brain.posHistory = [];
					if (brain.blockedCount % 3 === 0)
					{
						brain.jiggleDir = (brain.jiggleDir === "up") ? "down" : "up";
						brain.jiggleUntil = T.frame + 40;
						note("blocked at " + Math.round(player.posX) + "," + Math.round(player.posY) + ": sidestepping " + brain.jiggleDir);
					}
					else
					{
						brain.smashUntil = T.frame + 60;
						note("blocked at " + Math.round(player.posX) + "," + Math.round(player.posY) + ": punching");
					}
				}
				else
				{
					brain.blockedCount = 0;
				}
			}

			applyWants();
			return null;
		};

		brain.report = function()
		{
			var nearby = [];
			var all = T.enemies();
			for (var i = 0; i < all.length && nearby.length < 8; i++)
			{
				if (Math.abs(all[i].posX - player.posX) < 1200)
					nearby.push(T.describe(all[i]));
			}
			var skirmish = activeSkirmish();
			return {
				outcome: brain.outcome,
				from: brain.startLevel,
				level: level.levelName,
				frames: T.frame,
				deaths: brain.deaths,
				skirmishesCleared: brain.skirmishesDone,
				skirmishesTotal: (level.levelName === brain.startLevel) ? level.skirmishes.length : null,
				enemiesDispatched: enemiesDispatched,
				enemiesCorrupted: enemiesCorrupted,
				doing: brain.doing,
				cellsFromExit: brain.bestDist === Number.MAX_VALUE ? null : brain.bestDist,
				framesSinceProgress: T.frame - brain.lastProgressFrame,
				lastProgress: brain.lastProgressWhy,
				skirmishActive: skirmish !== null,
				player: T.describe(player),
				nearbyEnemies: nearby,
				log: brain.log
			};
		};

		return brain;
	};

	// Play the current level until the bot reaches `exitLevel`, gets stuck, or
	// maxFrames pass. Returns the brain's report (outcome: "exit", "stuck",
	// "timeout", "menu" or "wrong-level").
	Bot.clearLevel = function(exitLevel, maxFrames, opts)
	{
		var brain = Bot.makeBrain(exitLevel, opts);
		var start = T.frame;
		while (brain.tick() === null)
		{
			if (T.frame - start >= maxFrames)
			{
				brain.outcome = "timeout";
				break;
			}
			T.step(1);
		}
		Bot.reset();
		return brain.report();
	};
})();
