const https = require('https');
const { pool } = require('./db');

const CLUB_ID = '300701';
const CACHE_TTL_HOURS = 6;

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(JSON.parse(buf)));
    }).on('error', reject);
  });
}

async function getClubData() {
  try {
    const cached = await pool.query('SELECT data, updated_at FROM strava_cache WHERE key = $1', ['club']);
    if (cached.rows.length > 0) {
      const ageHours = (Date.now() - new Date(cached.rows[0].updated_at).getTime()) / 3_600_000;
      if (ageHours < CACHE_TTL_HOURS) return cached.rows[0].data;
    }

    const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
    if (!STRAVA_CLIENT_ID) return null;

    const tokenRes = await httpsPost('https://www.strava.com/api/v3/oauth/token', {
      client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN, grant_type: 'refresh_token',
    });
    if (!tokenRes.access_token) return null;

    const club = await httpsGet(`https://www.strava.com/api/v3/clubs/${CLUB_ID}`, tokenRes.access_token);

    await pool.query(
      `INSERT INTO strava_cache (key, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
      ['club', JSON.stringify(club)]
    );
    return club;
  } catch (err) {
    console.error('Strava-Fehler:', err.message);
    return null;
  }
}

module.exports = { getClubData };
