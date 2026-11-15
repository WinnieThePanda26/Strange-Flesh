/*
 * Level transitions: stepping into a transition box loads the next level, and a
 * level you come back to is the level you left (thawed, not restarted).
 *
 * The player is placed in the boxes directly: these tests are about the
 * triggers. Walking to them is the bot's job (09-bot.js).
 */
const assert = require('assert');

module.exports = [
  {
    name: 'transition: the level 0 exit leads to level 1',
    async run(t) {
      const r = await t.eval(() => {
        SFTest.newGame('level0');
        var exit = SFTest.exitTo('level1');
        var out = { hasExit: exit !== null, levelBefore: level.levelName };
        SFTest.step(5);
        out.stillLevel0 = level.levelName === 'level0';
        SFTest.teleport(exit.box.centerX(), exit.box.centerY());
        SFTest.step(1);
        out.level = level.levelName;
        out.cached = Object.keys(levelcache).sort();
        out.level0Frozen = levelcache.level0.frozen;
        out.level1Started = level.started;
        out.spawn = level.spawnPosition;
        out.player = SFTest.describe(player);
        out.inLevel = level.entities.list.indexOf(player) !== -1;
        out.settleFrames = SFTest.settle();
        for (var f = 0; f < 300; f++) { SFTest.step(1); SFTest.checkSane(); }
        out.later = SFTest.snapshot();
        return out;
      });
      assert.strictEqual(r.hasExit, true, 'level 0 has no transition box to level1');
      assert.strictEqual(r.stillLevel0, true, 'left level 0 without touching the exit');
      assert.strictEqual(r.level, 'level1', 'entering the exit box did not change level');
      assert.deepStrictEqual(r.cached, ['level0', 'level1']);
      assert.strictEqual(r.level0Frozen, true, 'level 0 was not frozen on the way out');
      assert.strictEqual(r.level1Started, true);
      assert.strictEqual(r.inLevel, true, 'the player is not in the new level');
      assert.deepStrictEqual([r.player.x, r.player.y], [r.spawn.x, r.spawn.y], 'player should start at the level 1 spawn point');
      assert.strictEqual(r.later.level, 'level1');
      assert.ok(r.later.player.health > 0);
    },
  },
  {
    name: 'transition: level 1 -> 2 -> 1 comes back to the level as it was left',
    async run(t) {
      const r = await t.eval(() => {
        var bot = SFTest.bot;
        SFTest.newGame('level1');
        var out = {};
        out.rosterAtStart = SFTest.roster().length;

        // Defeat someone and collect, so there is progress to lose.
        out.fightFrames = bot.drive(function () { bot.brawl(900); },
          function () { return enemiesDispatched >= 2 && SFTest.orbsInFlight() === 0; }, 9000);

        out.before = { roster: SFTest.roster(), dispatched: enemiesDispatched, levelTally: level.dominationCollected };

        var exit = SFTest.exitTo('level2');
        SFTest.teleport(exit.box.centerX(), exit.box.centerY());
        SFTest.step(1);
        out.away = { level: level.levelName, level1Frozen: levelcache.level1.frozen,
                     roster: SFTest.roster(levelcache.level1), dispatched: enemiesDispatched };
        SFTest.step(120);
        SFTest.checkSane();

        var wayBack = SFTest.exitTo('level1');
        out.hasWayBack = wayBack !== null;
        SFTest.teleport(wayBack.box.centerX(), wayBack.box.centerY());
        SFTest.step(1);
        out.back = { level: level.levelName, frozen: level.frozen, roster: SFTest.roster(),
                     dispatched: enemiesDispatched, levelTally: level.dominationCollected,
                     x: player.posX, y: player.posY, exitX: exit.box.centerX(), exitY: exit.box.centerY() };

        // Standing where he left (inside the exit box) must not bounce him out again.
        for (var f = 0; f < 300; f++) { SFTest.step(1); SFTest.checkSane(); }
        out.later = SFTest.snapshot();
        return out;
      });

      assert.notStrictEqual(r.fightFrames, -1, 'could not defeat anyone on level 1');
      assert.ok(r.before.roster.length < r.rosterAtStart, 'nobody was removed from the level by the fight');

      assert.strictEqual(r.away.level, 'level2');
      assert.strictEqual(r.away.level1Frozen, true);
      assert.strictEqual(r.away.dispatched, r.before.dispatched, 'the meter changed on the way to level 2');

      assert.strictEqual(r.hasWayBack, true, 'level 2 has no transition box back to level1');
      assert.strictEqual(r.back.level, 'level1');
      assert.strictEqual(r.back.frozen, false, 'level 1 is still frozen after coming back');
      assert.deepStrictEqual(r.back.roster, r.away.roster, 'level 1 changed while the player was away');
      assert.strictEqual(r.back.roster.length, r.before.roster.length, 'defeated enemies came back (or others vanished)');
      assert.strictEqual(r.back.dispatched, r.before.dispatched);
      assert.strictEqual(r.back.levelTally, r.before.levelTally, "level 1's own orb tally");
      assert.deepStrictEqual([r.back.x, r.back.y], [r.back.exitX, r.back.exitY], 'player should return to where he left');

      assert.strictEqual(r.later.level, 'level1', 'the player was thrown back out of level 1');
      t.log(`${r.before.roster.length} of ${r.rosterAtStart} entities left on level 1, preserved across the round trip`);
    },
  },
];
