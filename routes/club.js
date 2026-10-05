const express = require('express');
const router = express.Router();
const multer = require('multer');
const passport = require('../lib/passport');
const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');
const { getClubActivities, getSegmentLeaderboard, refreshAthleteToken, exchangeAthleteCode, getAthleteActivities } = require('../lib/strava');

const uploadFeed = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nur JPG, PNG, WebP oder GIF'));
  },
});

const AVATAR_COLORS = ['#1F7A34','#1565C0','#7B1FA2','#E65100','#00838F','#C62828'];
function avatarColor(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  return String(name).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
const helpers = { avatarColor, initials };

function requireMember(req, res, next) {
  if (req.session.memberName) return next();
  res.redirect('/club/login');
}

router.post('/upload-image', requireMember, uploadFeed.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  res.json({ url: b64 });
});

/* ── LOGIN / LOGOUT ── */
router.get('/login', (req, res) => {
  if (req.session.memberName) return res.redirect('/club');
  res.render('club/login', {
    error: req.query.error === 'google' ? 'Google-Anmeldung fehlgeschlagen.' : null,
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/club/login'));
});

/* ── REGISTER / EMAIL LOGIN ── */
router.get('/register', (req, res) => {
  if (req.session.memberName) return res.redirect('/club');
  res.render('club/register', { error: null });
});

router.post('/register', async (req, res, next) => {
  const name  = (req.body.name  || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const pass  = req.body.password || '';
  const pass2 = req.body.password2 || '';
  if (name.length < 2 || !email.includes('@') || pass.length < 6) {
    return res.render('club/register', { error: 'Bitte alle Felder korrekt ausfüllen (Passwort mind. 6 Zeichen).' });
  }
  if (pass !== pass2) {
    return res.render('club/register', { error: 'Passwörter stimmen nicht überein.' });
  }
  try {
    const [existing] = await pool.query('SELECT id FROM club_members_auth WHERE email=?', [email]);
    if (existing.length) return res.render('club/register', { error: 'Diese E-Mail ist bereits registriert.' });
    const hash = await bcrypt.hash(pass, 10);
    await pool.query('INSERT INTO club_members_auth (name, email, password_hash) VALUES (?,?,?)', [name, email, hash]);
    req.session.memberName = name;
    res.redirect('/club');
  } catch (err) { next(err); }
});

router.post('/login/email', async (req, res, next) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const pass  = req.body.password || '';
  try {
    const [rows] = await pool.query('SELECT * FROM club_members_auth WHERE email=?', [email]);
    if (!rows.length || !(await bcrypt.compare(pass, rows[0].password_hash))) {
      return res.render('club/login', { error: 'E-Mail oder Passwort falsch.', googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
    }
    req.session.memberName = rows[0].name;
    res.redirect('/club');
  } catch (err) { next(err); }
});

/* ── OAUTH ── */
router.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/club/login?error=google');
  passport.authenticate('google', { session: false, scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false, failureRedirect: '/club/login?error=google' }, (err, profile) => {
    if (err || !profile) return res.redirect('/club/login?error=google');
    handleOAuthProfile(req, res, next, profile);
  })(req, res, next);
});

async function handleOAuthProfile(req, res, next, profile) {
  try {
    const provider = profile.provider;
    const providerId = String(profile.id);
    const name = profile.displayName || (profile.emails && profile.emails[0].value.split('@')[0]) || 'Mitglied';
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

    const [rows] = await pool.query(
      'SELECT member_name FROM club_oauth WHERE provider=? AND provider_id=?',
      [provider, providerId]
    );

    if (rows.length) {
      req.session.memberName = rows[0].member_name;
    } else {
      await pool.query(
        'INSERT IGNORE INTO club_oauth (provider, provider_id, member_name, email) VALUES (?,?,?,?)',
        [provider, providerId, name, email]
      );
      req.session.memberName = name;
    }
    res.redirect('/club');
  } catch (err) { next(err); }
}

/* ── FEED ── */
router.get('/api/feed', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, mp.avatar_url AS author_avatar
      FROM club_posts p
      LEFT JOIN club_member_profiles mp ON mp.member_name = p.author
      ORDER BY p.created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/api/birthdays', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT member_name, birthday FROM club_member_profiles
       WHERE birthday IS NOT NULL
       ORDER BY DATE_FORMAT(birthday, '%m-%d') ASC`
    );
    const today = new Date();
    const todayMD = (today.getMonth() + 1) * 100 + today.getDate();
    const upcoming = rows.map(r => {
      const b = new Date(r.birthday);
      const md = (b.getMonth() + 1) * 100 + b.getDate();
      const diff = md >= todayMD ? md - todayMD : 10000 + md - todayMD;
      return { name: r.member_name, birthday: r.birthday, diff, day: b.getDate(), month: b.getMonth() + 1 };
    }).sort((a, b) => a.diff - b.diff).slice(0, 5);
    res.json(upcoming);
  } catch (err) { next(err); }
});

router.get('/', requireMember, async (req, res, next) => {
  try {
    const [[profileRows]] = await pool.query('SELECT avatar_url FROM club_member_profiles WHERE member_name=?', [req.session.memberName]);
    res.render('club/feed', { ...helpers, memberName: req.session.memberName, page: 'feed', myAvatar: profileRows ? profileRows.avatar_url : null });
  } catch (err) { next(err); }
});

router.post('/post', requireMember, async (req, res, next) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.json({ ok: false });
  try {
    await pool.query('INSERT INTO club_posts (author, content, image_url) VALUES (?,?,?)',
      [req.session.memberName, content, req.body.image_url || null]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/post/:id/delete', requireMember, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_posts WHERE id=? AND author=?', [req.params.id, req.session.memberName]);
    res.redirect('/club');
  } catch (err) { next(err); }
});

/* ── TERMINE ── */
router.get('/termine', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*,
        COALESCE(SUM(r.status='yes'),0) AS yes_count,
        COALESCE(SUM(r.status='no'),0)  AS no_count,
        GROUP_CONCAT(CASE WHEN r.status='yes' THEN r.member_name END ORDER BY r.updated_at SEPARATOR ',') AS yes_names,
        GROUP_CONCAT(CASE WHEN r.status='no'  THEN r.member_name END ORDER BY r.updated_at SEPARATOR ',') AS no_names,
        MAX(CASE WHEN r.member_name=? THEN r.status END) AS my_status
      FROM termine t
      LEFT JOIN event_rsvp r ON t.id = r.termine_id
      WHERE t.date >= CURDATE()
      GROUP BY t.id
      ORDER BY t.date ASC
    `, [req.session.memberName]);
    const termine = rows.map(t => ({
      ...t,
      yes_names: t.yes_names ? t.yes_names.split(',').filter(Boolean) : [],
      no_names:  t.no_names  ? t.no_names.split(',').filter(Boolean)  : [],
    }));
    res.render('club/termine', { ...helpers, memberName: req.session.memberName, termine, page: 'termine' });
  } catch (err) { next(err); }
});

