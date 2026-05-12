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
});
