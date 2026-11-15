/*
 * harness.js — Node-side plumbing for tests/run.js: preflight checks, a static
 * file server, the browser (through the playtest skill's puppeteer-core), and
 * opening a game page with the test hooks installed.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const SKILL = path.join(ROOT, '.claude', 'skills', 'playtest');
const OUT = path.join(TESTS, 'out');

const VIEWPORT = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything the harness needs that is not in the repo. Returns a list of
// problems (empty when good to go).
function preflight() {
  const problems = [];
  if (!fs.existsSync(path.join(SKILL, 'node_modules', 'puppeteer-core'))) {
    problems.push('puppeteer-core is not installed. Run:\n    npm --prefix .claude/skills/playtest install');
  }
  for (const dir of ['images', 'sound']) {
    if (!fs.existsSync(path.join(ROOT, dir))) {
      problems.push(`${dir}/ is missing. The tests need the media pack (see README.md): ` +
        'animation timing comes from the sprite sheets.');
    }
  }
  if (problems.length === 0) {
    const chrome = process.env.CHROME_PATH || require(path.join(SKILL, 'common.js')).DEFAULT_CHROME;
    if (!fs.existsSync(chrome)) {
      problems.push(`Chrome not found at ${chrome}. Set CHROME_PATH to your Chrome binary.`);
    }
  }
  return problems;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Serve the repo over HTTP on a spare port, no caching: the same job as
// serve.py, done in-process because several test pages load at once and
// serve.py answers one request at a time.
function startServer() {
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400); res.end(); return;
    }
    const target = path.normalize(path.join(ROOT, rel));
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      res.writeHead(403); res.end(); return;
    }
    fs.stat(target, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(target).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        stop: () => { server.close(); if (server.closeAllConnections) server.closeAllConnections(); },
      });
    });
  });
}

// opts.headless: false gives a visible window (recording, watching). Chrome slows
// timers in a window that is covered or in the background, which would slow the
// game with it, so that is switched off for visible windows.
async function launchBrowser(opts) {
  const { launch } = require(path.join(SKILL, 'common.js'));
  opts = Object.assign({}, opts);
  if (opts.headless === false) {
    // Ctrl-C has to reach the recorder (which saves and then exits), not make
    // puppeteer quit on the spot.
    opts.handleSIGINT = false;
    opts.args = [
      `--window-size=${VIEWPORT.width + 16},${VIEWPORT.height + 140}`,
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ];
  }
  return await launch(VIEWPORT.width, VIEWPORT.height, opts);
}

// Level descriptors, read from disk and handed to the page so levels load
// synchronously: every levels/*.txt plus the fixtures in tests/fixtures.
function readLevels() {
  const levels = {};
  for (const file of fs.readdirSync(path.join(ROOT, 'levels'))) {
    if (file.endsWith('.txt')) {
      levels[file.replace(/\.txt$/, '')] = fs.readFileSync(path.join(ROOT, 'levels', file), 'utf8');
    }
  }
  for (const file of fs.readdirSync(path.join(TESTS, 'fixtures'))) {
    if (file.endsWith('.json')) {
      levels[file.replace(/\.json$/, '')] = fs.readFileSync(path.join(TESTS, 'fixtures', file), 'utf8');
    }
  }
  return levels;
}

function inPageSources() {
  return ['hooks.js', 'bot.js']
    .map((f) => path.join(TESTS, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'));
}

// Open the game in a new page with the hooks installed, wait for every resource
// to load, then take drawing off the browser's own timer. The page comes back
// ready for SFTest.newGame().
async function openGame(browser, base, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  page.sfErrors = [];
  page.on('pageerror', (e) => page.sfErrors.push(e.message));
  if (opts.onConsole) page.on('console', (m) => opts.onConsole(m.text()));

  for (const source of inPageSources()) await page.evaluateOnNewDocument(source);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });

  // The loader gates on a WebAudio unlock: give it a trusted click and clear the
  // flag (same thing the playtest skill does), then wait on AllReady itself.
  await page.mouse.click(Math.floor(VIEWPORT.width / 2), Math.floor(VIEWPORT.height / 2));
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    ready = await page.evaluate(() => {
      try {
        if (typeof audioContext !== 'undefined') audioContext.resume();
        GlobalResourceLoader.webAudioLocked = false;
        return GlobalResourceLoader.AllReady();
      } catch (e) { return false; }
    });
    if (ready) break;
    await sleep(50);
  }
  if (!ready) {
    const detail = await page.evaluate(() => {
      try { return GlobalResourceLoader.errorMessages.join('; '); } catch (e) { return String(e); }
    });
    throw new Error('the game never finished loading' + (detail ? ': ' + detail : '') +
      (page.sfErrors.length ? ' (page errors: ' + page.sfErrors.join(' | ') + ')' : ''));
  }

  await page.evaluate((levels, seed) => {
    for (const name in levels) SFTest.levelText[name] = levels[name];
    SFTest.defaultSeed = seed;
    SFTest.freeze();
  }, readLevels(), opts.seed === undefined ? 1 : opts.seed);

  return page;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Save what the game looked like when a test failed: a state dump and a
// screenshot. Returns the folder, or null if nothing could be saved.
async function dumpFailure(page, name) {
  const dir = path.join(OUT, slug(name));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const snap = await page.evaluate(() => {
      try { return SFTest.snapshot(); } catch (e) { return { error: String(e) }; }
    });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(snap, null, 2));
    await page.screenshot({ path: path.join(dir, 'screenshot.png') });
    return dir;
  } catch (e) {
    return null;
  }
}

module.exports = {
  ROOT, TESTS, OUT, VIEWPORT, sleep, slug,
  preflight, startServer, launchBrowser, openGame, dumpFailure, readLevels,
};