router.post('/rsvp/:id', requireMember, async (req, res, next) => {
  const status = req.body.status;
  if (!['yes', 'no'].includes(status)) return res.redirect('/club/termine');
  try {
    await pool.query(
      'INSERT INTO event_rsvp (termine_id, member_name, status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE status=?',
      [req.params.id, req.session.memberName, status, status]
    );
    const redirect = req.query.redirect || '/club/termine';
    res.redirect(redirect);
  } catch (err) { next(err); }
});

/* ── KALENDER ── */
router.get('/kalender', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM termine ORDER BY date ASC');
    res.render('club/kalender', { ...helpers, memberName: req.session.memberName, termine: rows, page: 'kalender' });
  } catch (err) { next(err); }
});

/* ── ROUTEN ── */
router.get('/routen', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM club_routes ORDER BY created_at DESC');
    res.render('club/routen', { ...helpers, memberName: req.session.memberName, routen: rows, page: 'routen' });
  } catch (err) { next(err); }
});

router.post('/routen', requireMember, async (req, res, next) => {
  const name        = (req.body.name        || '').trim().slice(0, 200);
  const distance_km = parseFloat(req.body.distance_km) || null;
  const elevation_m = parseInt(req.body.elevation_m)   || null;
  const difficulty  = ['leicht','mittel','schwer'].includes(req.body.difficulty) ? req.body.difficulty : 'mittel';
  const description = (req.body.description || '').trim() || null;
  const link_url    = (req.body.link_url    || '').trim() || null;
  if (!name) return res.redirect('/club/routen');
  try {
    await pool.query(
      'INSERT INTO club_routes (author, name, distance_km, elevation_m, difficulty, description, link_url) VALUES (?,?,?,?,?,?,?)',
      [req.session.memberName, name, distance_km, elevation_m, difficulty, description, link_url]
    );
    res.redirect('/club/routen');
  } catch (err) { next(err); }
});

