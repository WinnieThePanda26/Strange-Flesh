/*
 * The two ways to beat an enemy: knock him out (domination) or smoke him until
 * he turns (corruption). Each leaves its own kind of orb, and the meters move
 * only when those orbs reach the HUD.
 */
const assert = require('assert');

// In-page: play out one defeat. `corrupt` picks smoke over fists. Returns what
// dropped and what the counters say once every orb has landed.
function defeatJoe0(corrupt) {
  SFTest.newGame('arena');
  var bot = SFTest.bot;
  var joe = SFTest.spawn('Joe0', 400, 0);
  var out = { orbsOnDeath: joe.orbsOnDeath, sawCorruptState: false, dominateOrbs: 0, corruptOrbs: 0 };

  function watch() {
    if (IsCorrupt(joe.state)) out.sawCorruptState = true;
    out.dominateOrbs = Math.max(out.dominateOrbs, SFTest.orbs(ORB_DOMINATE).length);
    out.corruptOrbs = Math.max(out.corruptOrbs, SFTest.orbs(ORB_CORRUPT).length);
  }

  // Beat him.
  out.defeatFrames = bot.drive(function () {
    watch();
    if (IsCorrupt(joe.state)) return;                       // turned: just wait for him to finish
    if (corrupt) { if (bot.approach(joe, 460, 740)) bot.tap('smoke', 50, 40); }
    else bot.fight(joe);
  }, function () { return joe.state === States.Dead; }, 3000);
  out.corruptedFlag = !!joe.corrupted;
  out.midCounters = [enemiesDispatched, enemiesCorrupted];

  // Pick up what he dropped and let it fly to the HUD.
  out.collectFrames = bot.drive(function () {
    watch();
    var orbs = SFTest.orbs(ORB_DOMINATE).concat(SFTest.orbs(ORB_CORRUPT));
    if (orbs.length) bot.moveToward(orbs[0].posX, orbs[0].posY, 10, 10);
  }, function () {
    return SFTest.orbs(ORB_DOMINATE).length + SFTest.orbs(ORB_CORRUPT).length === 0 && SFTest.orbsInFlight() === 0;
  }, 1500);

  out.enemiesDispatched = enemiesDispatched;
  out.enemiesCorrupted = enemiesCorrupted;
  out.levelDomination = level.dominationCollected;
  out.levelCorruption = level.corruptionCollected;
  out.joeStillInLevel = level.entities.list.indexOf(joe) !== -1;
  return out;
}

module.exports = [
  {
    name: 'defeat: knocking a Joe0 out gives domination orbs only',
    async run(t) {
      const r = await t.eval(defeatJoe0, false);
      assert.notStrictEqual(r.defeatFrames, -1, 'the Joe0 was never knocked out for good');
      assert.strictEqual(r.sawCorruptState, false, 'fists alone should never corrupt');
      assert.strictEqual(r.corruptedFlag, false);
      assert.strictEqual(r.dominateOrbs, r.orbsOnDeath, 'domination orbs dropped');
      assert.strictEqual(r.corruptOrbs, 0, 'corruption orbs dropped');
      assert.deepStrictEqual(r.midCounters, [0, 0], 'the meters moved before any orb was collected');
      assert.notStrictEqual(r.collectFrames, -1, 'the orbs were never collected');
      assert.strictEqual(r.enemiesDispatched, r.orbsOnDeath, 'the domination meter once the orbs landed');
      assert.strictEqual(r.enemiesCorrupted, 0, 'the corruption meter');
      assert.strictEqual(r.levelDomination, r.orbsOnDeath, "the level's own domination tally");
      assert.strictEqual(r.joeStillInLevel, false, 'the dead Joe0 was not removed from the level');
      t.log(`knocked out for good after ${r.defeatFrames} frames`);
    },
  },
  {
    name: 'defeat: smoking a Joe0 corrupts him and gives corruption orbs only',
    async run(t) {
      const r = await t.eval(defeatJoe0, true);
      assert.notStrictEqual(r.defeatFrames, -1, 'the Joe0 never finished his corruption');
      assert.strictEqual(r.sawCorruptState, true, 'he never entered a corrupt state');
      assert.strictEqual(r.corruptedFlag, true);
      assert.strictEqual(r.corruptOrbs, r.orbsOnDeath, 'corruption orbs dropped');
      assert.strictEqual(r.dominateOrbs, 0, 'domination orbs dropped');
      assert.notStrictEqual(r.collectFrames, -1, 'the orbs were never collected');
      assert.strictEqual(r.enemiesCorrupted, r.orbsOnDeath, 'the corruption meter once the orbs landed');
      assert.strictEqual(r.enemiesDispatched, 0, 'the domination meter');
      assert.strictEqual(r.levelCorruption, r.orbsOnDeath, "the level's own corruption tally");
      assert.strictEqual(r.joeStillInLevel, false, 'the corrupted Joe0 was not removed from the level');
      t.log(`corrupted and gone after ${r.defeatFrames} frames`);
    },
  },
  {
    // Quitting to the title screen and starting again resets the HUD. An orb
    // that was still flying to a meter at that moment must not land in the new
    // game. (HUD.Reset() used to leave hud.orbs alone.)
    name: 'defeat: orbs still flying to the HUD are dropped when the HUD resets',
    async run(t) {
      const r = await t.eval(() => {
        SFTest.newGame('arena');
        var bot = SFTest.bot;
        var joe = SFTest.spawn('Joe0', 400, 0);
        bot.drive(function () {
          var orbs = SFTest.orbs(ORB_DOMINATE);
          if (joe.state !== States.Dead) bot.fight(joe);
          else if (orbs.length) bot.moveToward(orbs[0].posX, orbs[0].posY, 10, 10);
        }, function () { return SFTest.orbsInFlight() > 0; }, 3000);
        var out = { inFlight: SFTest.orbsInFlight() };

        // What "Exit to Title" then "New Game" does to the HUD and the meters.
        hud.Reset();
        enemiesDispatched = 0;
        enemiesCorrupted = 0;
        // A new game is also a new level: take away any orb still lying on the
        // ground, so only the ones that were in flight are being judged.
        SFTest.orbs().forEach(function (orb) { level.entities.Remove(orb); });
        out.inFlightAfterReset = SFTest.orbsInFlight();
        SFTest.step(400);
        out.after = enemiesDispatched;
        return out;
      });
      assert.ok(r.inFlight > 0, 'could not get an orb into flight to set the situation up');
      assert.strictEqual(r.inFlightAfterReset, 0, 'orbs were still in flight after hud.Reset()');
      assert.strictEqual(r.after, 0,
        `${r.after} domination orb(s) from the previous game were counted after the reset`);
    },
  },
];
