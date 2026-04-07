// updated
import { useState, useEffect, useRef } from "react";

const SPOTIFY_CLIENT_ID = "4fe85a947063486c9b7944fa708ebc47";
const SPOTIFY_REDIRECT_URI = "https://songsoundscape.netlify.app";
const SPOTIFY_SCOPES = "playlist-modify-private playlist-modify-public user-read-private";
const GOOGLE_CLIENT_ID = "261872841005-e6458onccnor8d5l9s39ct2ljilaeotf.apps.googleusercontent.com";
const YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube";

const GOOGLE_CLIENT_ID = '261872841005-e6458onccnor8d5l9s39ct2ljilaeotf.apps.googleusercontent.com';

const DEFAULT_PROFILE = `- CCM: 해외(Hillsong, Elevation, Chris Tomlin 등) + 국내 CCM, 상황에 따라 워십/잔잔한 것 모두
- 영화음악: 잔잔하고 밝은 계열, 너무 어둡거나 극적이지 않은 것
- 클래식: 드뷔시, 브람스, 차이코프스키, 라흐마니노프 / 백건우·조성진 같은 피아노 중심
- 공통 분위기: 선율이 아름답고, 감성적이지만 무겁지 않음. 영적이거나 서정적인 분위기`;

// ── YouTube Auth ────────────────────────────────────────
function getYouTubeAuthUrl() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: "https://songsoundscape.netlify.app",
    response_type: "token",
    scope: YOUTUBE_SCOPES,
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function parseYouTubeToken() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const state = params.get("state");
  if (token && state === "youtube") {
    const expiry = Date.now() + parseInt(params.get("expires_in") || "3600") * 1000;
    localStorage.setItem("yt_token", token);
    localStorage.setItem("yt_expiry", expiry);
    window.history.replaceState({}, "", window.location.pathname);
    return token;
  }
  return null;
}

function getStoredYTToken() {
  const token = localStorage.getItem("yt_token");
  const expiry = localStorage.getItem("yt_expiry");
  if (token && expiry && Date.now() < parseInt(expiry) - 60000) return token;
  localStorage.removeItem("yt_token");
  localStorage.removeItem("yt_expiry");
  return null;
}

// ── PKCE 헬퍼 ────────────────────────────────────────────
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getSpotifyAuthUrl() {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('sp_verifier', codeVerifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const codeVerifier = localStorage.getItem('sp_verifier');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    const expiry = Date.now() + data.expires_in * 1000;
    localStorage.setItem('sp_token', data.access_token);
    localStorage.setItem('sp_expiry', expiry);
    if (data.refresh_token) localStorage.setItem('sp_refresh', data.refresh_token);
    localStorage.removeItem('sp_verifier');
    return data.access_token;
  }
  return null;
}

async function refreshToken() {
  const refresh = localStorage.getItem('sp_refresh');
  if (!refresh) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    const expiry = Date.now() + data.expires_in * 1000;
    localStorage.setItem('sp_token', data.access_token);
    localStorage.setItem('sp_expiry', expiry);
    if (data.refresh_token) localStorage.setItem('sp_refresh', data.refresh_token);
    return data.access_token;
  }
  return null;
}

async function getValidToken() {
  const token = localStorage.getItem('sp_token');
  const expiry = localStorage.getItem('sp_expiry');
  if (token && expiry && Date.now() < parseInt(expiry) - 60000) return token;
  return await refreshToken();
}

// ── Spotify API ───────────────────────────────────────────
async function spotifyApi(action, token, params = {}) {
  const res = await fetch('/.netlify/functions/spotify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...params }),
  });
  return await res.json();
}

async function spotifySearch(token, query) {
  const data = await spotifyApi('search', token, { query });
  return data.tracks?.items?.[0]?.uri || null;
}

async function createSpotifyPlaylist(token, userId, title, description) {
  const data = await spotifyApi('createPlaylist', token, { userId, title, description });
  return data.id;
}

async function addTracksToPlaylist(token, playlistId, uris) {
  await spotifyApi('addTracks', token, { playlistId, uris });
}

