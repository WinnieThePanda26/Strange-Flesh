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
// LAIRS POPPER TRAINER — the timed layer on top of the Lairs showcase (Lairs.js).
//
// Lairs is already hands-off: you watch. That leaves the screen free to direct
// you. The trainer runs a schedule — count down, call the hit, hold, breathe —
// and the bartender takes every one of them with you: a scheduled hit is now the
// ONLY way he goes drunk (the old random roll is gone), and the longer you hold,
// the longer he stays drunk, which is what puts his drunk kiss/sex art on screen.
//
// The whole thing is configured from the Lairs menu (ShowLairsMenu below), which
// is what the main menu's "Lairs" button now opens.
// ---------------------------------------------------------------------------

// ---- Option tables ---------------------------------------------------------
// Indexed by the matching settings.lairs* value (see loadSettings defaults).
var LAIRS_PACE_SECONDS  = [90, 60, 40];   // seconds between hits
var LAIRS_HOLD_SHORT    = [2, 3, 4];      // short-hit hold, seconds
var LAIRS_HOLD_LONG     = [4, 6, 10];     // long-hit hold, seconds
var LAIRS_LONG_CHANCE   = [0, 0.3, 0.6];  // chance a given hit is a long one
var LAIRS_SESSION_MINS  = [10, 20, 0];    // 0 = endless

// ---- Tunables --------------------------------------------------------------
var LAIRS_WARN_FRAMES = 180;              // 3s of 3-2-1 before the hit lands
var LAIRS_HIT_FRAMES = 240;               // 4s "HIT" — the inhale window
var LAIRS_RELEASE_FRAMES = 90;            // 1.5s "BREATHE" after the hold
var LAIRS_HIT_SLACK_FRAMES = 480;         // up to 8s of give, so a hit prefers to land
                                          // between scenes rather than cutting one off
var LAIRS_DRUNK_PER_HOLD_SECOND = 8;      // drunk seconds the bartender gets per second held.
                                          // 8 rather than 4 because the hold lengths above were
                                          // halved: this keeps how long he stays drunk where it was.
var LAIRS_TRAINER_MAX_DRUNK = 300;        // Lairs-only drunk ceiling in seconds. The engine
                                          // default is 120 (WalkingEntity maxDrunkTimer), low
                                          // enough that long hits would all saturate at it and
                                          // stop reading as longer.
var LAIRS_ESCALATE_OVER = 12;             // hits taken before escalation is at full tilt
var LAIRS_ESCALATE_FLOOR = 30;            // seconds: escalation never paces faster than this

// Trainer phases.
var LairsPhase = { Wait: 0, Warn: 1, Hit: 2, Hold: 3, Release: 4, Done: 5 };

// ---- Trainer ---------------------------------------------------------------
// Lives on the overlays list, so it ticks and draws with the rest of the UI — and,
// like every overlay, stops while a menu is up: pausing the game pauses the count.
function LairsTrainer()
{
	this.phase = LairsPhase.Wait;
	this.phaseTimer = 0;
	this.waitTimer = this.IntervalFrames();
	this.slackTimer = 0;

	this.hits = 0;
	this.longHits = 0;
	this.sessionFrames = 0;

	this.holdSeconds = 0;      // hold length of the hit currently being called
	this.isLongHit = false;
	this.lastTick = -1;        // so the 3-2-1 ticks fire once each

	this.tickSound = GlobalResourceLoader.GetSound("text_click");
	this.hitSound = GlobalResourceLoader.GetSound("menu_boop");
};

// Seconds between hits, tightening as the session goes if escalation is on.
LairsTrainer.prototype.IntervalFrames = function()
{
	var base = LAIRS_PACE_SECONDS[settings.lairsPace];
	if (settings.lairsEscalate === 1)
	{
		var t = Math.min(1, this.hits / LAIRS_ESCALATE_OVER);
		var floor = Math.max(LAIRS_ESCALATE_FLOOR, base * 0.5);
		base = base - (base - floor) * t;
	}
	return Math.round(base * fps);
};

LairsTrainer.prototype.LongHitChance = function()
{
	var chance = LAIRS_LONG_CHANCE[settings.lairsLongChance];
	if (settings.lairsEscalate === 1 && chance > 0)
		chance = Math.min(0.85, chance + 0.25 * Math.min(1, this.hits / LAIRS_ESCALATE_OVER));
	return chance;
};

// True while the cast should hold still (see the freeze in updateAll).
LairsTrainer.prototype.IsFreezing = function()
{
	return this.phase === LairsPhase.Hit || this.phase === LairsPhase.Hold ||
		   this.phase === LairsPhase.Release;
};