router.post('/routen/:id/delete', requireMember, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_routes WHERE id=? AND author=?', [req.params.id, req.session.memberName]);
    res.redirect('/club/routen');
  } catch (err) { next(err); }
});

/* ── MARKTPLATZ ── */
router.get('/marktplatz', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM club_marktplatz ORDER BY sold ASC, created_at DESC');
    res.render('club/marktplatz', { ...helpers, memberName: req.session.memberName, inserate: rows, page: 'marktplatz' });
  } catch (err) { next(err); }
});

router.post('/marktplatz', requireMember, async (req, res, next) => {
  const title       = (req.body.title || '').trim().slice(0, 200);
  const description = (req.body.description || '').trim() || null;
  const price       = parseFloat(req.body.price) || null;
  const contact     = (req.body.contact || '').trim().slice(0, 200) || null;
  const image_url   = req.body.image_url || null;
  if (!title) return res.redirect('/club/marktplatz');
  try {
    await pool.query(
      'INSERT INTO club_marktplatz (author, title, description, price, contact, image_url) VALUES (?,?,?,?,?,?)',
      [req.session.memberName, title, description, price, contact, image_url]
    );
    res.redirect('/club/marktplatz');
  } catch (err) { next(err); }
});

router.post('/marktplatz/:id/sold', requireMember, async (req, res, next) => {
  try {
    await pool.query('UPDATE club_marktplatz SET sold=1 WHERE id=? AND author=?', [req.params.id, req.session.memberName]);
    res.redirect('/club/marktplatz');
  } catch (err) { next(err); }
});

router.post('/marktplatz/:id/delete', requireMember, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_marktplatz WHERE id=? AND author=?', [req.params.id, req.session.memberName]);
    res.redirect('/club/marktplatz');
  } catch (err) { next(err); }
});

/* ── POLLS ── */
router.get('/polls', requireMember, async (req, res, next) => {
  try {
    const [polls] = await pool.query(
      'SELECT * FROM club_polls WHERE active=1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 10'
    );
    const [votes] = await pool.query(
      'SELECT poll_id, option_idx FROM club_poll_votes WHERE member_name=?',
      [req.session.memberName]
    );
    const myVotes = {};
    votes.forEach(v => { myVotes[v.poll_id] = v.option_idx; });

    const pollIds = polls.map(p => p.id);
    let voteCounts = {};
    if (pollIds.length) {
      const [counts] = await pool.query(
        'SELECT poll_id, option_idx, COUNT(*) AS cnt FROM club_poll_votes WHERE poll_id IN (?) GROUP BY poll_id, option_idx',
        [pollIds]
      );
      counts.forEach(c => {
        if (!voteCounts[c.poll_id]) voteCounts[c.poll_id] = {};
        voteCounts[c.poll_id][c.option_idx] = c.cnt;
      });
    }

    res.render('club/polls', { ...helpers, memberName: req.session.memberName, polls, myVotes, voteCounts, page: 'polls' });
  } catch (err) { next(err); }
});