async function getSpotifyUser(token) {
  return await spotifyApi('getUser', token);
}

// ── Claude AI 추천 ────────────────────────────────────────
async function fetchPlaylist({ profile, mood, context }) {
  const prompt = `당신은 음악 큐레이터입니다. 아래 사용자 취향 프로필과 오늘의 컨디션을 바탕으로 플레이리스트를 추천해주세요.

[취향 프로필]
${profile}

[오늘 컨디션/원하는 분위기]
${mood}${context ? `\n[추가 상황] ${context}` : ''}

다음 JSON 형식으로만 답하세요. 마크다운 코드블록 없이 순수 JSON만:
{"title":"플레이리스트 제목 (감성적인 한국어)","description":"한 줄 설명","tracks":[{"title":"곡명","artist":"아티스트명","reason":"이 곡을 고른 이유 한 문장"}]}

규칙:
- 트랙 8~10곡
- 반드시 Spotify와 YouTube에서 실제로 검색 가능한 곡만 추천
- 곡명과 아티스트명은 정확한 공식 표기를 사용 (예: "주님의 기도" by 옹기장이 같은 경우 Spotify에 없으면 추천하지 말 것)
- 한국 CCM은 멜론/지니에는 있어도 Spotify에 없는 경우가 많으니 주의
- 국내 CCM 추천 시 Spotify에 확실히 있는 아티스트만 (예: 마커스워십, 어노인팅, 소울다임 등)
- reason은 따뜻하게 한 문장으로`;

  const res = await fetch('/.netlify/functions/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function getYTMusicUrl(artist, title) {
  return `https://music.youtube.com/search?q=${encodeURIComponent(artist + ' ' + title)}`;
}
function getSpotifySearchUrl(artist, title) {
  return `https://open.spotify.com/search/${encodeURIComponent(artist + ' ' + title)}`;
}

// ── YouTube OAuth ────────────────────────────────────────
function getYouTubeAuthUrl() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: 'https://songsoundscape.netlify.app',
    response_type: 'token',
    scope: 'https://www.googleapis.com/auth/youtube',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function parseYouTubeToken() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = params.get('expires_in');
  if (token) {
    localStorage.setItem('yt_token', token);
    localStorage.setItem('yt_expiry', Date.now() + parseInt(expiresIn) * 1000);
    window.history.replaceState({}, '', window.location.pathname);
    return token;
  }
  return null;
}

function getStoredYTToken() {
  const token = localStorage.getItem('yt_token');
  const expiry = localStorage.getItem('yt_expiry');
  if (token && expiry && Date.now() < parseInt(expiry)) return token;
  localStorage.removeItem('yt_token');
  localStorage.removeItem('yt_expiry');
  return null;
}

