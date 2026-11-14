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
				T.press(b);
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
})();
