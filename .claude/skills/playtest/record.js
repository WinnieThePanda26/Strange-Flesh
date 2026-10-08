#!/usr/bin/env node
/*
 * record.js — record a video clip (with game audio) of Strange Flesh in a headless browser.
 *
 * Video comes from the on-screen canvas (displayC.captureStream), so it's exactly
 * what a player sees, overlays included. Audio is tapped from WebAudio: before the
 * game's scripts load, AudioNode.connect is wrapped so that anything routed to the
 * speakers (music bus, each sound's gain node, direct sources) is ALSO routed into a
 * MediaStreamDestination. Both tracks go through one MediaRecorder. No game code is
 * touched, and --mute-audio only silences the speakers, not the tap.
 *
 * Scenarios:
 *   lairs              plain Lairs (trainer on unless --no-trainer) for --duration seconds
 *   lairs-poppers-sex  scripted: a popper hit is called right away, he gets drunk, and the
 *                      next seduction goes all the way to sex; stops a beat after the sex
 *   none               record whatever is on screen after load (combine with --eval)
 *
 * Examples:
 *   node record.js --scenario lairs-poppers-sex --out /tmp/sf-rec/poppers
 *   node record.js --scenario lairs --duration 45 --widescreen --width 2560 --height 1080
 */

const fs = require('fs');
const path = require('path');
const { sleep, launch, reachReady } = require('./common');

function parseArgs(argv) {
  const a = {
    url: 'http://localhost:8000/index.html',
    width: 1920, height: 1080,
    widescreen: false,
    scenario: 'lairs-poppers-sex',
    duration: 90,               // seconds: hard cap (and the full length for 'lairs' / 'none')
    tail: 2.5,                  // seconds kept after a scripted scenario's payoff
    fps: 30,
    bitrate: 8000000,
    audio: true,
    trainer: true,
    out: '/tmp/sf-record/clip',  // extension (.mp4 / .webm) is added from what Chrome can encode
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--widescreen') a.widescreen = true;
    else if (t === '--url') a.url = argv[++i];
    else if (t === '--width') a.width = +argv[++i];
    else if (t === '--height') a.height = +argv[++i];
    else if (t === '--scenario') a.scenario = argv[++i];
    else if (t === '--duration') a.duration = +argv[++i];
    else if (t === '--tail') a.tail = +argv[++i];
    else if (t === '--fps') a.fps = +argv[++i];
    else if (t === '--bitrate') a.bitrate = +argv[++i];
    else if (t === '--no-audio') a.audio = false;
    else if (t === '--no-trainer') a.trainer = false;
    else if (t === '--eval') a.eval = argv[++i];
    else if (t === '--out') a.out = argv[++i].replace(/\.(mp4|webm)$/, '');
  }
  return a;
}

// Runs in the page before any game script. Everything that reaches the speakers also
// feeds __recMix, which feeds the recording tap and a level meter.
function installAudioTap() {
  var orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    var r = orig.apply(this, arguments);
    if (dest instanceof AudioDestinationNode) {
      var ctx = this.context;
      if (!ctx.__recMix) {
        ctx.__recMix = ctx.createGain();
        ctx.__recTap = ctx.createMediaStreamDestination();
        ctx.__recMeter = ctx.createAnalyser();
        ctx.__recMeter.fftSize = 2048;
        orig.call(ctx.__recMix, ctx.__recTap);
        orig.call(ctx.__recMix, ctx.__recMeter);
      }
      orig.call(this, ctx.__recMix);
    }
    return r;
  };
}

async function startLairs(page, a) {
  // Give the title music a moment to queue its first segment: Music.stop() (called by
  // startLairsMode) crashes if it runs between play() and that first queue.
  await sleep(1000);
  await page.evaluate((a) => {
    settings.lairsTrainer = a.trainer ? 1 : 0;
    if (a.scenario === 'lairs-poppers-sex') {
      // Short holds, no long hits; hold the sex roll at 0 until the hit lands; and make
      // one hit last long enough that he's still drunk when the sex comes round.
      settings.lairsTrainer = 1;
      settings.lairsHoldShort = 0;
      settings.lairsLongChance = 0;
      LAIRS_SEX_CHANCE = 0;
      LAIRS_DRUNK_PER_HOLD_SECOND = 30;
      // Joe3's corruption-transform outlasts the seduce action's 240-frame wait for
      // Corrupt, so a kissed Joe3 never escalates to sex; only spawn Joes that do.
      LAIRS_ENEMY_POOL = ['Joe1', 'Joe2'];
    }
    startLairsMode();
  }, a);
  // Let the level-start transition clear before rolling.
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => menuStack.length === 0)) break;
    await sleep(250);
  }
  await sleep(800);
}