router.post('/polls/:id/vote', requireMember, async (req, res, next) => {
  const optionIdx = parseInt(req.body.option_idx);
  if (isNaN(optionIdx)) return res.redirect('/club/polls');
  try {
    const [rows] = await pool.query('SELECT options FROM club_polls WHERE id=? AND active=1', [req.params.id]);
    if (!rows.length) return res.redirect('/club/polls');
    const options = rows[0].options;
    if (optionIdx < 0 || optionIdx >= options.length) return res.redirect('/club/polls');
    await pool.query(
      'INSERT INTO club_poll_votes (poll_id, member_name, option_idx) VALUES (?,?,?) ON DUPLICATE KEY UPDATE option_idx=VALUES(option_idx), voted_at=NOW()',
      [req.params.id, req.session.memberName, optionIdx]
    );
    res.redirect('/club/polls');
  } catch (err) { next(err); }
});

/* ── TRAININGSPLAN ── */
router.get('/trainingsplan', requireMember, async (req, res, next) => {
  try {
    const memberName = req.session.memberName;
    const [rows] = await pool.query('SELECT * FROM club_trainingsplan ORDER BY week_start DESC LIMIT 8');
    const [myPlans] = await pool.query(
      'SELECT * FROM club_ai_trainingsplan WHERE member_name=? ORDER BY created_at DESC LIMIT 10', [memberName]
    );
    const [stravaTok] = await pool.query('SELECT athlete_name FROM club_strava_tokens WHERE member_name=?', [memberName]);
    const stravaConnected = stravaTok.length > 0 ? stravaTok[0] : null;
    res.render('club/trainingsplan', { ...helpers, memberName, plaene: rows, myPlans, stravaConnected, page: 'trainingsplan' });
  } catch (err) { next(err); }
});

