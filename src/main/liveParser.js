// Parse Twitch channel page HTML for live state.
// Returns 'live' or 'offline'.
// Uses JSON-LD <script type="application/ld+json"> which Twitch embeds for SEO.
function parseLiveState(html) {
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    try {
      const data = JSON.parse(m[1]);
      // Twitch wraps in { "@context": ..., "@graph": [...] }; also handle bare arrays / objects
      const items = data?.['@graph'] ?? (Array.isArray(data) ? data : [data]);
      for (const item of items) {
        const pub = item?.publication;
        if (pub?.isLiveBroadcast === true) return 'live';
      }
    } catch { /* try next script */ }
  }
  return 'offline';
}

module.exports = { parseLiveState };