(async () => {
  const a = parseArgs(process.argv);
  fs.mkdirSync(path.dirname(a.out), { recursive: true });

  const browser = await launch(a.width, a.height);
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => { if (m.text().indexOf('[rec]') === 0) console.log(m.text()); });   // for --eval debugging
    if (a.audio) await page.evaluateOnNewDocument(installAudioTap);
    await page.goto(a.url, { waitUntil: 'load', timeout: 30000 });

    const ready = await reachReady(page);
    if (!ready) console.log('WARN: AllReady never became true');

    await page.evaluate((ws) => {
      if (settings.hasOwnProperty('widescreenMode')) settings.widescreenMode = ws ? 1 : 0;
      resizeCanvas(true);
    }, a.widescreen);

    if (a.scenario === 'lairs' || a.scenario === 'lairs-poppers-sex') await startLairs(page, a);
    else if (a.scenario !== 'none') throw new Error('unknown --scenario ' + a.scenario);

    if (a.eval) console.log('EVAL:', JSON.stringify(await page.evaluate(a.eval)));

    const mime = await page.evaluate((a) => {
      var types = a.audio
        ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm']
        : ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp9', 'video/webm'];
      var mime = null;
      for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }

      var stream = displayC.captureStream(a.fps);
      if (a.audio && audioContext.__recTap) {
        audioContext.resume();
        audioContext.__recTap.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      }
      window.__chunks = [];
      window.__rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: a.bitrate });
      window.__recError = null;
      window.__rec.onerror = function (e) { window.__recError = String((e.error && e.error.message) || e); };
      window.__rec.ondataavailable = function (e) { if (e.data.size) window.__chunks.push(e.data); };
      window.__rec.start(1000);

      // Audio level meter, so a silent track shows up in the log.
      window.__peak = 0;
      if (audioContext.__recMeter) {
        var buf = new Float32Array(audioContext.__recMeter.fftSize);
        window.__meter = setInterval(function () {
          audioContext.__recMeter.getFloatTimeDomainData(buf);
          for (var j = 0; j < buf.length; j++) window.__peak = Math.max(window.__peak, Math.abs(buf[j]));
        }, 50);
      }

      // State log of the star (Lairs' bartender, or the player).
      window.__log = [];
      window.__frames = 0;
      window.__watch = setInterval(function () {
        window.__frames += 1;
        if (a.scenario === 'lairs-poppers-sex' && lairsTrainer && lairsTrainer.phase >= LairsPhase.Hit)
          LAIRS_SEX_CHANCE = 1;   // once the hit has landed, every seduction escalates
        if (!player) return;
        var last = window.__log[window.__log.length - 1];
        if (!last || last.state !== player.state)
          window.__log.push({ t: window.__frames / 60, state: player.state, drunk: player.drunkTimer || 0 });
      }, 1000 / 60);

      if (a.scenario === 'lairs-poppers-sex') lairsTrainer.waitTimer = 30;   // call the hit ~0.5s in
      return mime;
    }, a);
    console.log('MIME:', mime);

    const t0 = Date.now();
    let payoffAt = null;
    while (Date.now() - t0 < a.duration * 1000) {
      if (a.scenario === 'lairs-poppers-sex') {
        const done = await page.evaluate(() => lairsStats.fucked >= 1 && player.state === States.Walk);
        if (done && payoffAt === null) payoffAt = Date.now();
        if (payoffAt !== null && Date.now() - payoffAt > a.tail * 1000) break;
      }
      await sleep(250);
    }
    if (a.scenario === 'lairs-poppers-sex' && payoffAt === null)
      console.log('WARN: hit the --duration cap before the sex finished');

    const result = await page.evaluate(() => new Promise((resolve) => {
      clearInterval(window.__watch);
      clearInterval(window.__meter);
      window.__rec.onstop = function () {
        var blob = new Blob(window.__chunks, { type: window.__rec.mimeType });
        var fr = new FileReader();
        fr.onload = function () {
          var names = {};
          for (var k in States) names[States[k]] = k;
          resolve({
            data: fr.result.slice(fr.result.indexOf(';base64,') + 8),   // the mime itself can contain commas
            peak: window.__peak,
            chunks: window.__chunks.map(function (c) { return c.size; }),
            error: window.__recError,
            log: window.__log.map(function (e) { return { t: e.t, state: names[e.state], drunk: e.drunk }; }),
            stats: (typeof lairsStats !== 'undefined' && lairsStats) ? { kissed: lairsStats.kissed, fucked: lairsStats.fucked } : null,
          });
        };
        fr.readAsDataURL(blob);
      };
      window.__rec.stop();
    }));

    if (result.error) console.log('RECORDER ERROR:', result.error);
    console.log('CHUNKS:', result.chunks.length, result.chunks.slice(0, 8).join(','));
    const out = a.out + (mime && mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm');
    fs.writeFileSync(out, Buffer.from(result.data, 'base64'));
    console.log('LOG:\n  ' + result.log.map((e) =>
      `${e.t.toFixed(1)}s ${e.state}${e.drunk ? ' (drunk ' + Math.round(e.drunk / 60) + 's left)' : ''}`).join('\n  '));
    if (result.stats) console.log('STATS:', JSON.stringify(result.stats));
    if (a.audio) console.log('AUDIO PEAK:', result.peak.toFixed(3), result.peak < 0.001 ? '(SILENT — check audio unlock)' : '');
    console.log('LENGTH:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    console.log('OUT:', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