// True while the bartender shouldn't start anything new — from the first tick of the
// countdown until the breath is over — so he's free when the hit lands and doesn't
// wander off mid-hold. Read by LairsBartenderAI.GenerateNewAction.
LairsTrainer.prototype.BlocksNewActions = function()
{
	return this.phase !== LairsPhase.Wait && this.phase !== LairsPhase.Done;
};

// Can he be pulled off what he's doing? Being in Walk isn't enough on its own: he
// walks while *approaching* a Joe too, and a hit called then would land three seconds
// later in the middle of the kiss — where poppers don't register at all, since the
// Bartender only reads that button from Walk. So a seduction already under way, at any
// phase, counts as busy; a stroll or a standby can be dropped on the spot.
function LairsBartenderFree()
{
	if (player === null || player.state !== States.Walk)
		return false;
	if (player.ai === null || player.ai.actionQueue.length === 0)
		return true;
	return !(player.ai.actionQueue[0] instanceof LairsSeduceAction);
};

LairsTrainer.prototype.Update = function()
{
	if (!lairsMode || player === null)
		return;

	this.sessionFrames += 1;
	this.phaseTimer += 1;

	if (this.phase === LairsPhase.Wait)
	{
		// Session over: stand down, but leave the show running.
		var limit = LAIRS_SESSION_MINS[settings.lairsSession];
		if (limit > 0 && this.sessionFrames > limit * 60 * fps)
		{
			this.ChangePhase(LairsPhase.Done);
			return;
		}

		if (this.waitTimer > 0)
		{
			this.waitTimer -= 1;
			return;
		}

		// Due. Give the show a little slack to reach a natural gap rather than cutting
		// a seduction in half — but never more than LAIRS_HIT_SLACK_FRAMES of it.
		this.slackTimer += 1;
		if (LairsBartenderFree() || this.slackTimer > LAIRS_HIT_SLACK_FRAMES)
		{
			this.slackTimer = 0;
			this.isLongHit = (Math.random() < this.LongHitChance());
			this.holdSeconds = this.isLongHit ? LAIRS_HOLD_LONG[settings.lairsHoldLong]
											  : LAIRS_HOLD_SHORT[settings.lairsHoldShort];
			this.lastTick = -1;
			this.ChangePhase(LairsPhase.Warn);
		}
	}
	else if (this.phase === LairsPhase.Warn)
	{
		// 3... 2... 1... — one tick a second, each fired once.
		var remaining = Math.ceil((LAIRS_WARN_FRAMES - this.phaseTimer) / fps);
		if (remaining !== this.lastTick && remaining > 0)
		{
			this.lastTick = remaining;
			if (this.tickSound !== null)
				this.tickSound.Play(0.8);
		}

		if (this.phaseTimer >= LAIRS_WARN_FRAMES)
		{
			this.ChangePhase(LairsPhase.Hit);
			this.TakeTheHit();
		}
	}
	else if (this.phase === LairsPhase.Hit)
	{
		if (this.phaseTimer >= LAIRS_HIT_FRAMES)
			this.ChangePhase(LairsPhase.Hold);
	}
	else if (this.phase === LairsPhase.Hold)
	{
		if (this.phaseTimer >= this.holdSeconds * fps)
		{
			if (this.tickSound !== null)
				this.tickSound.Play(0.8);
			this.ChangePhase(LairsPhase.Release);
		}
	}
	else if (this.phase === LairsPhase.Release)
	{
		if (this.phaseTimer >= LAIRS_RELEASE_FRAMES)
		{
			this.hits += 1;
			if (this.isLongHit)
				this.longHits += 1;
			this.waitTimer = this.IntervalFrames();
			this.ChangePhase(LairsPhase.Wait);
		}
	}
};

LairsTrainer.prototype.ChangePhase = function(phase)
{
	this.phase = phase;
	this.phaseTimer = 0;
};

// Put the bottle to his nose. He takes it the moment it's called: drop whatever the
// AI had queued and hand him a popper action, sized so a longer hold leaves him drunk
// for longer. If he's committed to a finisher the slack couldn't wait out, the popper
// action simply times out — poppers only register from Walk — and he takes this one
// late; the call, the freeze and the hold all still run.
LairsTrainer.prototype.TakeTheHit = function()
{
	if (this.hitSound !== null)
		this.hitSound.Play(1.0);

	if (player === null || player.ai === null)
		return;

	player.sniffDrunkSeconds = this.holdSeconds * LAIRS_DRUNK_PER_HOLD_SECOND;
	player.ai.CancelCurrentAction();
	player.ai.QueueAction(new LairsPopperAction());
};

