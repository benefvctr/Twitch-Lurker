const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

// USAGE: node scripts/validate-extension.js <path-to-cloned-firefox-profile>
// Or with no arg, auto-clone the default profile.

const APPDATA = process.env.APPDATA;
const LURKER_PROFILE = path.join(APPDATA, 'twitch-lurker', 'firefox-profile');

function findDefaultFirefoxProfile() {
  const profilesIni = path.join(APPDATA, 'Mozilla', 'Firefox', 'profiles.ini');
  const text = fs.readFileSync(profilesIni, 'utf8');
  const sections = text.split(/\r?\n\r?\n/);
  for (const s of sections) {
    if (s.startsWith('[Install')) {
      const m = s.match(/Default=(.+)/);
      if (m) return path.join(APPDATA, 'Mozilla', 'Firefox', m[1].trim());
    }
  }
  for (const s of sections) {
    if (s.startsWith('[Profile') && /Default=1/.test(s)) {
      const m = s.match(/Path=(.+)/);
      if (m) return path.join(APPDATA, 'Mozilla', 'Firefox', m[1].trim());
    }
  }
  throw new Error('Could not find default Firefox profile in profiles.ini');
}

function cloneProfile(src, dst) {
  if (fs.existsSync(dst)) {
    console.log(`Cloned profile already exists at ${dst} — clearing transient files`);
  } else {
    console.log(`Cloning ${src} -> ${dst}`);
    fs.cpSync(src, dst, { recursive: true });
  }
  // Always clear lock + version-mismatch files (whether fresh clone or reused)
  for (const f of ['parent.lock', 'lock', '.parentlock', 'compatibility.ini']) {
    const p = path.join(dst, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

(async () => {
  const sourceProfile = process.argv[2] || findDefaultFirefoxProfile();
  console.log('Source Firefox profile:', sourceProfile);
  cloneProfile(sourceProfile, LURKER_PROFILE);

  const ctx = await firefox.launchPersistentContext(LURKER_PROFILE, {
    headless: false,
    args: ['-no-remote']
  });
  const page = await ctx.newPage();
  try {
    await page.goto('about:addons', { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch {
    // about: pages sometimes don't fire normal load events; the window is still open
  }

  // Print installed extensions to console as a backup signal independent of the UI
  try {
    const extJsonPath = path.join(LURKER_PROFILE, 'extensions.json');
    if (fs.existsSync(extJsonPath)) {
      const data = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
      console.log('\n=== EXTENSIONS DETECTED IN CLONED PROFILE ===');
      for (const a of (data.addons || [])) {
        console.log(`- ${a.defaultLocale?.name ?? a.id}  (id=${a.id}, active=${a.active}, location=${a.location})`);
      }
      console.log('=============================================\n');
    }
  } catch (e) {
    console.warn('Could not read extensions.json:', e.message);
  }

  console.log('\n=== MANUAL CHECK ===');
  console.log('1. In the open Firefox window, navigate to about:addons in the address bar (or press Ctrl+Shift+A).');
  console.log('2. Confirm your channel-points extension is listed AND enabled.');
  console.log('3. If it shows "Could not be verified" or is disabled, see fallback notes in the plan.');
  console.log('4. Press Ctrl+C in this terminal to exit when done.');
  console.log('===================\n');

  await new Promise(() => {});
})();
