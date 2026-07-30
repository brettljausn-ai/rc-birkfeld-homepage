const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const passport = require('../lib/passport');
const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');

const uploadFeed = multer({
  dest: path.join(__dirname, '..', 'images', 'feed'),
  limits: { fileSize: 8 * 1024 * 1024 },
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
  const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const newName = req.file.filename + '.' + ext;
  require('fs').renameSync(req.file.path, path.join(req.file.destination, newName));
  res.json({ url: '/images/feed/' + newName });
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
    const [rows] = await pool.query('SELECT * FROM club_posts ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/', requireMember, (req, res) => {
  res.render('club/feed', { ...helpers, memberName: req.session.memberName, page: 'feed' });
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
    res.redirect('/club/termine');
  } catch (err) { next(err); }
});

/* ── CHAT ── */
router.get('/chat', requireMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM club_chat ORDER BY created_at ASC LIMIT 200');
    res.render('club/chat', { ...helpers, memberName: req.session.memberName, chat: rows, page: 'chat' });
  } catch (err) { next(err); }
});

router.get('/chat/poll', requireMember, async (req, res, next) => {
  try {
    const after = parseInt(req.query.after) || 0;
    const [rows] = await pool.query('SELECT * FROM club_chat WHERE id > ? ORDER BY created_at ASC LIMIT 50', [after]);
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

module.exports = router;
