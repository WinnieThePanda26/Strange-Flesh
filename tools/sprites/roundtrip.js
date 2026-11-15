#!/usr/bin/env node
/*
 * roundtrip.js — prove the packer by running the game on its output.
 *
 *     node tools/sprites/roundtrip.js [SHEET.txt ...] [--all] [--keep DIR]
 *
 * For each sheet it
 *   1. unpacks the sheet to frame PNGs, packs them again with a different
 *      number of columns (so every frame lands somewhere new), and checks with
 *      "spritesheet.py compare" that names, sizes, centres and pixels match;
 *   2. loads the game twice in headless Chrome, once as it is and once with the
 *      repacked sheet served in place of the original;
 *   3. in both, draws every frame of the sheet through the game's own
 *      Sprite.DrawSprite3x, facing right and mirrored, and plays a short scene
 *      in the test arena, then compares every pixel the game drew.
 *
 * Exit code 0 when both games drew the same thing.
 *
 * --self-test moves one frame's centre by a single pixel in the repacked sheet
 * before the games run, and passes only if the comparison catches it.
 *
 * With no sheets named it checks the player's basic sheet and the OfficeAngel,
 * which are the two the scene puts on screen. --all checks every sheet under
 * images/ and new_images/.
 *
 * Needs what the tests need (media pack, Chrome, the playtest skill's
 * node_modules) plus Python 3 with Pillow.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const harness = require(path.join(ROOT, 'tests', 'lib', 'harness.js'));
const PACKER = path.join(__dirname, 'spritesheet.py');

const DEFAULT_SHEETS = [
  'images/bartender/sheet_Bartender_Basic.txt',
  'images/enemies/sheet_OfficeAngel.txt',
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf',
};

function packer(args) {
  return execFileSync('python3', [PACKER].concat(args), { encoding: 'utf8' });
}

function findSheets(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSheets(full, found);
    else if (entry.name.endsWith('.txt') && fs.existsSync(full.slice(0, -4) + '.png')) {
      try {
        if (Array.isArray(JSON.parse(fs.readFileSync(full, 'utf8')).frames)) found.push(full);
      } catch (e) { /* not a sheet */ }
    }
  }
  return found;
}

// The repo over HTTP. `overrides` maps a URL path to a file that is served in
// its place: that is how the second game gets the repacked sheets.
function startServer(overrides) {
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400); res.end(); return;
    }
    let target = path.normalize(path.join(ROOT, rel));
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      res.writeHead(403); res.end(); return;
    }
    const mime = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) target = overrides[rel];
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      base: 'http://127.0.0.1:' + server.address().port,
      stop: () => { server.close(); if (server.closeAllConnections) server.closeAllConnections(); },
    }));
  });
}

