const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

const APPDATA = process.env.APPDATA;
const LURKER_PROFILE = path.join(APPDATA, 'twitch-lurker', 'firefox-profile');

const channel = process.argv[2];
if (!channel) {
  console.error('Usage: node scripts/validate-watch-time.js <channel-name>');
  process.exit(1);
}

// Clear lock + version-mismatch files between runs
for (const f of ['parent.lock', 'lock', '.parentlock', 'compatibility.ini']) {
  const p = path.join(LURKER_PROFILE, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

(async () => {
  const ctx = await firefox.launchPersistentContext(LURKER_PROFILE, {
    headless: false,
    args: ['-no-remote']
  });
  const page = await ctx.newPage();
  await page.goto(`https://www.twitch.tv/${channel}`);

  try {
    await page.waitForSelector('button[data-a-target="content-classification-gate-overlay-start-watching-button"]', { timeout: 4000 });
    await page.click('button[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    console.log('Dismissed mature-content gate');
  } catch { /* not present */ }

  await page.waitForSelector('video', { timeout: 30000 });
  console.log('Video element loaded');

  try {
    await page.click('[data-a-target="player-settings-button"]');
    await page.waitForSelector('button[data-a-target="player-settings-menu-item-quality"]');
    await page.click('button[data-a-target="player-settings-menu-item-quality"]');
    await page.waitForTimeout(500);
    const qualityButtons = await page.$$('input[name="player-settings-submenu-quality-option"]');
    if (qualityButtons.length > 0) {
      await qualityButtons[qualityButtons.length - 1].click();
      console.log('Set lowest quality');
    }
  } catch (e) {
    console.warn('Could not set quality:', e.message);
  }

  const isMuted = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v?.muted;
  });
  if (isMuted) {
    await page.keyboard.press('m');
    console.log('Unmuted via keyboard shortcut');
  }

  console.log('\n=== WATCH TIME TEST ===');
  console.log(`Watching ${channel} now. Player should be unmuted.`);
  console.log('1. Note your current channel-points balance for this channel (open inventory in normal browser).');
  console.log('2. Mute this Firefox process in Windows volume mixer (so house stays quiet).');
  console.log('3. Leave running for 30 minutes.');
  console.log('4. Check channel-points balance — should have increased.');
  console.log('5. Check twitch.tv inventory drops page — total watch time should reflect ~30 min.');
  console.log('=======================\n');

  await new Promise(() => {});
})();