// ── 메인 앱 ──────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('home');
  const [spToken, setSpToken] = useState(null);
  const [spUser, setSpUser] = useState(null);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [mood, setMood] = useState('');
  const [extra, setExtra] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playlist, setPlaylist] = useState(null);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState([]);
  const [profileSaved, setProfileSaved] = useState('');
  const [ytToken, setYtToken] = useState(null);
  const [ytSaving, setYtSaving] = useState(false);
  const [ytSaveMsg, setYtSaveMsg] = useState('');
  const moodRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      // YouTube token parse
      const ytTok = parseYouTubeToken();
      if (ytTok) setYtToken(ytTok);
      else {
        const stored = getStoredYTToken();
        if (stored) setYtToken(stored);
      }
      // URL에 code가 있으면 토큰 교환
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        window.history.replaceState({}, '', window.location.pathname);
        const token = await exchangeCodeForToken(code);
        if (token) {
          setSpToken(token);
          const user = await getSpotifyUser(token);
          setSpUser(user);
        }
      } else {
        // 저장된 토큰 확인
        const token = await getValidToken();
        if (token) {
          setSpToken(token);
          getSpotifyUser(token).then(u => setSpUser(u)).catch(() => {});
        }
      }
      // YouTube 토큰 확인
      const newYtToken = parseYouTubeToken();
      const ytStored = getStoredYTToken();
      if (newYtToken || ytStored) setYtToken(newYtToken || ytStored);

      const h = localStorage.getItem('pl_history');
      if (h) setHistory(JSON.parse(h));
      const p = localStorage.getItem('pl_profile');
      if (p) setProfile(p);
    };
    init();
  }, []);

  const loginSpotify = async () => {
    const url = await getSpotifyAuthUrl();
    window.location.href = url;
  };

  const logoutSpotify = () => {
    localStorage.removeItem('sp_token');
    localStorage.removeItem('sp_expiry');
    localStorage.removeItem('sp_refresh');
    localStorage.removeItem('sp_verifier');
    setSpToken(null);
    setSpUser(null);
  };

  const generate = async () => {
    if (!mood.trim()) return;
    setLoading(true); setError(''); setPlaylist(null);
    try {
      const result = await fetchPlaylist({ profile, mood, context: extra });
      setPlaylist(result);
      const entry = { ...result, date: new Date().toLocaleDateString('ko-KR'), mood };
      const h = [entry, ...history].slice(0, 20);
      setHistory(h);
      localStorage.setItem('pl_history', JSON.stringify(h));
      setScreen('result');
    } catch (e) {
      setError('플레이리스트 생성 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    }
    setLoading(false);
  };

  const loginYouTube = () => {
    window.location.href = getYouTubeAuthUrl();
  };

  const logoutYouTube = () => {
    localStorage.removeItem('yt_token');
    localStorage.removeItem('yt_expiry');
    setYtToken(null);
  };

  const saveToYouTube = async () => {
    if (!playlist || !ytToken) return;
    setYtSaving(true); setYtSaveMsg('');
    try {
      // 1. 플레이리스트 생성
      const plRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ytToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: { title: playlist.title, description: playlist.description },
          status: { privacyStatus: 'private' },
        }),
      });
      const plData = await plRes.json();
      if (!plData.id) throw new Error('플레이리스트 생성 실패');
      const playlistId = plData.id;

      // 2. 각 곡 검색 후 추가
      let added = 0;
      for (const t of playlist.tracks) {
        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(t.title + ' ' + t.artist)}&type=video&maxResults=1`,
          { headers: { Authorization: `Bearer ${ytToken}` } }
        );
        const searchData = await searchRes.json();
        const videoId = searchData.items?.[0]?.id?.videoId;
        if (videoId) {
          await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ytToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
            }),
          });
          added++;
        }
      }
      setYtSaveMsg(`✓ YouTube에 저장됐어요! (${added}곡)`);
    } catch (e) {
      setYtSaveMsg('저장 실패. 다시 시도해주세요.');
    }
    setYtSaving(false);
  };

  const saveToSpotify = async () => {
    if (!playlist) return;
    setSaving(true); setSaveMsg('');
    try {
      const token = await getValidToken();
      if (!token) { setSaveMsg('Spotify 재연결이 필요해요.'); setSaving(false); return; }
      setSpToken(token);
      const user = spUser || await getSpotifyUser(token);
      const uris = [];
      for (const t of playlist.tracks) {
        const uri = await spotifySearch(token, `${t.title} ${t.artist}`);
        if (uri) uris.push(uri);
      }
      if (uris.length === 0) throw new Error('검색된 곡이 없어요');
      const plId = await createSpotifyPlaylist(token, user.id, playlist.title, playlist.description);
      await addTracksToPlaylist(token, plId, uris);
      setSaveMsg(`✓ Spotify에 저장됐어요! (${uris.length}곡)`);
    } catch (e) {
      setSaveMsg('저장 실패. 다시 시도해주세요.');
    }
    setSaving(false);
  };

  const loginYouTube = () => {
    const url = getYouTubeAuthUrl() + "&state=youtube";
    window.location.href = url;
  };

  const logoutYouTube = () => {
    localStorage.removeItem("yt_token");
    localStorage.removeItem("yt_expiry");
    setYtToken(null);
  };

  const saveToYouTube = async () => {
    if (!ytToken || !playlist) return;
    setYtSaving(true); setYtSaveMsg('');
    try {
      // 1. 플레이리스트 생성
      const createRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ytToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: { title: playlist.title, description: playlist.description },
          status: { privacyStatus: 'private' }
        })
      });
      const createData = await createRes.json();
      if (!createData.id) throw new Error('플레이리스트 생성 실패');
      const playlistId = createData.id;

      // 2. 각 곡 검색 후 추가
      let added = 0;
      for (const t of playlist.tracks) {
        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(t.title + ' ' + t.artist)}&type=video&maxResults=1`,
          { headers: { Authorization: `Bearer ${ytToken}` } }
        );
        const searchData = await searchRes.json();
        const videoId = searchData.items?.[0]?.id?.videoId;
        if (videoId) {
          await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ytToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snippet: {
                playlistId,
                resourceId: { kind: 'youtube#video', videoId }
              }
            })
          });
          added++;
        }
      }
      setYtSaveMsg(`✓ YouTube에 저장됐어요! (${added}곡)`);
    } catch (e) {
      setYtSaveMsg('저장 실패. 다시 시도해주세요.');
    }
    setYtSaving(false);
  };

  const G = {
    bg: '#161412', bg2: '#1e1a15',
    gold: '#c4a478', gold2: '#a8865c',
    text: '#e8dcc8', muted: '#8a7a64',
    dim: '#6a5f4f', faint: '#4a3f2f',
    sp: '#1ed760', yt: '#ff4444',
  };

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Noto+Serif+KR:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    textarea,input{outline:none;}
    ::-webkit-scrollbar{width:3px;}
    ::-webkit-scrollbar-thumb{background:#4a3f2f;border-radius:2px;}
    @keyframes spin{to{transform:rotate(360deg);}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:translateY(0);}}
    .fu{animation:fadeUp 0.5s ease both;}
    .fu1{animation:fadeUp 0.5s ease 0.1s both;}
    .fu2{animation:fadeUp 0.5s ease 0.2s both;}
    .btn-gold{transition:all 0.25s;}
    .btn-gold:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 14px 36px rgba(196,164,120,0.32)!important;}
    .btn-outline:hover{border-color:rgba(196,164,120,0.5)!important;color:#c4a478!important;}
    .track:hover{background:rgba(196,164,120,0.08)!important;border-color:rgba(196,164,120,0.3)!important;}
    .hist:hover{background:rgba(196,164,120,0.07)!important;border-color:rgba(196,164,120,0.28)!important;}
    .nav-btn:hover{border-color:rgba(196,164,120,0.4)!important;}
    .sp-btn:hover{background:rgba(30,215,96,0.12)!important;}
    .yt-btn:hover{background:rgba(255,68,68,0.1)!important;}
  `;

  const NavBtn = ({ s, label }) => (
    <button className="nav-btn" onClick={() => setScreen(s)} style={{
      background: screen === s ? 'rgba(196,164,120,0.15)' : 'none',
      border: `1px solid ${screen === s ? 'rgba(196,164,120,0.45)' : 'rgba(196,164,120,0.14)'}`,
      borderRadius: '20px', padding: '6px 13px',
      color: screen === s ? G.gold : G.muted,
      fontSize: '12px', cursor: 'pointer',
      fontFamily: "'Noto Serif KR', serif",
      transition: 'all 0.2s', letterSpacing: '0.04em',
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(145deg,${G.bg} 0%,${G.bg2} 55%,${G.bg} 100%)`, color: G.text, fontFamily: "'Noto Serif KR',serif" }}>
      <style>{css}</style>

      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(196,164,120,0.1)' }}>
        <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Cormorant Garamond',serif", fontSize: '19px', fontWeight: 300, color: G.gold, letterSpacing: '0.1em' }}>
          ♪ Soundscape
        </button>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <NavBtn s="home" label="홈" />
          <NavBtn s="generate" label="오늘의 플리" />
          <NavBtn s="settings" label="설정" />
        </div>
      </nav>

      <div style={{ maxWidth: '620px', margin: '0 auto', padding: '0 18px 60px' }}>

        {screen === 'home' && (
          <div style={{ paddingTop: '52px', textAlign: 'center' }}>
            <p className="fu" style={{ fontSize: '10px', letterSpacing: '0.3em', color: G.faint, marginBottom: '16px' }}>AI MUSIC CURATOR</p>
            <h1 className="fu1" style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 'clamp(38px,9vw,58px)', fontWeight: 300, lineHeight: 1.2, marginBottom: '14px' }}>
              오늘의<br /><em style={{ color: G.gold, fontStyle: 'italic' }}>Soundscape</em>
            </h1>
            <p className="fu2" style={{ color: G.muted, fontSize: '14px', lineHeight: 1.9, marginBottom: '40px' }}>
              지금 이 순간의 컨디션을 말해주세요.<br />당신만을 위한 플레이리스트를 만들어드릴게요.
            </p>

            <div className="fu2" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              {spToken && spUser ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '8px 16px', borderRadius: '30px', border: '1px solid rgba(30,215,96,0.3)', background: 'rgba(30,215,96,0.06)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: G.sp, display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', color: G.sp }}>{spUser.display_name || spUser.id} (Spotify)</span>
                  <button onClick={logoutSpotify} style={{ background: 'none', border: 'none', color: G.dim, fontSize: '11px', cursor: 'pointer' }}>해제</button>
                </div>
              ) : (
                <button onClick={loginSpotify} style={{
                  background: G.sp, border: 'none', borderRadius: '30px',
                  padding: '10px 22px', color: '#000', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                }}>🎵 Spotify 연결하기</button>
              )}
              {ytToken ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '8px 16px', borderRadius: '30px', border: '1px solid rgba(255,0,0,0.3)', background: 'rgba(255,0,0,0.06)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ff0000', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', color: '#ff0000' }}>Google 계정 (YouTube)</span>
                  <button onClick={logoutYouTube} style={{ background: 'none', border: 'none', color: G.dim, fontSize: '11px', cursor: 'pointer' }}>해제</button>
                </div>
              ) : (
                <button onClick={loginYouTube} style={{
                  background: '#ff0000', border: 'none', borderRadius: '30px',
                  padding: '10px 22px', color: '#fff', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                }}>▶ YouTube 연결하기</button>
              )}
            </div>

            <button className="btn-gold" onClick={() => { setScreen('generate'); setTimeout(() => moodRef.current?.focus(), 100); }} style={{
              background: `linear-gradient(135deg,${G.gold},${G.gold2})`,
              border: 'none', borderRadius: '40px', padding: '15px 38px',
              color: G.bg, fontSize: '15px', fontFamily: "'Noto Serif KR',serif",
              fontWeight: 500, cursor: 'pointer', letterSpacing: '0.07em',
              boxShadow: '0 8px 26px rgba(196,164,120,0.2)',
            }}>오늘의 플리 만들기</button>

            {history.length > 0 && (
              <div style={{ marginTop: '56px', textAlign: 'left' }}>
                <p style={{ fontSize: '10px', letterSpacing: '0.25em', color: G.faint, marginBottom: '14px' }}>RECENT</p>
                {history.slice(0, 3).map((h, i) => (
                  <div key={i} className="hist" onClick={() => { setPlaylist(h); setScreen('result'); }} style={{
                    padding: '15px 18px', borderRadius: '12px',
                    border: '1px solid rgba(196,164,120,0.1)',
                    marginBottom: '7px', cursor: 'pointer',
                    background: 'rgba(196,164,120,0.03)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'all 0.2s',
                  }}>
                    <div>
                      <div style={{ fontSize: '14px', color: G.text, marginBottom: '3px' }}>{h.title}</div>
                      <div style={{ fontSize: '12px', color: G.dim }}>{h.mood}</div>
                    </div>
                    <div style={{ fontSize: '11px', color: G.faint }}>{h.date}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {screen === 'generate' && (
          <div className="fu" style={{ paddingTop: '42px' }}>
            <p style={{ fontSize: '10px', letterSpacing: '0.3em', color: G.faint, marginBottom: '8px' }}>TODAY'S PLAYLIST</p>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '28px', fontWeight: 300, color: G.text, marginBottom: '28px' }}>지금 어떠세요?</h2>

            <label style={{ fontSize: '11px', letterSpacing: '0.12em', color: G.muted, display: 'block', marginBottom: '7px' }}>컨디션 · 기분 · 원하는 분위기</label>
            <textarea ref={moodRef} value={mood} onChange={e => setMood(e.target.value)}
              placeholder={"예: 오늘 좀 피곤한데 잔잔하게 쉬고 싶어요\n예: 새벽에 혼자 기도하고 싶은 느낌\n예: 드라이브 중 감성적인 것"}
              style={{
                width: '100%', minHeight: '100px',
                background: 'rgba(196,164,120,0.06)',
                border: '1px solid rgba(196,164,120,0.18)',
                borderRadius: '12px', padding: '14px',
                color: G.text, fontSize: '14px',
                fontFamily: "'Noto Serif KR',serif",
                lineHeight: 1.8, resize: 'none', marginBottom: '14px',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(196,164,120,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(196,164,120,0.18)'}
            />

            <label style={{ fontSize: '11px', letterSpacing: '0.12em', color: G.muted, display: 'block', marginBottom: '7px' }}>추가 상황 (선택)</label>
            <input value={extra} onChange={e => setExtra(e.target.value)}
              placeholder="예: 작업 중, 산책 중, 예배 준비 중..."
              style={{
                width: '100%',
                background: 'rgba(196,164,120,0.06)',
                border: '1px solid rgba(196,164,120,0.18)',
                borderRadius: '12px', padding: '12px 14px',
                color: G.text, fontSize: '14px',
                fontFamily: "'Noto Serif KR',serif",
                marginBottom: '24px', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(196,164,120,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(196,164,120,0.18)'}
            />

            {error && <p style={{ color: '#c47a78', fontSize: '13px', marginBottom: '12px', lineHeight: 1.6 }}>{error}</p>}

            <button className="btn-gold" onClick={generate} disabled={loading || !mood.trim()} style={{
              width: '100%',
              background: loading || !mood.trim() ? 'rgba(196,164,120,0.1)' : `linear-gradient(135deg,${G.gold},${G.gold2})`,
              border: 'none', borderRadius: '40px', padding: '16px',
              color: loading || !mood.trim() ? G.faint : G.bg,
              fontSize: '15px', fontFamily: "'Noto Serif KR',serif",
              fontWeight: 500, cursor: loading || !mood.trim() ? 'not-allowed' : 'pointer',
              letterSpacing: '0.07em',
              boxShadow: '0 8px 26px rgba(196,164,120,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.25s',
            }}>
              {loading
                ? <><span style={{ width: '14px', height: '14px', border: '2px solid rgba(196,164,120,0.3)', borderTopColor: G.gold, borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />만드는 중...</>
                : '✦ 플레이리스트 생성'}
            </button>
          </div>
        )}

        {screen === 'result' && playlist && (
          <div className="fu" style={{ paddingTop: '42px' }}>
            <p style={{ fontSize: '10px', letterSpacing: '0.3em', color: G.faint, marginBottom: '8px' }}>YOUR PLAYLIST</p>
            <input
              value={playlist.title}
              onChange={e => setPlaylist(p => ({ ...p, title: e.target.value }))}
              style={{
                fontFamily: "'Cormorant Garamond',serif",
                fontSize: 'clamp(24px,5vw,34px)', fontWeight: 400,
                color: G.text, marginBottom: '4px', lineHeight: 1.3,
                background: 'none', border: 'none',
                borderBottom: '1px solid rgba(196,164,120,0.3)',
                width: '100%', padding: '4px 0', outline: 'none',
              }}
              onFocus={e => e.target.style.borderBottomColor = 'rgba(196,164,120,0.8)'}
              onBlur={e => e.target.style.borderBottomColor = 'rgba(196,164,120,0.3)'}
            />
            <p style={{ fontSize: '11px', color: G.faint, marginBottom: '8px' }}>✎ 제목을 수정할 수 있어요</p>
            <p style={{ color: G.dim, fontSize: '13px', marginBottom: '28px', lineHeight: 1.7 }}>{playlist.description}</p>

            {/* YouTube Music 저장 버튼 */}
            <div style={{ marginBottom: '24px' }}>
              {ytToken ? (
                <div>
                  <button className="btn-gold" onClick={saveToYouTube} disabled={ytSaving} style={{
                    background: ytSaving ? 'rgba(255,68,68,0.1)' : '#ff0000',
                    border: 'none', borderRadius: '30px', padding: '12px 24px',
                    color: ytSaving ? '#ff4444' : '#fff', fontSize: '13px',
                    fontWeight: 600, cursor: ytSaving ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    transition: 'all 0.25s',
                  }}>
                    {ytSaving
                      ? <><span style={{ width: '13px', height: '13px', border: '2px solid rgba(255,68,68,0.3)', borderTopColor: '#ff4444', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />YouTube에 저장 중...</>
                      : '▶ YouTube Music에 저장하기'}
                  </button>
                  {ytSaveMsg && <p style={{ fontSize: '13px', color: ytSaveMsg.includes('✓') ? '#1ed760' : '#c47a78', marginTop: '8px' }}>{ytSaveMsg}</p>}
                </div>
              ) : (
                <div style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(255,68,68,0.2)', background: 'rgba(255,68,68,0.04)' }}>
                  <p style={{ fontSize: '13px', color: G.dim, marginBottom: '10px' }}>Google 계정 연결하면 YouTube 플레이리스트에 자동 저장돼요!</p>
                  <button onClick={loginYouTube} style={{
                    background: '#ff0000', border: 'none', borderRadius: '20px',
                    padding: '8px 18px', color: '#fff', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                  }}>▶ Google 계정 연결</button>
                </div>
              )}
            </div>

            {playlist.tracks?.map((t, i) => (
              <div key={i} className="track" style={{
                padding: '14px 16px', borderRadius: '11px',
                border: '1px solid rgba(196,164,120,0.1)',
                marginBottom: '7px',
                background: 'rgba(196,164,120,0.04)',
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '10px', color: G.faint, marginRight: '7px' }}>{String(i+1).padStart(2,'0')}</span>
                    <span style={{ fontSize: '15px', color: G.text }}>{t.title}</span>
                    <span style={{ fontSize: '12px', color: G.muted, marginLeft: '5px' }}>— {t.artist}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '5px', flexShrink: 0, marginLeft: '8px', alignItems: 'center' }}>
                    <a href={getSpotifySearchUrl(t.artist, t.title)} target="_blank" rel="noopener noreferrer" className="sp-btn" style={{
                      fontSize: '10px', padding: '3px 8px', borderRadius: '20px',
                      border: '1px solid rgba(30,215,96,0.3)', color: G.sp,
                      textDecoration: 'none', transition: 'all 0.2s', whiteSpace: 'nowrap',
                    }}>Spotify</a>
                    <a href={getYTMusicUrl(t.artist, t.title)} target="_blank" rel="noopener noreferrer" className="yt-btn" style={{
                      fontSize: '10px', padding: '3px 8px', borderRadius: '20px',
                      border: '1px solid rgba(255,68,68,0.3)', color: G.yt,
                      textDecoration: 'none', transition: 'all 0.2s', whiteSpace: 'nowrap',
                    }}>YT</a>
                    <button onClick={() => setPlaylist(p => ({ ...p, tracks: p.tracks.filter((_, idx) => idx !== i) }))}
                      style={{
                        background: 'none', border: '1px solid rgba(196,164,120,0.2)',
                        borderRadius: '50%', width: '22px', height: '22px',
                        color: G.dim, cursor: 'pointer', fontSize: '12px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.target.style.borderColor = '#c47a78'; e.target.style.color = '#c47a78'; }}
                      onMouseLeave={e => { e.target.style.borderColor = 'rgba(196,164,120,0.2)'; e.target.style.color = G.dim; }}
                    >✕</button>
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: G.dim, lineHeight: 1.6, paddingLeft: '20px' }}>{t.reason}</p>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button className="btn-gold" onClick={() => { setMood(''); setExtra(''); setSaveMsg(''); setScreen('generate'); }} style={{
                flex: 1, background: `linear-gradient(135deg,${G.gold},${G.gold2})`,
                border: 'none', borderRadius: '40px', padding: '14px',
                color: G.bg, fontSize: '14px', fontFamily: "'Noto Serif KR',serif",
                fontWeight: 500, cursor: 'pointer',
              }}>새 플리 만들기</button>
              <button className="btn-outline" onClick={() => setScreen('home')} style={{
                flex: 1, background: 'none',
                border: '1px solid rgba(196,164,120,0.25)',
                borderRadius: '40px', padding: '14px',
                color: G.muted, fontSize: '14px',
                fontFamily: "'Noto Serif KR',serif", cursor: 'pointer',
                transition: 'all 0.2s',
              }}>홈으로</button>
            </div>
          </div>
        )}

        {screen === 'settings' && (
          <div className="fu" style={{ paddingTop: '42px' }}>
            <p style={{ fontSize: '10px', letterSpacing: '0.3em', color: G.faint, marginBottom: '8px' }}>SETTINGS</p>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '28px', fontWeight: 300, color: G.text, marginBottom: '24px' }}>내 음악 취향</h2>

            <textarea value={profile} onChange={e => setProfile(e.target.value)} style={{
              width: '100%', minHeight: '220px',
              background: 'rgba(196,164,120,0.06)',
              border: '1px solid rgba(196,164,120,0.18)',
              borderRadius: '12px', padding: '16px',
              color: G.text, fontSize: '13px',
              fontFamily: "'Noto Serif KR',serif",
              lineHeight: 1.9, resize: 'vertical',
              transition: 'border-color 0.2s',
            }}
              onFocus={e => e.target.style.borderColor = 'rgba(196,164,120,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(196,164,120,0.18)'}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
              <button className="btn-gold" onClick={() => { localStorage.setItem('pl_profile', profile); setProfileSaved('저장됐어요 ✓'); setTimeout(() => setProfileSaved(''), 2000); }} style={{
                background: `linear-gradient(135deg,${G.gold},${G.gold2})`,
                border: 'none', borderRadius: '30px', padding: '11px 26px',
                color: G.bg, fontSize: '14px', fontFamily: "'Noto Serif KR',serif",
                fontWeight: 500, cursor: 'pointer',
              }}>저장</button>
              {profileSaved && <span style={{ fontSize: '13px', color: G.gold }}>{profileSaved}</span>}
            </div>

            {/* YouTube 연결 */}
            <div style={{ marginTop: '32px', padding: '18px', borderRadius: '12px', border: '1px solid rgba(255,68,68,0.15)', background: 'rgba(255,68,68,0.03)' }}>
              <p style={{ fontSize: '11px', letterSpacing: '0.15em', color: G.muted, marginBottom: '12px' }}>YOUTUBE MUSIC</p>
              {ytToken ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff0000', display: 'inline-block' }} />
                    <span style={{ fontSize: '13px', color: '#ff0000' }}>Google 계정 연결됨</span>
                  </div>
                  <button onClick={logoutYouTube} style={{
                    background: 'none', border: '1px solid rgba(196,164,120,0.2)',
                    borderRadius: '20px', padding: '7px 16px',
                    color: G.dim, fontSize: '12px', cursor: 'pointer',
                  }}>연결 해제</button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '13px', color: G.dim, marginBottom: '12px', lineHeight: 1.7 }}>
                    연결하면 플레이리스트가 내 YouTube Music에 자동 저장돼요.
                  </p>
                  <button onClick={loginYouTube} style={{
                    background: '#ff0000', border: 'none', borderRadius: '25px',
                    padding: '10px 22px', color: '#fff', fontSize: '13px',
                    fontWeight: 600, cursor: 'pointer',
                  }}>▶ Google 연결하기</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
