/*
 * Arcade mode (Arcade.js): waves, scoring, the best score, and getting in and
 * out of the mode without leaving anything behind for the story game.
 *
 * SFTest.newArcade() starts a run the way the main menu's "Arcade" button does.
 * The helpers below are run inside the page; each test passes the ones it needs
 * in as source text (functions do not survive the trip to the page otherwise).
 */
const assert = require('assert');

// In-page helpers, installed as window.ArcadeTest by install().
function arcadeHelpers() {
  var A = window.ArcadeTest = {};
  var bot = SFTest.bot;

  // Enemies the director has sent in that are still fighting.
  A.hostile = function () {
    var found = [];
    for (var i = 0; i < arcadeDirector.enemies.length; i++) {
      var e = arcadeDirector.enemies[i].entity;
      if (e.alliance === 2 && !ArcadeIsBeaten(e)) found.push(e);
    }
    return found;
  };

  A.nearest = function () {
    var all = A.hostile(), best = null, bestD = Number.MAX_VALUE;
    for (var i = 0; i < all.length; i++) {
      var d = Math.abs(all[i].posX - player.posX) + 2 * Math.abs(all[i].posY - player.posY);
      if (d < bestD) { bestD = d; best = all[i]; }
    }
    return best;
  };

  // Walk up to an enemy and punch him, like bot.fight(), but from whichever side
  // of him has the room: bot.approach() stays on the side it is on, and next to
  // a wall that side can be the wall itself.
  A.fight = function (target) {
    var side = (player.posX >= target.posX) ? 1 : -1;
    if (Math.abs(target.posX + side * 195) > ARCADE_HALF_WIDTH - 60) side = -side;
    var dx = (player.posX - target.posX) * side;
    var inX = dx >= 120 && dx <= 270;
    var inY = Math.abs(target.posY - player.posY) <= 22;
    if (!inX || !inY) { bot.moveToward(target.posX + side * 195, target.posY, 60, 18); return; }
    if (player.facing !== -side) { bot.hold(side > 0 ? 'left' : 'right'); return; }
    if (IsAttackable(target.state)) bot.tap('punch', 3, 9);
  };

  // One frame of a bot that plays the arena: punch the nearest enemy, otherwise
  // pick up what is lying around, otherwise wait in the middle.
  //
  // Two bodies can jam: the bot pushing up at an enemy who is against the back
  // wall, and he pushing down at the bot, neither lined up to land a punch. A
  // person steps aside; so does the bot, when it has hurt nobody for a while.
  var stall = { target: null, health: 0, since: 0, stepAsideUntil: 0 };
  A.brawl = function () {
    var target = A.nearest();
    if (target !== null) {
      if (target !== stall.target || target.health < stall.health || SFTest.frame < stall.since) {
        stall.target = target;
        stall.health = target.health;
        stall.since = SFTest.frame;
      }
      if (SFTest.frame - stall.since > 240) {
        stall.since = SFTest.frame;
        stall.stepAsideUntil = SFTest.frame + 45;
      }
      if (SFTest.frame < stall.stepAsideUntil) {
        bot.hold(player.posX > 0 ? 'left' : 'right');
        bot.hold(player.posY > -60 ? 'up' : 'down');
        return;
      }
      // Somebody hovering out of a punch's reach: get under him and jump-kick.
      if (target.posZ > 150 && bot.approach(target, 60, 230)) {
        bot.tap('jump', 14, 30);
        if (player.posZ > 60) bot.tap('punch', 3, 9);
        return;
      }
      A.fight(target);
      return;
    }
    var orbs = SFTest.orbs();
    for (var i = 0; i < orbs.length; i++) {
      if (orbs[i].collected || orbs[i].timer <= 60) continue;
      if (orbs[i].kind === ORB_HEALTH && player.health >= player.maxHealth) continue;
      if (orbs[i].kind === ORB_POPPERS && poppers >= maxPoppers) continue;
      bot.moveToward(orbs[i].posX, orbs[i].posY, 10, 10);
      return;
    }
    bot.moveToward(0, -60, 40, 20);
  };

  // Blow smoke at an enemy until he turns. Blown smoke lands 420-780 ahead, so
  // stand 600 off, on whichever side of him has the room.
  A.smoke = function (target) {
    var side = (player.posX >= target.posX) ? 1 : -1;
    if (Math.abs(target.posX + side * 600) > ARCADE_HALF_WIDTH - 120) side = -side;
    if (!bot.moveToward(target.posX + side * 600, target.posY, 90, 20)) return;
    if (player.facing !== -side) { bot.hold(side > 0 ? 'left' : 'right'); return; }
    bot.tap('smoke', 50, 40);
  };

  // Lose the last life for real: a hit that takes all his health, then the
  // knockout plays out and updateAll ends the run. (A hit does nothing while he
  // is already down or dashing, so keep offering it.) Returns the frames it
  // took for the results screen to come up, or -1.
  A.loseLastLife = function () {
    lives = 1;
    var attack = new Attack();
    attack.damageDealt = 100000;
    attack.alliance = 2;
    return SFTest.stepUntil(function () {
      if (menuStack.length > 0) return true;
      if (player.health > 0 && !IsDeadOrDying(player.state)) {
        player.invincibilityFrames = 0;
        player.Hit(attack, false);
      }
      return false;
    }, 1500);
  };

  // Press a menu button for a couple of frames, then let the menu see it released.
  A.menuTap = function (button) {
    SFTest.tap(button, 2);
    SFTest.step(2);
  };

  // The label of the menu item under the cursor (null when no menu is up).
  A.menuSelection = function () {
    if (menuStack.length === 0) return null;
    var menu = menuStack[menuStack.length - 1];
    return (menu.items && menu.items[menu.selectedItem]) ? menu.items[menu.selectedItem].label : null;
  };

  // Move the cursor of the menu on top to the item with this label and press it.
  A.menuChoose = function (label) {
    SFTest.step(25);                               // menus ignore input for their first 20 frames
    for (var i = 0; i < 12 && A.menuSelection() !== label; i++) A.menuTap('down');
    if (A.menuSelection() !== label) throw new Error("no '" + label + "' item in the menu on top");
    A.menuTap('punch');
  };

  // Everything a story game reads that an arcade run could have left changed.
  A.storyState = function () {
    var overlayNames = [], menuNames = [];
    for (var i = 0; i < overlays.length; i++) overlayNames.push(SFTest.typeName(overlays[i]));
    for (var j = 0; j < menuStack.length; j++) menuNames.push(SFTest.typeName(menuStack[j]));
    var enemies = 0, orbs = 0;
    for (var k = 0; k < level.entities.list.length; k++) {
      if (level.entities.list[k].alliance === 2) enemies += 1;
      if (level.entities.list[k] instanceof CollectableOrb) orbs += 1;
    }
    return {
      arcadeMode: arcadeMode, arcadeDirector: arcadeDirector === null ? null : 'set',
      lairsMode: lairsMode, lairsDirector: lairsDirector === null ? null : 'set',
      level: level.levelName, roster: SFTest.roster(), enemies: enemies, orbsOnGround: orbs,
      effects: level.entities.effects.length, levelsCached: Object.keys(levelcache).sort(),
      activeAttacks: activeAttacks.length, orbsInFlight: hud.orbs.length,
      suspendableSounds: suspendableSounds.length,
      lives: lives, poppers: poppers, enemiesDispatched: enemiesDispatched,
      enemiesCorrupted: enemiesCorrupted, totalEnemies: totalEnemies,
      neverSaved: neverSaved, gameOverResumeSaved: gameOverResumeSaved, continuesUsed: continuesUsed,
      playerFirstSpawn: playerFirstSpawn, startupTimer: startupTimer, respawnCounter: respawnCounter,
      entityFrameskip: entityFrameskip, entityFrameskipCounter: entityFrameskipCounter,
      playerStack: playerStack.length, playerType: SFTest.typeName(player),
      playerHealth: player.health, playerSexMeter: player.sexMeter, playerState: GetStateName(player.state),
      playerUsesGlobalController: player.controller === controller,
      hudEnabled: hud.enabled, enemyInfoEnabled: enemyinfo.enabled, hudMessage: hud.hudMessage.join(';'),
      overlays: overlayNames, menus: menuNames,
      cameraRatchet: camera.enableRatchet,
      musicTrack: GlobalMusic.selectedTrack, musicPlaying: GlobalMusic.playing,
      savedGame: localStorage.getItem('SavedGame'),
    };
  };
}

