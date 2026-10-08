/*
 * common.js — shared plumbing for playtest.js (screenshots) and record.js (video).
 */

const path = require('path');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(width, height) {
  return await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || DEFAULT_CHROME,
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--mute-audio'],
    defaultViewport: { width: width, height: height, deviceScaleFactor: 1 },
    protocolTimeout: 300000,   // record.js pulls a whole video back through one evaluate
  });
}

async function reachReady(page) {
  // Wait for assets to finish downloading
  for (let i = 0; i < 100; i++) {
    const pct = await page.evaluate(() => {
      try { return GlobalResourceLoader.loadPercentage; } catch (e) { return 0; }
    });
    if (pct > 99) break;
    await sleep(500);
  }
  // Unlock WebAudio: a trusted click + clear the loader's lock flag
  await page.mouse.click(Math.floor(page.viewport().width / 2),
                         Math.floor(page.viewport().height / 2));
  await page.evaluate(() => {
    try { if (typeof audioContext !== 'undefined') audioContext.resume(); } catch (e) {}
    try { GlobalResourceLoader.webAudioLocked = false; } catch (e) {}
  });
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      try { return GlobalResourceLoader.AllReady(); } catch (e) { return false; }
    });
    if (ready) return true;
    await sleep(400);
  }
  return false;
}

module.exports = { sleep, launch, reachReady };
