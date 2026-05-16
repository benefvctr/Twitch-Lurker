import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveDetector } from '../src/main/LiveDetector.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const liveHtml = '<script type="application/ld+json">[{"publication":{"isLiveBroadcast":true}}]</script>';
const offlineHtml = '<script type="application/ld+json">[{"publication":{"isLiveBroadcast":false}}]</script>';

function makeFetch(responses) {
  // responses: { 'channel': [html, html, ...] }  array consumed sequentially
  return vi.fn(async (url) => {
    const ch = url.split('/').pop();
    const next = responses[ch]?.shift();
    return { ok: true, text: async () => next ?? offlineHtml };
  });
}

describe('LiveDetector', () => {
  it('emits "online" when a channel transitions offline -> live', async () => {
    const fetchFn = makeFetch({ foo: [offlineHtml, liveHtml] });
    const det = new LiveDetector(['foo'], { intervalSec: 1, jitterSec: 0, fetchFn });
    const online = vi.fn();
    det.on('online', online);
    det.start();
    await vi.advanceTimersByTimeAsync(50);   // first tick (offline)
    expect(online).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); // second tick (live)
    expect(online).toHaveBeenCalledWith('foo');
    det.stop();
  });

  it('emits "offline" when a channel transitions live -> offline', async () => {
    const fetchFn = makeFetch({ foo: [liveHtml, offlineHtml] });
    const det = new LiveDetector(['foo'], { intervalSec: 1, jitterSec: 0, fetchFn });
    const offline = vi.fn();
    det.on('offline', offline);
    det.start();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(1000);
    expect(offline).toHaveBeenCalledWith('foo');
    det.stop();
  });

  it('does not flip state on a single fetch failure', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml });
    const det = new LiveDetector(['foo'], { intervalSec: 1, jitterSec: 0, fetchFn });
    const offline = vi.fn();
    det.on('offline', offline);
    det.start();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(offline).not.toHaveBeenCalled();
    det.stop();
  });

  it('resets state to unknown after 5 consecutive failures so next success can re-emit online', async () => {
    // Channel starts live, then 5 failures, then comes back live
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml })  // tick 0: live
      .mockRejectedValue(new Error('network'));  // ticks 1-5: fail
    const det = new LiveDetector(['foo'], { intervalSec: 1, jitterSec: 0, fetchFn });
    const online = vi.fn();
    const stateReset = vi.fn();
    det.on('online', online);
    det.on('state-reset', stateReset);
    det.start();
    // tick 0: becomes live
    await vi.advanceTimersByTimeAsync(50);
    expect(det.getState('foo')).toBe('live');

    // ticks 1-4: failures, state still live (< 5)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(det.getState('foo')).toBe('live');
    expect(stateReset).not.toHaveBeenCalled();

    // tick 5: 5th consecutive failure -> state reset to unknown
    await vi.advanceTimersByTimeAsync(1000);
    expect(det.getState('foo')).toBe('unknown');
    expect(stateReset).toHaveBeenCalledWith({ channel: 'foo', failCount: 5 });

    det.stop();
  });

  it('resets failure count on success so single failures do not accumulate', async () => {
    // Alternating: success (live), fail, success (live) — should never reach 5 consecutive
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, text: async () => liveHtml });
    const det = new LiveDetector(['foo'], { intervalSec: 1, jitterSec: 0, fetchFn });
    const stateReset = vi.fn();
    det.on('state-reset', stateReset);
    det.start();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(i === 0 ? 50 : 1000);
    }
    expect(stateReset).not.toHaveBeenCalled();
    expect(det.getState('foo')).toBe('live');
    det.stop();
  });
});
