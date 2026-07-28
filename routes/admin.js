const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../lib/db');

const upload = multer({
  dest: path.join(__dirname, '..', 'images', 'galerie'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nur JPG, PNG oder WebP erlaubt'));
  },
});

const uploadSponsor = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp|svg\+xml)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nur JPG, PNG, WebP oder SVG erlaubt'));
  },
});

function requireAuth(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

router.get('/login', (req, res) => res.render('admin/login', { error: null }));

router.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Falsches Passwort' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [[news], [termine], [gallery], [members], [contentRows], [sponsors]] = await Promise.all([
      pool.query('SELECT * FROM news ORDER BY published_at DESC'),
      pool.query('SELECT * FROM termine ORDER BY date ASC'),
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM members ORDER BY created_at DESC LIMIT 50'),
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT * FROM sponsors ORDER BY sort_order ASC'),
    ]);
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('admin/dashboard', {
      news, termine, gallery, members, content, sponsors,
      flash: req.query.msg || null,
      activeTab: req.query.tab || 'news',
    });
  } catch (err) { next(err); }
});

/* ── NEWS ── */
router.post('/news', requireAuth, async (req, res, next) => {
  const { title, content, image_url, published_at } = req.body;
  try {
    await pool.query(
      'INSERT INTO news (title, content, image_url, published_at) VALUES (?,?,?,?)',
      [title, content, image_url || null, published_at || new Date()]
    );
    res.redirect('/admin?msg=Bericht+gespeichert');
  } catch (err) { next(err); }
});

router.post('/news/:id/edit', requireAuth, async (req, res, next) => {
  const { title, content, image_url, published_at } = req.body;
  try {
    await pool.query(
      'UPDATE news SET title=?, content=?, image_url=?, published_at=? WHERE id=?',
      [title, content, image_url || null, published_at, req.params.id]
    );
    res.redirect('/admin?msg=Bericht+aktualisiert&tab=news');
  } catch (err) { next(err); }
});

router.post('/news/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM news WHERE id = ?', [req.params.id]);
    res.redirect('/admin?msg=Bericht+gelöscht&tab=news');
  } catch (err) { next(err); }
});

/* ── TERMINE ── */
router.post('/termine', requireAuth, async (req, res, next) => {
  const { title, date, location, description, detail_url, tag } = req.body;
  try {
    await pool.query(
      'INSERT INTO termine (title, date, location, description, detail_url, tag) VALUES (?,?,?,?,?,?)',
      [title, date, location, description || null, detail_url || null, tag || 'Vereinsrennen']
    );
    res.redirect('/admin?msg=Termin+gespeichert');
  } catch (err) { next(err); }
});

router.post('/termine/:id/edit', requireAuth, async (req, res, next) => {
  const { title, date, location, description, detail_url, tag } = req.body;
  try {
    await pool.query(
      'UPDATE termine SET title=?, date=?, location=?, description=?, detail_url=?, tag=? WHERE id=?',
      [title, date, location || null, description || null, detail_url || null, tag || 'Vereinsrennen', req.params.id]
    );
    res.redirect('/admin?msg=Termin+aktualisiert&tab=termine');
  } catch (err) { next(err); }
});

router.post('/termine/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM termine WHERE id = ?', [req.params.id]);
    res.redirect('/admin?msg=Termin+gelöscht&tab=termine');
  } catch (err) { next(err); }
});

/* ── GALERIE ── */
router.post('/gallery', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const { caption, sort_order } = req.body;
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = req.file.filename + ext;
    fs.renameSync(req.file.path, path.join(path.dirname(req.file.path), filename));
    await pool.query(
      'INSERT INTO gallery (filename, caption, sort_order) VALUES (?,?,?)',
      [filename, caption || null, parseInt(sort_order) || 0]
    );
    res.redirect('/admin?msg=Foto+hochgeladen');
  } catch (err) { next(err); }
});

router.post('/gallery/:id/caption', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE gallery SET caption=? WHERE id=?', [req.body.caption || null, req.params.id]);
    res.redirect('/admin?msg=Beschriftung+gespeichert&tab=gallery');
  } catch (err) { next(err); }
});

router.post('/gallery/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const [[row]] = await pool.query('SELECT filename FROM gallery WHERE id = ?', [req.params.id]);
    if (row) {
      const fp = path.join(__dirname, '..', 'images', 'galerie', row.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query('DELETE FROM gallery WHERE id = ?', [req.params.id]);
    res.redirect('/admin?msg=Foto+gelöscht');
  } catch (err) { next(err); }
});

