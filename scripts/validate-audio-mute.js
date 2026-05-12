const { firefox } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APPDATA = process.env.APPDATA;
const LURKER_PROFILE = path.join(APPDATA, 'twitch-lurker', 'firefox-profile');

// Clear lock + version-mismatch files between runs (Firefox regenerates them)
for (const f of ['parent.lock', 'lock', '.parentlock', 'compatibility.ini']) {
  const p = path.join(LURKER_PROFILE, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

(async () => {
  console.log('Launching lurker Firefox via Playwright...');
  const ctx = await firefox.launchPersistentContext(LURKER_PROFILE, {
    headless: false,
    args: ['-no-remote']
  });
  const page = await ctx.newPage();
  await page.goto('https://www.twitch.tv/cooldee__');
  await page.waitForTimeout(3000);

  // Find lurker Firefox PID via Windows process list filtered by our profile path
  let pid = 'unknown';
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
      { encoding: 'utf8' }
    ).trim();
    if (out) pid = out;
  } catch (e) {
    console.warn('PID lookup failed:', e.message);
  }
  console.log('Lurker Firefox PID:', pid);

  console.log('\n=== MANUAL CHECK ===');
  console.log('1. Open a SECOND, normal Firefox window outside Playwright.');
  console.log('2. Play any audio in that normal Firefox (YouTube, music, etc.).');
  console.log('3. Open Windows Sound Settings -> Volume mixer.');
  console.log(`4. Confirm there are TWO Firefox entries with different PIDs (one is ${pid}).`);
  console.log(`5. Mute ONLY the entry for PID ${pid}.`);
  console.log('6. Confirm your normal Firefox audio still plays.');
  console.log('===================\n');

  await new Promise(() => {});
})();