// ---- Drawing ---------------------------------------------------------------
// Top right: the countdown and the session tally, mirroring the LairsStats panel on
// the left. Centre screen: the call itself.
LairsTrainer.prototype.Draw = function()
{
	if (!lairsMode)
		return;

	this.DrawCounter();

	if (this.phase === LairsPhase.Warn)
		this.DrawWarning();
	else if (this.phase === LairsPhase.Hit)
		this.DrawHit();
	else if (this.phase === LairsPhase.Hold)
		this.DrawHold();
	else if (this.phase === LairsPhase.Release)
		this.DrawRelease();
};

// Shared with LairsStats: a translucent rounded plate behind the text. Laid out in
// render-canvas pixels (the space sstext draws in), converted for the 1080p transform.
function LairsPlate(x, y, width, height)
{
	var k = 1080.0 / c.height;
	ctx.save();
	var ratioTo1080p = c.height / 1080.0;
	ctx.setTransform(ratioTo1080p, 0, 0, ratioTo1080p, 0, 0);
	ctx.globalAlpha = 0.4;
	ctx.fillStyle = "#12040f";
	drawRoundRect(x * k, y * k, width * k, height * k, 5 * k, true, false);
	ctx.globalAlpha = 1.0;
	ctx.restore();
};

LairsTrainer.prototype.DrawCounter = function()
{
	var right = c.width - 9;
	var y = 8, lineHeight = 11, width = 84;

	var status = "NEXT HIT";
	var value = LairsFormatTime(this.waitTimer);
	if (this.phase === LairsPhase.Done)
	{
		status = "SESSION";
		value = "DONE";
	}
	else if (this.phase === LairsPhase.Warn)
	{
		status = "INCOMING";
		value = this.isLongHit ? "LONG" : "SHORT";
	}
	else
	{
		status = "HIT";
		value = this.isLongHit ? "LONG" : "SHORT";
	}

	LairsPlate(right - width - 5, y - 4, width + 10, 2 * lineHeight + 6);

	sstext.scale = 1.0;
	sstext.alpha = 1.0;
	sstext.textBaseline = "top";
	sstext.fontSize = 9;
	sstext.textAlign = "left";
	sstext.DrawTextWithShadow(status, right - width, y, "#e9a8d4");
	sstext.DrawTextWithShadow("HITS", right - width, y + lineHeight, "#e9a8d4");
	sstext.textAlign = "right";
	sstext.DrawTextWithShadow(value, right, y, "#FFF");
	sstext.DrawTextWithShadow(String(this.hits), right, y + lineHeight, "#FFF");
};

// Centre-screen call. Everything is anchored to the middle of the render canvas, so it
// stays centred at any aspect ratio. A dark band runs behind it: the level is pink from
// edge to edge and the call has to cut through it at a glance.
var LAIRS_BANNER_Y = -40;      // offset from the vertical centre, in render pixels
var LAIRS_BANNER_HEIGHT = 64;

LairsTrainer.prototype.DrawBand = function(alpha)
{
	var midY = c.height / 2 + LAIRS_BANNER_Y;
	var k = 1080.0 / c.height;

	ctx.save();
	var ratioTo1080p = c.height / 1080.0;
	ctx.setTransform(ratioTo1080p, 0, 0, ratioTo1080p, 0, 0);
	ctx.globalAlpha = 0.5 * alpha;
	ctx.fillStyle = "#12040f";
	ctx.fillRect(0, (midY - LAIRS_BANNER_HEIGHT / 2) * k,
				 getVirtualScreenWidth(), LAIRS_BANNER_HEIGHT * k);
	ctx.globalAlpha = 1.0;
	ctx.restore();
};

LairsTrainer.prototype.DrawBanner = function(headline, sub, headlineSize, color, alpha)
{
	var midX = c.width / 2;
	var midY = c.height / 2 + LAIRS_BANNER_Y;

	this.DrawBand(alpha);

	sstext.scale = 1.0;
	sstext.alpha = alpha;
	sstext.textAlign = "center";
	sstext.textBaseline = "middle";
	sstext.fontSize = headlineSize;
	sstext.DrawTextWithShadow(headline, midX, midY - 8, color);

	if (sub !== null)
	{
		sstext.fontSize = 10;
		sstext.DrawTextWithShadow(sub, midX, midY + 15, "#e9a8d4");
	}
	sstext.alpha = 1.0;
};