// Runs inside the game page. Draws every named frame, then plays a scene, and
// returns a hash of everything that reached a canvas.
function drawEverything(names, sceneFrames) {
  function hash(data, h) {
    var words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
    for (var i = 0; i < words.length; i++) {
      h ^= words[i];
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function visible(data) {
    var n = 0;
    for (var i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
    return n;
  }

  var out = { sprites: {}, missing: [], visiblePixels: 0, scene: 0, sceneColors: 0, sceneShot: null, canvas: null };

  // 1. Every frame, drawn by the game's own sprite code into a canvas big
  //    enough for it either way round. The transform is the one the camera
  //    uses at the native resolution: 1/3, undoing DrawSprite3x.
  var gameCtx = ctx;
  var canvas = document.createElement('canvas');
  var g = canvas.getContext('2d', { willReadFrequently: true });
  ctx = g;
  try {
    for (var i = 0; i < names.length; i++) {
      var sprite = GlobalResourceLoader.GetSprite(names[i]);
      if (!sprite.inited) { out.missing.push(names[i]); continue; }
      canvas.width = sprite.width * 4;
      canvas.height = sprite.height * 4;
      var pair = [];
      for (var flipped = 0; flipped < 2; flipped++) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.imageSmoothingEnabled = false;
        g.setTransform(1 / 3, 0, 0, 1 / 3, sprite.width * 2, sprite.height * 2);
        sprite.DrawSprite3x(0, 0, flipped === 1);
        var data = g.getImageData(0, 0, canvas.width, canvas.height).data;
        out.visiblePixels += visible(data);
        pair.push(hash(data, 2166136261));
      }
      out.sprites[names[i]] = pair;
    }
  } finally {
    ctx = gameCtx;
  }

  // 2. A scene: the player walks up to an OfficeAngel, punches, turns round
  //    and walks back, so both are drawn facing each way. What is hashed is
  //    displayC, the canvas the player sees: the game wipes its internal canvas
  //    as soon as it has copied a frame across.
  SFTest.newGame('arena', { seed: 1 });
  SFTest.spawn('OfficeAngel', player.posX + 500, player.posY);
  var read = displayC.getContext('2d');
  var h = 2166136261;
  for (var f = 0; f < sceneFrames; f++) {
    SFTest.releaseAll();
    if (f < 70) SFTest.press('right');
    else if (f < 130) { if (f % 12 < 3) SFTest.press('punch'); }
    else if (f < 200) SFTest.press('left');
    SFTest.step(1);
    var shown = read.getImageData(0, 0, displayC.width, displayC.height).data;
    h = hash(shown, h);
    if (f === 100) {
      out.sceneShot = displayC.toDataURL('image/png');
      var seen = {};
      for (var p = 0; p < shown.length; p += 4) seen[(shown[p] << 16) | (shown[p + 1] << 8) | shown[p + 2]] = true;
      out.sceneColors = Object.keys(seen).length;
    }
  }
  SFTest.releaseAll();
  out.scene = h;
  out.canvas = displayC.width + 'x' + displayC.height;
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let keep = null;
  let selfTest = false;
  let sabotagedSceneFrame = false;
  let sheets = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') {
      sheets = findSheets(path.join(ROOT, 'images'), []);
      if (fs.existsSync(path.join(ROOT, 'new_images'))) findSheets(path.join(ROOT, 'new_images'), sheets);
    } else if (argv[i] === '--keep') keep = path.resolve(argv[++i]);
    else if (argv[i] === '--self-test') selfTest = true;
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\n?/, '').replace(/^ \* ?/gm, ''));
      return 0;
    } else sheets.push(path.resolve(argv[i]));
  }
  if (sheets.length === 0) sheets = DEFAULT_SHEETS.map((s) => path.join(ROOT, s));
  sheets.sort();

  const problems = harness.preflight();
  if (problems.length) {
    console.error(problems.join('\n'));
    return 2;
  }

  const work = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-roundtrip-'));
  fs.mkdirSync(work, { recursive: true });

  // Step 1: unpack, repack with a different layout, compare the files.
  console.log('Repacking ' + sheets.length + ' sheet(s)...');
  const overrides = {};
  const names = [];
  let moved = 0;
  for (const txt of sheets) {
    const rel = '/' + path.relative(ROOT, txt).split(path.sep).join('/');
    const id = rel.slice(1, -4).replace(/[^A-Za-z0-9]+/g, '_');
    const info = JSON.parse(fs.readFileSync(txt, 'utf8'));
    const frames = path.join(work, id);
    const repacked = path.join(work, 'repacked', id);
    fs.rmSync(frames, { recursive: true, force: true });
    packer(['unpack', txt, frames]);
    const columns = new Set(info.frames.map((f) => f.originX)).size;
    packer(['pack', frames, '-o', repacked, '--no-name-check',
      '--columns', String(columns > 1 ? columns - 1 : Math.min(2, info.frames.length))]);
    let verdict;
    try {
      verdict = packer(['compare', txt, repacked + '.txt']).trim();
    } catch (e) {
      console.error('FAIL ' + rel + '\n' + (e.stdout || e.message));
      return 1;
    }
    const m = /\((\d+) frame/.exec(verdict);
    moved += m ? Number(m[1]) : 0;
    overrides[rel] = repacked + '.txt';
    overrides[rel.slice(0, -4) + '.png'] = repacked + '.png';
    for (const f of info.frames) names.push(f.name);
  }
  console.log('  files: ' + names.length + ' frames identical after unpack + pack; ' + moved +
    ' of them now sit at a different place in their sheet.');

  if (selfTest) {
    // Break one thing on purpose: the check is only worth something if it notices.
    const target = Object.keys(overrides).filter((k) => k.endsWith('.txt')).sort()[0];
    const info = JSON.parse(fs.readFileSync(overrides[target], 'utf8'));
    // Prefer a frame the scene shows, so the scene comparison is tested too.
    const frame = info.frames.find((f) => /\/(walk|idle)1$/.test(f.name)) ||
      info.frames[Math.floor(info.frames.length / 2)];
    sabotagedSceneFrame = /\/(walk|idle)1$/.test(frame.name);
    frame.centerX += 1;
    fs.writeFileSync(overrides[target], JSON.stringify(info));
    console.log('  self-test: moved the centre of ' + frame.name + ' one pixel to the right.');
  }

  // Steps 2 and 3: the same drawing in two games.
  const original = await startServer({});
  const swapped = await startServer(overrides);
  const browser = await harness.launchBrowser();
  let a, b;
  try {
    console.log('Loading the game with the original sheets...');
    let page = await harness.openGame(browser, original.base);
    a = await page.evaluate(drawEverything, names, 240);
    if (page.sfErrors.length) throw new Error('page errors: ' + page.sfErrors.join(' | '));
    await page.close();
    console.log('Loading the game with the repacked sheets...');
    page = await harness.openGame(browser, swapped.base);
    b = await page.evaluate(drawEverything, names, 240);
    if (page.sfErrors.length) throw new Error('page errors: ' + page.sfErrors.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    original.stop();
    swapped.stop();
  }

  for (const [label, shot] of [['original', a.sceneShot], ['repacked', b.sceneShot]]) {
    fs.writeFileSync(path.join(work, 'scene-' + label + '.png'), Buffer.from(shot.split(',')[1], 'base64'));
  }

  const different = names.filter((n) => JSON.stringify(a.sprites[n]) !== JSON.stringify(b.sprites[n]));
  const missing = a.missing.concat(b.missing);
  const drawn = names.length - a.missing.length;
  console.log('  sprites: ' + drawn + ' frames drawn facing right and mirrored (' +
    a.visiblePixels + ' visible pixels); ' + (drawn - different.length) + ' identical.');
  console.log('  scene:   240 frames of the arena at ' + a.canvas + ' (' + a.sceneColors +
    ' colours on screen), hash ' + a.scene.toString(16) + ' vs ' + b.scene.toString(16) + '.');
  console.log('  scene screenshots: ' + path.join(work, 'scene-original.png') + ' and scene-repacked.png');

  let ok = true;
  if (missing.length) { ok = false; console.log('FAIL: frames the game never loaded: ' + missing.slice(0, 8).join(', ')); }
  if (a.visiblePixels === 0 || a.sceneColors < 16) {
    ok = false;
    console.log('FAIL: nothing visible was drawn, so the comparison proves nothing.');
  }
  if (different.length) { ok = false; console.log('FAIL: drawn differently: ' + different.slice(0, 8).join(', ')); }
  if (a.scene !== b.scene) { ok = false; console.log('FAIL: the scene was drawn differently.'); }
  if (!keep) console.log('(working files are in ' + work + ')');
  if (selfTest) {
    const caught = different.length > 0 && (!sabotagedSceneFrame || a.scene !== b.scene);
    console.log(caught ? 'SELF-TEST PASS: the one-pixel change was caught.'
      : 'SELF-TEST FAILED: a moved centre went unnoticed.');
    return caught ? 0 : 1;
  }
  console.log(ok ? 'PASS: the game draws the repacked sheets exactly as it draws the originals.' : 'FAILED');
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