/* Strava OAuth for individual members */
router.get('/strava/connect', requireMember, (req, res) => {
  const base = process.env.BASE_URL || 'https://www.rc-birkfeld.at';
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${base}/club/strava/callback`,
    approval_prompt: 'auto',
    scope: 'read,activity:read',
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

router.get('/strava/callback', requireMember, async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/club/trainingsplan?strava=error');
    const token = await exchangeAthleteCode(code);
    if (!token.access_token) return res.redirect('/club/trainingsplan?strava=error');
    const athleteName = token.athlete ? `${token.athlete.firstname} ${token.athlete.lastname}`.trim() : '';
    await pool.query(
      `INSERT INTO club_strava_tokens (member_name, athlete_id, athlete_name, access_token, refresh_token, expires_at)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE athlete_id=VALUES(athlete_id), athlete_name=VALUES(athlete_name),
       access_token=VALUES(access_token), refresh_token=VALUES(refresh_token), expires_at=VALUES(expires_at), updated_at=CURRENT_TIMESTAMP`,
      [req.session.memberName, token.athlete?.id || 0, athleteName, token.access_token, token.refresh_token, token.expires_at || 0]
    );
    res.redirect('/club/trainingsplan?tab=ai&strava=ok');
  } catch (err) {
    console.error('Strava callback error:', err.message);
    res.redirect('/club/trainingsplan?strava=error');
  }
});

router.post('/strava/disconnect', requireMember, async (req, res) => {
  await pool.query('DELETE FROM club_strava_tokens WHERE member_name=?', [req.session.memberName]);
  res.redirect('/club/trainingsplan?tab=ai');
});

router.post('/trainingsplan/ai-chat', requireMember, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'No messages' });

    // Build Strava context if connected
    let stravaContext = '';
    const [tokRows] = await pool.query('SELECT * FROM club_strava_tokens WHERE member_name=?', [req.session.memberName]);
    if (tokRows.length > 0) {
      let tok = tokRows[0];
      if (tok.expires_at < Math.floor(Date.now() / 1000) + 60) {
        const refreshed = await refreshAthleteToken(tok.refresh_token);
        if (refreshed.access_token) {
          await pool.query(
            'UPDATE club_strava_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE member_name=?',
            [refreshed.access_token, refreshed.refresh_token, refreshed.expires_at, req.session.memberName]
          );
          tok.access_token = refreshed.access_token;
        }
      }
      const activities = await getAthleteActivities(tok.access_token, 4);
      if (activities.length > 0) {
        const lines = activities.slice(0, 10).map(a => {
          const d = new Date(a.start_date_local).toLocaleDateString('de-AT', {weekday:'short',day:'2-digit',month:'2-digit'});
          const km = (a.distance / 1000).toFixed(1);
          const hm = Math.round(a.total_elevation_gain);
          const min = Math.round(a.moving_time / 60);
          const h = Math.floor(min / 60), m = min % 60;
          return `- ${d}: ${a.name}, ${km}km, ${hm}hm, ${h}h${m > 0 ? m + 'min' : ''}`;
        }).join('\n');
        stravaContext = `\n\nSTRAVA-AKTIVITÄTEN (letzte 4 Wochen):\n${lines}\nNutze diese Daten um den Plan auf das tatsächliche Niveau und die Belastung abzustimmen.`;
      }
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Normalize messages — content can be string or array (with images)
    const normalized = messages.slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      system: `Du bist der persönliche Trainingscoach des RC ASVÖ Birkfeld, einem österreichischen Radsportverein aus dem Joglland.

DEINE AUFGABE: Erstelle einen maßgeschneiderten Wochentrainingsplan für das Mitglied.

GESPRÄCHSABLAUF:
- Stelle maximal 4-5 kurze, präzise Fragen um das Profil zu verstehen
- Frage nach: Hauptziel, Disziplin (Rennrad/MTB/Gravel/Mix), Trainingstage pro Woche, Niveau (Einsteiger/Fortgeschritten/Wettkampf), nächstes Event
- Falls Strava-Daten vorhanden sind, nutze sie direkt — frage nicht mehr nach aktuellem Niveau
- Falls ein Foto/Screenshot geteilt wird, analysiere es und beziehe es ein
- Sobald du genug Infos hast, erstelle den Plan direkt

WENN DU DEN PLAN PRÄSENTIERST, nutze EXAKT dieses Format:

---TRAININGSPLAN---
**Titel:** [Prägnanter Plantitel]
**Ziel:** [Kurzzusammenfassung in einem Satz]

**Mo:** [Einheit oder Ruhetag]
**Di:** [Einheit oder Ruhetag]
**Mi:** [Einheit oder Ruhetag]
**Do:** [Einheit oder Ruhetag]
**Fr:** [Einheit oder Ruhetag]
**Sa:** [Einheit — Clubausfahrt 13:00 Uhr ab Friesis Bikery einplanen]
**So:** [Einheit oder Ruhetag]

**Tipps:** [2-3 prägnante Tipps]
---ENDE---

STIL: Direkt, motivierend, knapp. Österreichisches Flair.
SPRACHE: Deutsch${stravaContext}`,
      messages: normalized
    });
    res.json({ content: response.content[0].text });
  } catch (err) {
    console.error('AI chat error:', err.message);
    res.status(500).json({ error: 'KI nicht erreichbar. Bitte ANTHROPIC_API_KEY prüfen.' });
  }
});

router.post('/trainingsplan/ai-save', requireMember, async (req, res) => {
  try {
    const { title, goal, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Fehlende Daten' });
    await pool.query(
      'INSERT INTO club_ai_trainingsplan (member_name, title, goal, content) VALUES (?,?,?,?)',
      [req.session.memberName, title.substring(0, 200), (goal||'').substring(0, 500), content]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trainingsplan/ai-delete/:id', requireMember, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM club_ai_trainingsplan WHERE id=? AND member_name=?',
      [req.params.id, req.session.memberName]
    );
    res.redirect('/club/trainingsplan');
  } catch (err) { res.redirect('/club/trainingsplan'); }
});

/* ── CHALLENGE ── */
router.get('/challenge', requireMember, async (req, res, next) => {
  try {
    const [challenges] = await pool.query('SELECT * FROM club_challenges WHERE active=1 ORDER BY created_at DESC LIMIT 1');
    const challenge = challenges[0] || null;
    let leaderboard = [];
    if (challenge && challenge.segment_id) {
      leaderboard = await getSegmentLeaderboard(challenge.segment_id);
    }
    res.render('club/challenge', { ...helpers, memberName: req.session.memberName, challenge, leaderboard, page: 'challenge' });
  } catch (err) { next(err); }
});

/* ── PROFIL ── */
router.get('/profil', requireMember, (req, res) => {
  res.redirect('/club/profil/' + encodeURIComponent(req.session.memberName));
});

router.get('/profil/:name', requireMember, async (req, res, next) => {
  try {
    const profileName = decodeURIComponent(req.params.name);
    const [[profileRows], [posts]] = await Promise.all([
      pool.query('SELECT * FROM club_member_profiles WHERE member_name=?', [profileName]),
      pool.query('SELECT * FROM club_posts WHERE author=? ORDER BY created_at DESC', [profileName]),
    ]);
    const profile = profileRows[0] || null;

    let stravaActivities = [];
    if (profile && profile.strava_athlete_id) {
      const all = await getClubActivities();
      stravaActivities = all
        .filter(a => a.athlete && String(a.athlete.id) === String(profile.strava_athlete_id))
        .slice(0, 10);
    }

    res.render('club/profil', {
      ...helpers,
      memberName: req.session.memberName,
      profileName,
      profile,
      posts,
      stravaActivities,
      isOwnProfile: req.session.memberName === profileName,
      page: 'profil',
    });
  } catch (err) { next(err); }
});

router.post('/profil/edit', requireMember, async (req, res, next) => {
  const bio        = (req.body.bio || '').trim().slice(0, 300);
  const avatar_url = req.body.avatar_url || null;
  const bike_url   = req.body.bike_url   || null;
  const bike_brand = (req.body.bike_brand || '').trim().slice(0, 100) || null;
  const bike_model = (req.body.bike_model || '').trim().slice(0, 100) || null;
  const bike_size  = (req.body.bike_size  || '').trim().slice(0, 20)  || null;
  const rawStrava  = (req.body.strava_athlete_id || '').trim();
  const stravaMatch = rawStrava.match(/athletes\/(\d+)/);
  const strava_athlete_id = stravaMatch ? stravaMatch[1] : (rawStrava.match(/^\d+$/) ? rawStrava : null);
  const birthday = req.body.birthday || null;
  try {
    await pool.query(
      `INSERT INTO club_member_profiles (member_name, bio, avatar_url, bike_url, bike_brand, bike_model, bike_size, strava_athlete_id, birthday)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE bio=VALUES(bio), avatar_url=VALUES(avatar_url), bike_url=VALUES(bike_url),
         bike_brand=VALUES(bike_brand), bike_model=VALUES(bike_model), bike_size=VALUES(bike_size),
         strava_athlete_id=VALUES(strava_athlete_id), birthday=VALUES(birthday)`,
      [req.session.memberName, bio, avatar_url, bike_url, bike_brand, bike_model, bike_size, strava_athlete_id, birthday]
    );
    res.redirect('/club/profil/' + encodeURIComponent(req.session.memberName));
  } catch (err) { next(err); }
});

/* ── CHAT ── */
router.get('/chat', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, mp.avatar_url AS author_avatar
      FROM club_chat c
      LEFT JOIN club_member_profiles mp ON mp.member_name = c.author
      ORDER BY c.created_at ASC LIMIT 200
    `);
    res.render('club/chat', { ...helpers, memberName: req.session.memberName, chat: rows, page: 'chat' });
  } catch (err) { next(err); }
});