LairsTrainer.prototype.DrawWarning = function()
{
	var remaining = Math.ceil((LAIRS_WARN_FRAMES - this.phaseTimer) / fps);
	if (remaining < 1)
		remaining = 1;

	// Each number swells as its second runs out.
	var intoSecond = ((LAIRS_WARN_FRAMES - this.phaseTimer) % fps) / fps;
	var size = linearRemap(intoSecond, 1, 0, 26, 34);

	this.DrawBanner(String(remaining), "GET READY", size, "#FFF", 0.9);
};

LairsTrainer.prototype.DrawHit = function()
{
	// A hard pulse on the call itself.
	var pulse = Math.abs(Math.sin(this.phaseTimer * 0.25));
	var size = 34 + pulse * 8;
	this.DrawBanner("HIT", this.isLongHit ? "LONG — DEEP AND SLOW" : "SHORT", size, "#FFF", 1.0);
};

LairsTrainer.prototype.DrawHold = function()
{
	var held = this.phaseTimer / fps;
	var total = this.holdSeconds;
	var left = Math.max(0, Math.ceil(total - held));

	this.DrawBanner("HOLD  " + left, null, 26, "#FFF", 1.0);

	// Draining bar under the count.
	var midX = c.width / 2;
	var barY = c.height / 2 + LAIRS_BANNER_Y + 12;
	var barWidth = 130, barHeight = 5;
	var fraction = Math.max(0, 1 - held / total);

	var k = 1080.0 / c.height;
	ctx.save();
	var ratioTo1080p = c.height / 1080.0;
	ctx.setTransform(ratioTo1080p, 0, 0, ratioTo1080p, 0, 0);
	ctx.globalAlpha = 0.35;
	ctx.fillStyle = "#000000";
	drawRoundRect((midX - barWidth / 2) * k, barY * k, barWidth * k, barHeight * k, 2 * k, true, false);
	ctx.globalAlpha = 0.95;
	ctx.fillStyle = "#ff5fa8";
	drawRoundRect((midX - barWidth / 2) * k, barY * k, barWidth * fraction * k, barHeight * k,
				  2 * k, true, false);
	ctx.globalAlpha = 1.0;
	ctx.restore();
};

LairsTrainer.prototype.DrawRelease = function()
{
	var alpha = linearRemap(this.phaseTimer, 0, LAIRS_RELEASE_FRAMES, 1.0, 0.0);
	this.DrawBanner("BREATHE", null, 30, "#FFF", alpha);
};

// ---- Config menu -----------------------------------------------------------
// Opened by the main menu's "Lairs" button. Everything here persists in settings, so
// the next session starts however this one was left.
function ShowLairsMenu()
{
	var menu = new SettingsMenu();
	menu.title = "Lairs";

	var paceLabels = ["Chill (90s)", "Standard (60s)", "Intense (40s)"];
	var shortLabels = ["2s", "3s", "4s"];
	var longLabels = ["4s", "6s", "10s"];

	menu.items = [
		{ "element":"multi", "label":"Popper Trainer", "options":["Off","On"],
		  "selected":settings.lairsTrainer,
		  "onChange":function() { settings.lairsTrainer = this.selected; } },

		{ "element":"multi", "label":"Pace", "options":paceLabels,
		  "selected":settings.lairsPace,
		  "onChange":function() { settings.lairsPace = this.selected; } },

		{ "element":"multi", "label":"Short Hold", "options":shortLabels,
		  "selected":settings.lairsHoldShort,
		  "onChange":function() { settings.lairsHoldShort = this.selected; } },

		{ "element":"multi", "label":"Long Hold", "options":longLabels,
		  "selected":settings.lairsHoldLong,
		  "onChange":function() { settings.lairsHoldLong = this.selected; } },

		{ "element":"multi", "label":"Long Hits", "options":["Never","Sometimes","Often"],
		  "selected":settings.lairsLongChance,
		  "onChange":function() { settings.lairsLongChance = this.selected; } },

		{ "element":"multi", "label":"Escalation", "options":["Off","On"],
		  "selected":settings.lairsEscalate,
		  "onChange":function() { settings.lairsEscalate = this.selected; } },

		{ "element":"multi", "label":"Session", "options":["10 min","20 min","Endless"],
		  "selected":settings.lairsSession,
		  "onChange":function() { settings.lairsSession = this.selected; } },

		{ "element":"spacer", "size":16},

		{ "element":"button", "label":"Begin", "onClick":function()
			{
				saveSettings();
				DismissAllMenus();
				startLairsMode();
			}
		},

		{ "element":"button", "label":"Back", "onClick":function()
			{
				saveSettings();
				menu.startCloseTime = menu.timer;
				menu.endCloseTime = menu.timer + 60;
				menu.closing = true;
			}
		}
	];

	menu.Show();
};
