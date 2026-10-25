// Returns my top artists, tracks and albums from Last.fm for a recent period (default: the past 7 days).
// Deploy as api/lastfm.js next to api/now-playing.js. Needs two environment variables:
//   LASTFM_API_KEY   an API key from https://www.last.fm/api/account/create
//   LASTFM_USERNAME  my Last.fm username

const PERIODS = ['7day', '1month', '3month', '6month', '12month', 'overall'];
const LIMIT = 5;

async function lastfm(method, user, period, apiKey) {
  const params = new URLSearchParams({ method, user, period, limit: String(LIMIT), api_key: apiKey, format: 'json' });
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
  const data = await r.json().catch(() => ({}));
  // Last.fm reports errors as { error: <code>, message: <text> }, sometimes with a 200 status
  if (!r.ok || data.error) throw new Error(`Last.fm ${method} failed: ${data.message || r.status}`);
  return data;
}

// Only ever pass on links that point at last.fm, so the page can trust them
function safeUrl(u) {
  return typeof u === 'string' && u.startsWith('https://www.last.fm/') ? u : '';
}

const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Top lists change slowly, so cache them for 10 minutes
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');

  const apiKey = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USERNAME;
  if (!apiKey || !user) {
    console.error('Missing Last.fm environment variables', { hasApiKey: !!apiKey, hasUser: !!user });
    return res.status(200).json({ available: false });
  }

  const period = PERIODS.includes(req.query && req.query.period) ? req.query.period : '7day';

  try {
    const [artists, tracks, albums] = await Promise.all([
      lastfm('user.gettopartists', user, period, apiKey),
      lastfm('user.gettoptracks', user, period, apiKey),
      lastfm('user.gettopalbums', user, period, apiKey),
    ]);

    return res.status(200).json({
      available: true,
      period,
      profileUrl: `https://www.last.fm/user/${encodeURIComponent(user)}`,
      artists: asList(artists.topartists && artists.topartists.artist).map((a) => ({
        name: a.name,
        plays: Number(a.playcount) || 0,
        url: safeUrl(a.url),
      })),
      tracks: asList(tracks.toptracks && tracks.toptracks.track).map((t) => ({
        name: t.name,
        artist: t.artist && t.artist.name,
        plays: Number(t.playcount) || 0,
        url: safeUrl(t.url),
      })),
      albums: asList(albums.topalbums && albums.topalbums.album).map((a) => ({
        name: a.name,
        artist: a.artist && a.artist.name,
        plays: Number(a.playcount) || 0,
        url: safeUrl(a.url),
      })),
    });
  } catch (error) {
    // Details go to the Vercel logs, not to whoever calls the API
    console.error(error);
    return res.status(200).json({ available: false });
  }
}
