// Returns the track I'm currently playing, or the last track I played if nothing is playing.

async function getLastPlayed(access_token) {
  const r = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  // If the refresh token doesn't have the recently-played permission yet, this fails quietly
  if (!r.ok) return { isPlaying: false };

  const data = await r.json();
  const track = data.items && data.items[0] && data.items[0].track;
  if (!track) return { isPlaying: false };

  return {
    isPlaying: false,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    albumImageUrl: track.album.images[0].url,
    songUrl: track.external_urls.spotify,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate');

  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!client_id || !client_secret || !refresh_token) {
    // Details go to the Vercel logs, not to whoever calls the API
    console.error('Missing environment variables', {
      hasClientId: !!client_id,
      hasClientSecret: !!client_secret,
      hasRefreshToken: !!refresh_token,
    });
    return res.status(200).json({ isPlaying: false });
  }

  const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Token fetch failed', tokenData);
      return res.status(200).json({ isPlaying: false });
    }

    const access_token = tokenData.access_token;

    const spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // 204 = nothing playing right now
    if (spotifyResponse.status === 204) {
      return res.status(200).json(await getLastPlayed(access_token));
    }

    if (spotifyResponse.status > 400) {
      console.error('Spotify API rejected request', spotifyResponse.status, await spotifyResponse.text());
      return res.status(200).json(await getLastPlayed(access_token));
    }

    const songData = await spotifyResponse.json();

    // Podcasts, ads and local files don't have normal track data, so fall back to the last track
    if (!songData.item || songData.currently_playing_type !== 'track') {
      return res.status(200).json(await getLastPlayed(access_token));
    }

    return res.status(200).json({
      isPlaying: songData.is_playing,
      title: songData.item.name,
      artist: songData.item.artists.map((_artist) => _artist.name).join(', '),
      albumImageUrl: songData.item.album.images[0].url,
      songUrl: songData.item.external_urls.spotify,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch Spotify data' });
  }
}