// Returns my top artists, tracks and albums from Last.fm for a recent period (default: the past 7 days).
// Deploy as api/lastfm.js next to api/now-playing.js. Needs two environment variables:
//   LASTFM_API_KEY   an API key from https://www.last.fm/api/account/create
//   LASTFM_USERNAME  my Last.fm username
// It also uses SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (already set for now-playing) to look each
// artist, track and album up on Spotify, so the page can link to Spotify and show Spotify's pictures.
// If Spotify can't be reached, the lists still work, just without links and pictures.

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

// Only ever pass on links and pictures that point at Spotify, so the page can trust them
const safeUrl = (u) => (typeof u === 'string' && u.startsWith('https://open.spotify.com/') ? u : '');
const safeImage = (u) => (typeof u === 'string' && u.startsWith('https://i.scdn.co/') ? u : '');

// Spotify's search doesn't need me to be logged in, so a client-credentials token is enough
async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.access_token || null;
  } catch (e) {
    return null;
  }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Pick a picture that is sharp at about 44px on a 2x screen without being huge (usually the 300px one)
function pickImage(images) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i && i.url);
  const small = list.filter((i) => i.width >= 100).sort((a, b) => a.width - b.width)[0];
  return safeImage((small || list[0] || {}).url);
}

async function spotifySearch(token, q, type) {
  const r = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type, limit: '5' })}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const data = await r.json();
  return ((data[`${type}s`] && data[`${type}s`].items) || []).filter(Boolean);
}

// Finds one artist, track or album on Spotify. Only accepts a result whose names match, so a wrong guess shows nothing.
async function resolve(token, type, name, artist) {
  if (!token || !name) return {};
  try {
    const q = type === 'artist' ? name : `${type}:${name} artist:${artist || ''}`;
    let items = await spotifySearch(token, q, type);
    if (!items.length && type !== 'artist') items = await spotifySearch(token, `${name} ${artist || ''}`, type);
    const hit = items.find((it) =>
      type === 'artist'
        ? norm(it.name) === norm(name)
        : (it.artists || []).some((a) => norm(a.name) === norm(artist))
    );
    if (!hit) return {};
    return {
      url: safeUrl(hit.external_urls && hit.external_urls.spotify),
      image: pickImage(type === 'track' ? hit.album && hit.album.images : hit.images),
    };
  } catch (e) {
    return {};
  }
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

    const token = await spotifyToken();

    // Last.fm decides the ranking and play counts, Spotify supplies the links and pictures
    const withSpotify = (type, list) =>
      Promise.all(list.map(async (x) => ({ ...x, ...(await resolve(token, type, x.name, x.artist)) })));

    const [a, t, b] = await Promise.all([
      withSpotify('artist', asList(artists.topartists && artists.topartists.artist).map((x) => ({
        name: x.name,
        plays: Number(x.playcount) || 0,
      }))),
      withSpotify('track', asList(tracks.toptracks && tracks.toptracks.track).map((x) => ({
        name: x.name,
        artist: x.artist && x.artist.name,
        plays: Number(x.playcount) || 0,
      }))),
      withSpotify('album', asList(albums.topalbums && albums.topalbums.album).map((x) => ({
        name: x.name,
        artist: x.artist && x.artist.name,
        plays: Number(x.playcount) || 0,
      }))),
    ]);

    return res.status(200).json({
      available: true,
      period,
      profileUrl: `https://www.last.fm/user/${encodeURIComponent(user)}`,
      artists: a,
      tracks: t,
      albums: b,
    });
  } catch (error) {
    // Details go to the Vercel logs, not to whoever calls the API
    console.error(error);
    return res.status(200).json({ available: false });
  }
}