router.get('/chat/poll', requireMember, async (req, res, next) => {
  try {
    const after = parseInt(req.query.after) || 0;
    const [rows] = await pool.query(`
      SELECT c.*, mp.avatar_url AS author_avatar
      FROM club_chat c
      LEFT JOIN club_member_profiles mp ON mp.member_name = c.author
      WHERE c.id > ? ORDER BY c.created_at ASC LIMIT 50
    `, [after]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/chat', requireMember, async (req, res, next) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.redirect('/club/chat');
  try {
    await pool.query('INSERT INTO club_chat (author, content) VALUES (?,?)', [req.session.memberName, content]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── GRUPPENFAHRTEN ── */
router.get('/gruppenfahrten', requireMember, async (req, res, next) => {
  try {
    const memberName = req.session.memberName;
    const [fahrten] = await pool.query(
      `SELECT f.*,
        (SELECT COUNT(*) FROM club_gruppenfahrt_rsvp r WHERE r.fahrt_id=f.id) AS rider_count,
        (SELECT GROUP_CONCAT(r.member_name ORDER BY r.joined_at SEPARATOR '||') FROM club_gruppenfahrt_rsvp r WHERE r.fahrt_id=f.id) AS riders
       FROM club_gruppenfahrten f
       ORDER BY f.ride_date ASC`
    );
    const now = new Date();
    const upcoming = fahrten.filter(f => new Date(f.ride_date) >= now);
    const past     = fahrten.filter(f => new Date(f.ride_date) <  now).reverse();
    res.render('club/gruppenfahrten', { ...helpers, memberName, upcoming, past, page: 'gruppenfahrten' });
  } catch (err) { next(err); }
});

router.post('/gruppenfahrten', requireMember, async (req, res, next) => {
  try {
    const { title, ride_date, ride_time, meeting_point, distance_km, elevation_m, description, max_riders } = req.body;
    const dt = ride_date && ride_time ? `${ride_date} ${ride_time}:00` : ride_date;
    await pool.query(
      'INSERT INTO club_gruppenfahrten (author, title, ride_date, meeting_point, distance_km, elevation_m, description, max_riders) VALUES (?,?,?,?,?,?,?,?)',
      [req.session.memberName, title, dt, meeting_point||null, distance_km||null, elevation_m||null, description||null, max_riders||null]
    );
    res.redirect('/club/gruppenfahrten');
  } catch (err) { next(err); }
});

router.post('/gruppenfahrten/:id/join', requireMember, async (req, res) => {
  try {
    await pool.query(
      'INSERT IGNORE INTO club_gruppenfahrt_rsvp (fahrt_id, member_name) VALUES (?,?)',
      [req.params.id, req.session.memberName]
    );
  } catch (e) {}
  res.redirect('/club/gruppenfahrten');
});

router.post('/gruppenfahrten/:id/leave', requireMember, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM club_gruppenfahrt_rsvp WHERE fahrt_id=? AND member_name=?',
      [req.params.id, req.session.memberName]
    );
  } catch (e) {}
  res.redirect('/club/gruppenfahrten');
});

router.post('/gruppenfahrten/:id/delete', requireMember, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM club_gruppenfahrten WHERE id=? AND author=?',
      [req.params.id, req.session.memberName]
    );
    await pool.query('DELETE FROM club_gruppenfahrt_rsvp WHERE fahrt_id=?', [req.params.id]);
  } catch (e) {}
  res.redirect('/club/gruppenfahrten');
});

module.exports = router;
