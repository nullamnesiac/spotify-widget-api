export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate');

  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN;

  // DEBUG: Check if Vercel is actually loading the variables
  if (!client_id || !client_secret || !refresh_token) {
    return res.status(200).json({ 
      isPlaying: false, 
      debug: "ENVIRONMENT VARIABLES MISSING", 
      hasClientId: !!client_id,
      hasClientSecret: !!client_secret,
      hasRefreshToken: !!refresh_token
    });
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
      return res.status(200).json({ isPlaying: false, debug: "Token fetch failed", error: tokenData });
    }

    const access_token = tokenData.access_token;

    const spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (spotifyResponse.status > 400) {
      const err = await spotifyResponse.text();
      return res.status(200).json({ isPlaying: false, debug: `Spotify API rejected request (Status ${spotifyResponse.status})`, error: err });
    }

    if (spotifyResponse.status === 204) {
      return res.status(200).json({ isPlaying: false, debug: "Status 204: Spotify says nothing is playing." });
    }

    const songData = await spotifyResponse.json();

    if (songData.item === null) {
      return res.status(200).json({ isPlaying: false, debug: "Song item is null (likely a podcast or local file)" });
    }

    return res.status(200).json({
      isPlaying: songData.is_playing,
      title: songData.item.name,
      artist: songData.item.artists.map((_artist) => _artist.name).join(', '),
      albumImageUrl: songData.item.album.images[0].url,
      songUrl: songData.item.external_urls.spotify,
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch Spotify data', details: error.message });
  }
}