/* ── SPONSOREN ── */
router.post('/sponsors', requireAuth, uploadSponsor.single('logo'), async (req, res, next) => {
  try {
    const { name, website_url, sort_order } = req.body;
    const logo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await pool.query(
      'INSERT INTO sponsors (name, logo, website_url, sort_order) VALUES (?,?,?,?)',
      [name, logo, website_url || null, parseInt(sort_order) || 0]
    );
    res.redirect('/admin?msg=Sponsor+gespeichert&tab=sponsors');
  } catch (err) { next(err); }
});

router.post('/members/:id/status', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE members SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.redirect('/admin?msg=Status+aktualisiert&tab=members');
  } catch (err) { next(err); }
});

router.post('/members/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM members WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Eintrag+gelöscht&tab=members');
  } catch (err) { next(err); }
});

router.post('/sponsors/:id/edit', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE sponsors SET name=?, website_url=? WHERE id=?',
      [req.body.name, req.body.website_url || null, req.params.id]);
    res.redirect('/admin?msg=Sponsor+aktualisiert&tab=sponsors');
  } catch (err) { next(err); }
});

router.post('/sponsors/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sponsors WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Sponsor+gelöscht&tab=sponsors');
  } catch (err) { next(err); }
});

/* ── STRAVA TEST ── */
router.post('/test-strava', requireAuth, async (req, res) => {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
  if (!STRAVA_CLIENT_ID) return res.json({ ok: false, msg: 'STRAVA_CLIENT_ID fehlt' });
  if (!STRAVA_CLIENT_SECRET) return res.json({ ok: false, msg: 'STRAVA_CLIENT_SECRET fehlt' });
  if (!STRAVA_REFRESH_TOKEN) return res.json({ ok: false, msg: 'STRAVA_REFRESH_TOKEN fehlt' });
  try {
    const https = require('https');
    const tokenRes = await new Promise((resolve, reject) => {
      const body = new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, refresh_token: STRAVA_REFRESH_TOKEN, grant_type: 'refresh_token' }).toString();
      const req2 = https.request({ hostname: 'www.strava.com', path: '/api/v3/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
        let buf = ''; r.on('data', c => buf += c); r.on('end', () => resolve(JSON.parse(buf)));
      });
      req2.on('error', reject); req2.write(body); req2.end();
    });
    if (!tokenRes.access_token) return res.json({ ok: false, msg: 'Token-Refresh fehlgeschlagen: ' + JSON.stringify(tokenRes) });
    res.json({ ok: true, msg: `✓ Token OK (${tokenRes.token_type}), läuft ab: ${new Date(tokenRes.expires_at * 1000).toLocaleString('de-AT')}` });
  } catch (err) {
    res.json({ ok: false, msg: err.message });
  }
});

/* ── E-MAIL TEST ── */
router.post('/test-email', requireAuth, async (req, res) => {
  const { sendMembershipRequest } = require('../lib/mailer');
  try {
    await sendMembershipRequest({ name: 'Testperson', email: process.env.CONTACT_EMAIL, interesse: 'hobby' });
    res.json({ ok: true, msg: 'E-Mail erfolgreich gesendet an ' + process.env.CONTACT_EMAIL });
  } catch (err) {
    res.json({ ok: false, msg: err.message });
  }
});

/* ── HAUPTSEITE TEXTE ── */
const CONTENT_KEYS = new Set([
  'hero_eyebrow','hero_title_line1','hero_title_line2','hero_lead',
  'stats_1_num','stats_1_lbl','stats_2_num','stats_2_lbl',
  'stats_3_num','stats_3_lbl','stats_4_num','stats_4_lbl',
  'verein_text',
  'result_1_rank','result_1_title','result_1_desc','result_1_meta',
  'result_2_rank','result_2_title','result_2_desc','result_2_meta',
  'result_3_rank','result_3_title','result_3_desc','result_3_meta',
]);

router.post('/page/content', requireAuth, async (req, res, next) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (CONTENT_KEYS.has(key)) {
        await pool.query(
          'INSERT INTO site_content (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          [key, value, value]
        );
      }
    }
    res.redirect('/admin?msg=Gespeichert&tab=page');
  } catch (err) { next(err); }
});

/* ── GALERIE REIHENFOLGE ── */
router.post('/gallery/reorder', requireAuth, async (req, res, next) => {
  try {
    const order = req.body.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'invalid' });
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE gallery SET sort_order=? WHERE id=?', [i, order[i]]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