const install = (t) => t.eval(`(${arcadeHelpers.toString()})()`);

// Hold right and tap punch through level 1, returning a digest for every frame
// (the same run 01-determinism.js uses).
function playLevel1(seed, frames) {
  SFTest.newGame('level1', { seed: seed, settle: false });
  var digests = [];
  SFTest.press('right');
  for (var f = 0; f < frames; f++) {
    if (f % 20 === 0) SFTest.press('punch');
    if (f % 20 === 4) SFTest.release('punch');
    SFTest.step(1);
    digests.push(SFTest.digest());
  }
  SFTest.releaseAll();
  return digests;
}

// Waves the bot has to clear. Six reaches every tier of the roster. For a longer
// soak: ARCADE_BOT_WAVES=14 node tests/run.js --filter "arcade: a bot" -v
const BOT_WAVES = Number(process.env.ARCADE_BOT_WAVES) || 6;

function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

module.exports = [
  {
    name: 'arcade: wave 1 walks in from off-screen and wave 2 follows once it is cleared',
    async run(t) {
      await install(t);
      const r = await t.eval(() => {
        var A = ArcadeTest;
        SFTest.newArcade({ settle: false });
        var d = arcadeDirector;
        var out = {
          mode: arcadeMode, level: level.levelName, waveAtStart: d.wave, enemiesAtStart: SFTest.enemies().length,
          lives: lives, spawns: [], wave2WhileWave1Alive: false,
        };

        // Watch every enemy the director sends in: where it was when it appeared.
        var seen = [];
        function watch() {
          for (var i = 0; i < d.enemies.length; i++) {
            var e = d.enemies[i].entity;
            if (seen.indexOf(e) !== -1) continue;
            seen.push(e);
            out.spawns.push({
              type: SFTest.typeName(e), wave: d.wave, x: Math.round(e.posX),
              onScreen: camera.boundingRect.PointIntersect(e.posX, e.posY),
              inLevel: level.entities.list.indexOf(e) !== -1,
            });
          }
        }

        out.wave1Frames = SFTest.stepUntil(function () { watch(); return d.wave === 1; }, 600);
        out.settled = SFTest.settle();

        // Fight wave 1. Wave 2 must not begin while any of wave 1 still stands.
        var wave1 = null, clearedAt = -1;
        out.wave2Frames = SFTest.bot.drive(function () {
          watch();
          player.health = player.maxHealth;                 // this test is about the waves, not survival
          if (wave1 === null && d.queue.length === 0) wave1 = seen.slice();
          if (clearedAt === -1 && !d.waveActive && d.wave === 1) { clearedAt = SFTest.frame; out.scoreAtClear = d.score; }
          A.brawl();
        }, function () {
          if (d.wave >= 2 && wave1 !== null) {
            for (var i = 0; i < wave1.length; i++) if (!ArcadeIsBeaten(wave1[i])) out.wave2WhileWave1Alive = true;
          }
          return d.wave >= 2 && d.enemies.length > 0;
        }, 9000);
        watch();

        out.wave1Size = wave1 === null ? -1 : wave1.length;
        out.intermission = clearedAt === -1 ? -1 : SFTest.frame - clearedAt;
        out.knockouts = d.knockouts;
        out.corruptions = d.corruptions;
        out.wave = d.wave;
        out.score = d.score;
        out.bonus = ARCADE_WAVE_BONUS;
        out.intermissionSetting = ARCADE_INTERMISSION;
        out.healthOrbs = SFTest.orbs(ORB_HEALTH).length;
        SFTest.checkSane();
        return out;
      });

      assert.strictEqual(r.mode, true, 'arcadeMode was not set');
      assert.strictEqual(r.level, 'arcade');
      assert.strictEqual(r.waveAtStart, 0, 'a wave was already under way on the first frame');
      assert.strictEqual(r.enemiesAtStart, 0, 'the arena did not start empty');
      assert.notStrictEqual(r.wave1Frames, -1, 'wave 1 never started');
      assert.notStrictEqual(r.wave2Frames, -1,
        `wave 2 never started (wave ${r.wave}, ${r.knockouts} knockouts, ${r.corruptions} corruptions)`);
      assert.ok(r.wave1Size >= 1, 'wave 1 had nobody in it');
      assert.strictEqual(r.knockouts + r.corruptions, r.wave1Size, 'every enemy of wave 1 is counted once');
      assert.strictEqual(r.wave2WhileWave1Alive, false, 'wave 2 started while a wave 1 enemy was still fighting');
      assert.ok(r.intermission >= r.intermissionSetting, `wave 2 came ${r.intermission} frames after the clear`);
      assert.ok(r.scoreAtClear >= r.bonus, 'no bonus for clearing wave 1');
      assert.ok(r.healthOrbs > 0, 'clearing the wave dropped no health orbs');
      assert.ok(r.spawns.length > r.wave1Size, 'nobody from wave 2 was seen');
      for (const s of r.spawns) {
        assert.strictEqual(s.inLevel, true, `a ${s.type} was tracked but never added to the level`);
        assert.strictEqual(s.onScreen, false, `a wave ${s.wave} ${s.type} appeared on screen at x=${s.x}`);
      }
      t.log(`wave 1: ${r.wave1Size} enemies, wave 2 began ${r.intermission} frames after the clear; ` +
        `spawned ${r.spawns.map((s) => s.type + '@' + s.x).join(', ')}`);
    },
  },

  {
    name: 'arcade: the score goes up for knockouts and for corruptions',
    async run(t) {
      await install(t);
      const r = await t.eval(() => {
        var A = ArcadeTest;
        SFTest.newArcade();
        var d = arcadeDirector;
        var out = { events: [] };

        // Every change of the tally, with what it did to the score.
        var last = { knockouts: 0, corruptions: 0, score: 0 };
        function watch() {
          player.health = player.maxHealth;                 // this test is about the score, not survival
          if (d.knockouts === last.knockouts && d.corruptions === last.corruptions) return;
          out.events.push({ knockouts: d.knockouts - last.knockouts, corruptions: d.corruptions - last.corruptions,
            points: d.score - last.score, frame: SFTest.frame });
          last = { knockouts: d.knockouts, corruptions: d.corruptions, score: d.score };
        }

        SFTest.stepUntil(function () { return d.wave === 1; }, 600);
        out.costs = d.queue.map(ArcadeCostOf);

        // Fists first: two knockouts.
        out.knockoutFrames = SFTest.bot.drive(function () { watch(); A.brawl(); },
          function () { return d.knockouts >= 2; }, 6000);

        // Then smoke. For this the rest of the wave is taken out of the fight: the
        // one to smoke stands still (no AI) and the others stand at the far end of
        // the arena, so the bot is not chased and the smoke reaches nobody else.
        // What is under test is the scoring, not how to smoke a crowd.
        var victim = null, parked = [];
        out.corruptionFrames = SFTest.bot.drive(function () {
          watch();
          var all = A.hostile();
          for (var i = 0; i < all.length; i++) {
            var e = all[i];
            if (e.newlySpawned) continue;                   // still on his way in
            e.ai = null;
            if (victim === null && e.health > 0 && e.state === States.Walk) victim = e;
            if (e !== victim && victim !== null && parked.indexOf(e) === -1) {
              parked.push(e);
              e.posX = (victim.posX > 0 ? -1 : 1) * (ARCADE_HALF_WIDTH - 150);
            }
          }
          if (victim !== null && !ArcadeIsBeaten(victim)) A.smoke(victim);
        }, function () { return d.corruptions >= 1; }, 6000);
        watch();

        out.victim = victim === null ? null : GetStateName(victim.state);
        out.perCost = ARCADE_POINTS_PER_COST;
        out.switchMultiplier = ARCADE_SWITCH_MULTIPLIER;
        return out;
      });

      assert.notStrictEqual(r.knockoutFrames, -1, 'the bot never knocked two enemies out');
      assert.notStrictEqual(r.corruptionFrames, -1, `the bot never corrupted anybody (its victim is ${r.victim})`);
      // Wave 1 is all cost 1 (Joe1), so the points are exact.
      assert.ok(r.costs.every((c) => c === 1), 'wave 1 is expected to be all cost-1 enemies');

      // Replay the rule over what happened: base points for a defeat, times the
      // switch bonus when it is the other style from the one before.
      const base = r.perCost, switched = r.perCost * r.switchMultiplier;
      let lastStyle = null, plainKnockout = false, bonusCorruption = false;
      for (const e of r.events) {
        if (e.knockouts + e.corruptions !== 1) {
          // Two went down on the same frame: only the range can be checked.
          const n = e.knockouts + e.corruptions;
          assert.ok(e.points >= base * n && e.points <= switched * n, `${n} defeats on frame ${e.frame} scored ${e.points}`);
          lastStyle = e.corruptions === 0 ? 'knockout' : (e.knockouts === 0 ? 'corruption' : null);
          continue;
        }
        const style = e.knockouts ? 'knockout' : 'corruption';
        const expected = (lastStyle !== null && lastStyle !== style) ? switched : base;
        assert.strictEqual(e.points, expected, `a ${style} after ${lastStyle || 'nothing'} on frame ${e.frame}`);
        if (style === 'knockout' && expected === base) plainKnockout = true;
        if (style === 'corruption' && expected === switched) bonusCorruption = true;
        lastStyle = style;
      }
      assert.ok(plainKnockout, 'no knockout was seen scoring the base points');
      assert.ok(bonusCorruption, 'no corruption was seen scoring the switch bonus after a knockout');
      t.log(r.events.map((e) => (e.knockouts ? 'knockout' : 'corruption') + ' +' + e.points).join(', '));
    },
  },

  {
    name: 'arcade: the best score persists, and the story save is left alone',
    async run(t) {
      await install(t);
      const r = await t.eval(() => {
        var A = ArcadeTest;
        var out = {};

        // A story save to keep an eye on.
        SFTest.newGame('level1');
        saveGame();
        out.saveBefore = localStorage.getItem('SavedGame');
        out.storedBeforeAnyRun = localStorage.getItem(ARCADE_BEST_KEY);

        // First run: score something, then lose.
        SFTest.newArcade();
        var d = arcadeDirector;
        out.bestAtStart = d.best;
        out.storedAtStart = localStorage.getItem(ARCADE_BEST_KEY);
        SFTest.bot.drive(function () { player.health = player.maxHealth; A.brawl(); },
          function () { return d.score > 0; }, 4000);
        saveGame();                                          // must do nothing in arcade
        out.saveDuringRun = localStorage.getItem('SavedGame');
        out.firstScore = d.score;
        out.endFrames = A.loseLastLife();
        out.menuAfterLoss = menuStack.length ? SFTest.typeName(menuStack[menuStack.length - 1]) : null;
        out.menuTitle = menuStack.length ? menuStack[menuStack.length - 1].title : null;
        out.storedAfterFirst = localStorage.getItem(ARCADE_BEST_KEY);

        // Retry from the results screen: a new run that knows the best.
        A.menuChoose('Retry');
        out.afterRetry = {
          mode: arcadeMode, sameDirector: arcadeDirector === d, menus: menuStack.length,
          best: arcadeDirector.best, score: arcadeDirector.score, wave: arcadeDirector.wave,
          lives: lives, enemies: SFTest.enemies().length, attacks: activeAttacks.length,
        };

        // Second run: lose with nothing scored. The best must stand.
        SFTest.settle();
        A.loseLastLife();
        out.storedAfterSecond = localStorage.getItem(ARCADE_BEST_KEY);
        out.readBack = loadArcadeBest();

        // Back to the title from the results screen.
        A.menuChoose('Exit to Title');
        out.afterExit = { mode: arcadeMode, level: level.levelName,
          topMenu: menuStack.length ? SFTest.typeName(menuStack[menuStack.length - 1]) : null };
        out.saveAfter = localStorage.getItem('SavedGame');
        return out;
      });

      assert.strictEqual(r.storedBeforeAnyRun, null, 'a best score was there before any run');
      assert.strictEqual(r.bestAtStart, 0);
      assert.strictEqual(r.storedAtStart, null, 'a best score was stored before anything was scored');
      assert.ok(r.firstScore > 0, 'the bot scored nothing');
      assert.notStrictEqual(r.endFrames, -1, 'losing the last life never ended the run');
      assert.strictEqual(r.menuAfterLoss, 'SettingsMenu', 'the results screen');
      assert.strictEqual(r.menuTitle, 'Run Over');
      assert.strictEqual(JSON.parse(r.storedAfterFirst).score, r.firstScore, 'the best score in localStorage');
      assert.deepStrictEqual(r.afterRetry, {
        mode: true, sameDirector: false, menus: 0, best: r.firstScore, score: 0, wave: 0,
        lives: r.afterRetry.lives, enemies: 0, attacks: 0,
      }, 'Retry starts a fresh run that shows the best score');
      assert.ok(r.afterRetry.lives > 0);
      assert.strictEqual(r.storedAfterSecond, r.storedAfterFirst, 'a worse run overwrote the best score');
      assert.strictEqual(r.readBack.score, r.firstScore);
      assert.deepStrictEqual(r.afterExit, { mode: false, level: 'level0', topMenu: 'MainMenu' },
        'Exit to Title goes back to the main menu');
      assert.ok(r.saveBefore && r.saveBefore.length > 1000, 'the story save was not written to begin with');
      assert.strictEqual(r.saveDuringRun, r.saveBefore, 'saveGame() wrote the story save during an arcade run');
      assert.strictEqual(r.saveAfter, r.saveBefore, 'the story save changed');
      t.log(`best ${r.firstScore}, kept through a retry and a worse run`);
    },
  },

  {
    name: 'arcade: after quitting a run, a story game starts clean',
    timeout: 240000,
    async run(t) {
      await install(t);
      const FRAMES = 1500;

      // What a story game looks like at the title, and how level 1 plays, before
      // arcade has ever run in this page.
      const before = await t.eval(() => {
        SFTest.newGame('arena');
        resetGame();
        return ArcadeTest.storyState();
      });
      const fresh = await t.eval(playLevel1, 1234, FRAMES);

      // Play into wave 2, so there are enemies, attacks and orbs about, then quit
      // the way a player does: pause, Exit, Yes.
      const quit = await t.eval(() => {
        var A = ArcadeTest;
        SFTest.newGame('arena');
        resetGame();
        SFTest.newArcade();
        var d = arcadeDirector;
        var frames = SFTest.bot.drive(function () { player.health = player.maxHealth; A.brawl(); },
          function () { return d.wave >= 2 && A.hostile().length >= 2 && activeAttacks.length > 0; }, 12000);
        var out = {
          frames: frames, wave: d.wave, score: d.score, hostile: A.hostile().length,
          attacks: activeAttacks.length, orbs: SFTest.orbs().length + SFTest.orbsInFlight(),
          overlay: overlays.indexOf(d) !== -1, music: GlobalMusic.selectedTrack,
        };
        SFTest.tap('start', 2);
        SFTest.step(2);
        out.pauseMenu = menuStack.length ? menuStack[menuStack.length - 1].title : null;
        A.menuChoose('Exit');
        out.confirmMenu = menuStack.length ? menuStack[menuStack.length - 1].title : null;
        SFTest.step(25);
        A.menuTap('up');
        out.confirmSelection = A.menuSelection();
        A.menuTap('punch');
        out.state = A.storyState();
        out.best = loadArcadeBest().score;
        return out;
      });

      assert.notStrictEqual(quit.frames, -1, `the run never got busy (wave ${quit.wave}, ${quit.hostile} enemies)`);
      assert.strictEqual(quit.overlay, true, 'the director was not on the overlay list during the run');
      assert.strictEqual(quit.music, 'level4');
      assert.strictEqual(quit.pauseMenu, 'Game Paused');
      assert.strictEqual(quit.confirmMenu, 'Exit to Title?');
      assert.strictEqual(quit.confirmSelection, 'Yes');
      assert.deepStrictEqual(quit.state, before, 'the title screen after an arcade run differs from a fresh one');
      assert.strictEqual(quit.state.arcadeMode, false);
      assert.strictEqual(quit.state.musicTrack, 'title');
      assert.strictEqual(quit.best, quit.score, 'quitting mid-run should still bank the score');

      // And the story plays out exactly as it would have.
      const after = await t.eval(playLevel1, 1234, FRAMES);
      const diff = firstDifference(fresh, after);
      assert.strictEqual(diff, -1, `after an arcade run, level 1 diverged from a fresh game at frame ${diff}`);
      t.log(`quit in wave ${quit.wave} with ${quit.hostile} enemies, ${quit.attacks} attacks and ${quit.orbs} orbs about`);
    },
  },

  {
    // A ColombianRescue only moves by leaping, and once on screen it only dodges.
    // It used to stand at the wall it came in by for the rest of the run: held
    // there by the walk-in order (which it cannot obey), or too far from the
    // player to notice him, or dodging into the wall.
    name: 'arcade: a ColombianRescue comes in off the wall and stays off it',
    async run(t) {
      await install(t);
      const r = await t.eval(() => {
        var out = [];
        // The player in the middle, toward one side, and in a corner.
        [0, 1000, -1250].forEach(function (playerX) {
          SFTest.newArcade();
          var d = arcadeDirector;
          SFTest.stepUntil(function () { return d.wave === 1; }, 600);
          d.queue = ['ColombianRescue', 'ColombianRescue', 'ColombianRescue'];

          var row = { playerX: playerX, samples: 0, nearWall: 0, hits: 0, outsideLate: 0, count: 0 };
          for (var f = 0; f < 3000; f++) {
            if (player.health < player.maxHealth) row.hits += 1;
            player.health = player.maxHealth;               // he just stands there; this is about where they go
            player.posX = playerX;
            player.velX = 0;
            SFTest.step(1);
            if (f < 600) continue;                          // give them ten seconds to arrive
            row.count = d.enemies.length;
            for (var i = 0; i < d.enemies.length; i++) {
              var e = d.enemies[i].entity;
              row.samples += 1;
              if (Math.abs(e.posX) > ARCADE_HALF_WIDTH - e.collisionRadius - 200) row.nearWall += 1;
              if (e.newlySpawned || Math.abs(e.posX) > ARCADE_HALF_WIDTH) row.outsideLate += 1;
            }
          }
          SFTest.checkSane();
          out.push(row);
        });
        return out;
      });

      for (const row of r) {
        const where = `with the player at x=${row.playerX}`;
        assert.strictEqual(row.count, 3, `three of them should be in the arena ${where}`);
        assert.strictEqual(row.outsideLate, 0, `one was still outside the walls after ten seconds ${where}`);
        const share = row.nearWall / row.samples;
        assert.ok(share < 0.4, `they spent ${Math.round(share * 100)}% of the time against a wall ${where}`);
        assert.ok(row.hits > 0, `they never hit a player standing still ${where}`);
      }
      t.log(r.map((row) => `player at ${row.playerX}: ${Math.round(100 * row.nearWall / row.samples)}% near a wall, ` +
        `${row.hits} hits`).join('; '));
    },
  },

  {
    name: 'arcade: a drop nobody picks up blinks and goes; in the story it stays',
    async run(t) {
      await install(t);
      const r = await t.eval(() => {
        // A popper with a full stash: nothing collects it.
        function watchPopper(frames) {
          poppers = maxPoppers;
          var orb = new CollectableOrb(ORB_POPPERS);
          orb.posX = player.posX + 500;
          orb.posY = player.posY;
          level.entities.AddEntity(orb);
          var out = { goneAt: -1, dimmedAt: -1, alphaBeforeBlink: null };
          for (var f = 1; f <= frames; f++) {
            player.health = player.maxHealth;
            poppers = maxPoppers;
            SFTest.step(1);
            if (out.dimmedAt === -1 && orb.alpha < 1) out.dimmedAt = f;
            if (out.dimmedAt === -1) out.alphaBeforeBlink = orb.alpha;
            if (out.goneAt === -1 && level.entities.list.indexOf(orb) === -1) out.goneAt = f;
          }
          out.collected = orb.collected;
          out.stash = poppers;
          return out;
        }

        var out = { lifetime: ARCADE_DROP_LIFETIME, blink: ARCADE_DROP_BLINK };

        SFTest.newArcade({ settle: false });
        arcadeDirector.intermission = 1000000;              // no waves: nobody to knock the orb about
        SFTest.settle();
        out.arcade = watchPopper(ARCADE_DROP_LIFETIME + 120);

        SFTest.newGame('arena');
        out.story = watchPopper(ARCADE_DROP_LIFETIME + 120);
        return out;
      });

      assert.strictEqual(r.arcade.collected, false, 'the popper was picked up; the test needs it left alone');
      assert.strictEqual(r.arcade.alphaBeforeBlink, 1, 'the orb was dimmed before its time');
      assert.ok(r.arcade.dimmedAt >= r.lifetime - r.blink - 2 && r.arcade.dimmedAt <= r.lifetime - r.blink + 12,
        `it started to blink at frame ${r.arcade.dimmedAt}, expected about ${r.lifetime - r.blink}`);
      assert.ok(r.arcade.goneAt >= r.lifetime && r.arcade.goneAt <= r.lifetime + 5,
        `it went at frame ${r.arcade.goneAt}, expected just after ${r.lifetime}`);
      assert.strictEqual(r.story.goneAt, -1, 'a drop expired in a story level');
      assert.strictEqual(r.story.dimmedAt, -1, 'a drop blinked in a story level');
      t.log(`blinks from frame ${r.arcade.dimmedAt}, gone at ${r.arcade.goneAt}`);
    },
  },

  {
    name: `arcade: a bot clears the first ${BOT_WAVES} waves without errors`,
    timeout: 240000,
    async run(t) {
      await install(t);
      const r = await t.eval((targetWave) => {
        var A = ArcadeTest;
        SFTest.newArcade();
        var d = arcadeDirector;
        var out = { deaths: 0, types: {}, outside: 0, stuckAt: null };
        var lastLives = lives, lastProgress = SFTest.frame, lastBeaten = 0;

        out.frames = SFTest.bot.drive(function () {
          // Like the level bot, it is not trying to play well: keep it from
          // running out of lives and count the deaths instead.
          if (lives < lastLives) out.deaths += lastLives - lives;
          if (lives < 2) lives = 2;
          lastLives = lives;

          for (var i = 0; i < d.enemies.length; i++) {
            var e = d.enemies[i].entity;
            out.types[SFTest.typeName(e)] = true;
            // Nobody may be left outside the walls once he has arrived.
            if (!e.newlySpawned && Math.abs(e.posX) > ARCADE_HALF_WIDTH - e.collisionRadius + 2) out.outside += 1;
            if (e.posY < ARCADE_BACK_Y || e.posY > ARCADE_FRONT_Y) out.outside += 1;
          }
          if (Math.abs(player.posX) > ARCADE_HALF_WIDTH) out.outside += 1;

          var beaten = d.knockouts + d.corruptions;
          if (beaten !== lastBeaten) { lastBeaten = beaten; lastProgress = SFTest.frame; }
          if (SFTest.frame % 30 === 0) SFTest.checkSane();
          A.brawl();
        }, function () {
          if (SFTest.frame - lastProgress > 3600) {
            out.stuckAt = { wave: d.wave, hostile: A.hostile().map(SFTest.describe), queue: d.queue.slice(), player: SFTest.describe(player) };
            return true;
          }
          return d.wave >= targetWave || menuStack.length > 0;
        }, 60000);

        out.wave = d.wave;
        out.score = d.score;
        out.knockouts = d.knockouts;
        out.corruptions = d.corruptions;
        out.menu = menuStack.length ? SFTest.typeName(menuStack[menuStack.length - 1]) : null;
        out.types = Object.keys(out.types).sort();
        return out;
      }, BOT_WAVES + 1);

      assert.strictEqual(r.stuckAt, null, 'nobody was beaten for a minute: ' + JSON.stringify(r.stuckAt));
      assert.strictEqual(r.menu, null, `a ${r.menu} screen opened during the run`);
      assert.notStrictEqual(r.frames, -1, `the bot only reached wave ${r.wave} in 60000 frames`);
      assert.ok(r.wave > BOT_WAVES, `the bot only reached wave ${r.wave}`);
      assert.strictEqual(r.outside, 0, 'somebody was outside the arena walls');
      assert.ok(r.score > 0);
      t.log(`reached wave ${r.wave} in ${r.frames} frames (${Math.round(r.frames / 60)}s), score ${r.score}, ` +
        `${r.knockouts} knockouts, ${r.deaths} deaths; met ${r.types.join(', ')}`);
    },
  },
];
