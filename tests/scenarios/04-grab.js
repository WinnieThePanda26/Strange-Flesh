/*
 * Grab and capture: the bartender grabs an enemy, carries it, and lets it go.
 */
const assert = require('assert');

module.exports = {
  name: 'grab: a Joe0 is captured, carried and released unharmed',
  async run(t) {
    const r = await t.eval(() => {
      SFTest.newGame('arena');
      var bot = SFTest.bot;
      var joe = SFTest.spawn('Joe0', 400, 0);
      var out = { maxHealth: joe.maxHealth };

      // Walk up and grab.
      out.grabFrames = bot.drive(function () { if (bot.approach(joe)) bot.tap('grab', 3, 30); },
        function () { return player.captive === joe; }, 600);
      out.captiveState = GetStateName(joe.state);
      out.isCaptive = IsCaptive(joe.state);
      out.aiBusy = joe.ai !== null && joe.ai.actionQueue ? joe.ai.actionQueue.length : 0;

      // Let the grab animation finish, then carry him to the left.
      SFTest.step(30);
      out.playerStateHolding = GetStateName(player.state);
      var startX = player.posX;
      bot.drive(function () { bot.hold('left'); }, function () { return false; }, 90);
      out.carried = startX - player.posX;
      out.gapWhileCarried = Math.abs(joe.posX - player.posX);
      out.stillCaptive = player.captive === joe && IsCaptive(joe.state);

      // Grab again to let go.
      out.releaseFrames = bot.drive(function () { bot.tap('grab', 3, 30); },
        function () { return player.captive === null; }, 300);
      out.recoverFrames = SFTest.stepUntil(function () { return joe.state === States.Walk; }, 300);
      out.joe = SFTest.describe(joe);
      out.inLevel = level.entities.list.indexOf(joe) !== -1;
      out.player = SFTest.describe(player);
      return out;
    });

    assert.notStrictEqual(r.grabFrames, -1, 'the grab never connected');
    assert.strictEqual(r.captiveState, 'Captive');
    assert.strictEqual(r.isCaptive, true);
    assert.strictEqual(r.playerStateHolding, 'Drag', 'the player should be dragging his captive');
    assert.ok(r.carried > 100, `the player barely moved while carrying (${Math.round(r.carried)})`);
    assert.ok(r.gapWhileCarried < 200, `the captive was left behind (${Math.round(r.gapWhileCarried)} away)`);
    assert.strictEqual(r.stillCaptive, true, 'the captive got loose while being carried');
    assert.notStrictEqual(r.releaseFrames, -1, 'pressing grab again did not release the captive');
    assert.notStrictEqual(r.recoverFrames, -1, `the released Joe never got back to Walk (${r.joe.state})`);
    assert.strictEqual(r.joe.health, r.maxHealth, 'being grabbed and released should not cost health');
    assert.strictEqual(r.inLevel, true, 'the released Joe vanished from the level');
    assert.strictEqual(r.player.state, 'Walk');
  },
};
