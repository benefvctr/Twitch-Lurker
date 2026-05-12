/**
 * Creates a directory junction from <project>/ms-playwright -> %LOCALAPPDATA%/ms-playwright
 * so electron-builder can include the Playwright Firefox binary as an extraResource
 * using a project-relative path.
 *
 * Run via the "prebuild" npm script automatically before electron-builder.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LINK = path.join(PROJECT_ROOT, 'ms-playwright');
const TARGET = path.join(process.env.LOCALAPPDATA, 'ms-playwright');

if (!fs.existsSync(TARGET)) {
  console.error(`[link-playwright] Playwright browser directory not found at: ${TARGET}`);
  console.error('Run "npx playwright install firefox" first.');
  process.exit(1);
}

if (fs.existsSync(LINK)) {
  // Already linked or present — leave it alone.
  console.log('[link-playwright] ms-playwright link already exists, skipping.');
} else {
  fs.symlinkSync(TARGET, LINK, 'junction');
  console.log(`[link-playwright] Created junction: ${LINK} -> ${TARGET}`);
}
