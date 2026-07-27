#!/usr/bin/env node
/**
 * Holt aktuelle Strava-Club-Daten (RC ASVÖ Birkfeld, ID 300701)
 * und aktualisiert index.html.
 *
 * Setup:
 *   1. Strava App anlegen: https://www.strava.com/settings/api
 *   2. Einmalig den Refresh-Token besorgen (scope: read):
 *      https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read
 *      Dann: curl -X POST https://www.strava.com/api/v3/oauth/token \
 *              -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
 *              -d code=AUTH_CODE -d grant_type=authorization_code
 *   3. Umgebungsvariablen setzen:
 *      STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
 *
 * Lokal ausführen:
 *   STRAVA_CLIENT_ID=xxx STRAVA_CLIENT_SECRET=yyy STRAVA_REFRESH_TOKEN=zzz node scripts/update-strava.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CLUB_ID = '300701';
const HTML_FILE = path.join(__dirname, '..', 'index.html');

const SPORT_LABEL_MAP = {
  Ride: 'Rennrad',
  GravelRide: 'Gravel',
  MountainBikeRide: 'Mountainbike',
  EBikeRide: 'E-Bike',
  EMountainBikeRide: 'E-MTB',
  Handcycle: 'Handbike',
  Velomobile: 'Velomobil',
  VirtualRide: 'Rolle / Virtual',
};

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = new URLSearchParams(body).toString();
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({ hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function main() {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
    console.error('Fehlende Umgebungsvariablen: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN');
    process.exit(1);
  }

  // Access Token holen
  console.log('Hole Access Token...');
  const tokenRes = await httpsPost('https://www.strava.com/api/v3/oauth/token', {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    refresh_token: STRAVA_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const accessToken = tokenRes.access_token;
  if (!accessToken) { console.error('Token-Fehler:', tokenRes); process.exit(1); }

  // Club-Daten holen
  console.log('Hole Club-Daten...');
  const club = await httpsGet(`https://www.strava.com/api/v3/clubs/${CLUB_ID}`, accessToken);
  const memberCount = club.member_count;
  const sports = club.sport_type ? [club.sport_type] : [];
  console.log(`Club: ${club.name}, Mitglieder: ${memberCount}`);

  // HTML aktualisieren
  let html = fs.readFileSync(HTML_FILE, 'utf8');

  // Mitgliederzahl
  html = html.replace(
    /(<span class="num" data-strava="members">)\d+(<\/span>)/,
    `$1${memberCount}$2`
  );

  // Disziplinen-Anzahl (basierend auf den sports aus dem Club-Objekt)
  // Strava gibt bei /clubs/:id nur sport_type zurück, nicht sports[]
  // Wir behalten die manuelle sports-Liste und aktualisieren nur members
  console.log(`Aktualisiere Mitgliederzahl auf ${memberCount}.`);

  // Zeitstempel im Footer aktualisieren
  const now = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  html = html.replace(
    /<!-- strava-updated:.*?-->/,
    `<!-- strava-updated:${now} -->`
  );

  // Ersten strava-updated Kommentar einfügen falls noch nicht vorhanden
  if (!html.includes('strava-updated:')) {
    html = html.replace(
      'data-strava="sports">',
      `data-strava="sports"><!-- strava-updated:${now} -->`
    );
  }

  fs.writeFileSync(HTML_FILE, html, 'utf8');
  console.log(`✓ index.html aktualisiert (${now})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
