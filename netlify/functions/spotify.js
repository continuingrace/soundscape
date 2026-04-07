exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { action, token, ...params } = JSON.parse(event.body);

  if (action === 'getUser') {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'createPlaylist') {
    const res = await fetch(`https://api.spotify.com/v1/users/${params.userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: params.title, description: params.description, public: false }),
    });
    const data = await res.json();
    return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'addTracks') {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${params.playlistId}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: params.uris }),
    });
    const data = await res.json();
    return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'search') {
    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(params.query)}&type=track&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  return { statusCode: 400, body: 'Unknown action' };
};
