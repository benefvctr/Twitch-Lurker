const { EventEmitter } = require('events');
const { parseLiveState } = require('./liveParser.js');

class LiveDetector extends EventEmitter {
  constructor(channels, opts = {}) {
    super();
    this.channels = [...channels];
    this.intervalSec = opts.intervalSec ?? 60;
    this.jitterSec = opts.jitterSec ?? 10;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.state = new Map();   // channel -> 'live' | 'offline' | 'unknown'
    this.timers = new Map();
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    for (const ch of this.channels) {
      this.state.set(ch, 'unknown');
      this._scheduleNext(ch, 0);
    }
  }

  stop() {
    this._running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  setChannels(channels) {
    const wasRunning = this._running;
    this.stop();
    this.channels = [...channels];
    if (wasRunning) this.start();
  }

  getState(channel) {
    return this.state.get(channel) ?? 'unknown';
  }

  _scheduleNext(channel, delayMs) {
    const t = setTimeout(() => this._tick(channel), delayMs);
    this.timers.set(channel, t);
  }

  async _tick(channel) {
    if (!this._running) return;
    try {
      const res = await this.fetchFn(`https://www.twitch.tv/${channel}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const next = parseLiveState(html);
      const prev = this.state.get(channel);
      if (prev !== next) {
        this.state.set(channel, next);
        if (prev === 'unknown') {
          // Initial state: emit online once if live, but skip offline emit (no transition)
          if (next === 'live') this.emit('online', channel);
        } else {
          this.emit(next === 'live' ? 'online' : 'offline', channel);
        }
      }
    } catch (e) {
      // Only emit 'error' if there are listeners — bare EventEmitter throws on unhandled 'error'
      if (this.listenerCount('error') > 0) {
        this.emit('error', { channel, error: e });
      }
      // do not change state on failure
    }

    if (!this._running) return;
    const jitter = (Math.random() * 2 - 1) * this.jitterSec * 1000;
    const delay = Math.max(1000, this.intervalSec * 1000 + jitter);
    this._scheduleNext(channel, delay);
  }
}

module.exports = { LiveDetector };
