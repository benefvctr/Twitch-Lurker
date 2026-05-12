import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigStore } from '../src/main/ConfigStore.js';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-lurker-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('returns defaults when no config file exists', () => {
    const store = new ConfigStore(path.join(tmpDir, 'config.json'));
    const cfg = store.read();
    expect(cfg.channels).toEqual([
      'CoolDee__', 'CoolestJonas', 'KinderCSGO', 'Hyxu_', 'Squib_Channel', 'SkidMercs'
    ]);
    expect(cfg.pollIntervalSec).toBe(60);
  });

  it('persists writes and reads back the same value', () => {
    const file = path.join(tmpDir, 'config.json');
    const store = new ConfigStore(file);
    store.write({ channels: ['foo'], pollIntervalSec: 120, lurkerProfilePath: 'C:/x' });
    const fresh = new ConfigStore(file);
    const cfg = fresh.read();
    expect(cfg.channels).toEqual(['foo']);
    expect(cfg.pollIntervalSec).toBe(120);
    expect(cfg.lurkerProfilePath).toBe('C:/x');
  });

  it('merges partial writes with existing values', () => {
    const file = path.join(tmpDir, 'config.json');
    const store = new ConfigStore(file);
    store.write({ channels: ['a', 'b'] });
    store.write({ pollIntervalSec: 90 });
    const cfg = store.read();
    expect(cfg.channels).toEqual(['a', 'b']);
    expect(cfg.pollIntervalSec).toBe(90);
  });
});
