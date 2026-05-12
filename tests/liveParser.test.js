import { describe, it, expect } from 'vitest';
import { parseLiveState } from '../src/main/liveParser.js';

describe('parseLiveState', () => {
  it('returns "live" when isLiveBroadcast is true in JSON-LD', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          [{"@type":"VideoObject","publication":{"@type":"BroadcastEvent","isLiveBroadcast":true}}]
        </script>
      </head></html>`;
    expect(parseLiveState(html)).toBe('live');
  });

  it('returns "offline" when isLiveBroadcast is false', () => {
    const html = `
      <script type="application/ld+json">
        [{"@type":"VideoObject","publication":{"@type":"BroadcastEvent","isLiveBroadcast":false}}]
      </script>`;
    expect(parseLiveState(html)).toBe('offline');
  });

  it('returns "offline" when JSON-LD is missing entirely', () => {
    const html = '<html><body>No data</body></html>';
    expect(parseLiveState(html)).toBe('offline');
  });

  it('returns "offline" when JSON-LD is malformed', () => {
    const html = '<script type="application/ld+json">not json</script>';
    expect(parseLiveState(html)).toBe('offline');
  });

  it('returns "live" when wrapped in @graph (Twitch real shape)', () => {
    const html = `<script type="application/ld+json">{"@context":"http://schema.org","@graph":[{"@type":"VideoObject","publication":{"@type":"BroadcastEvent","isLiveBroadcast":true}}]}</script>`;
    expect(parseLiveState(html)).toBe('live');
  });

  it('returns "offline" when @graph wrapper has isLiveBroadcast=false', () => {
    const html = `<script type="application/ld+json">{"@context":"http://schema.org","@graph":[{"@type":"VideoObject","publication":{"isLiveBroadcast":false}}]}</script>`;
    expect(parseLiveState(html)).toBe('offline');
  });
});
