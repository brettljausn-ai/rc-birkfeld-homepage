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

const uploadNews = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nur JPG, PNG, WebP oder GIF'));
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
    const [[news], [termine], [gallery], [members], [contentRows], [sponsors], [clubOauth], [clubMembersAuth], [challenges], [trainingsplaene], [polls]] = await Promise.all([
      pool.query('SELECT * FROM news ORDER BY published_at DESC'),
      pool.query('SELECT * FROM termine ORDER BY date ASC'),
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM members ORDER BY created_at DESC LIMIT 50'),
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT * FROM sponsors ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM club_oauth ORDER BY created_at DESC'),
      pool.query('SELECT id, name, email, created_at FROM club_members_auth ORDER BY created_at DESC'),
      pool.query('SELECT * FROM club_challenges ORDER BY created_at DESC'),
      pool.query('SELECT * FROM club_trainingsplan ORDER BY week_start DESC LIMIT 12'),
      pool.query('SELECT * FROM club_polls ORDER BY created_at DESC LIMIT 20'),
    ]);
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('admin/dashboard', {
      news, termine, gallery, members, content, sponsors, clubOauth, clubMembersAuth, challenges, trainingsplaene, polls,
      flash: req.query.msg || null,
      activeTab: req.query.tab || 'news',
    });
  } catch (err) { next(err); }
});

/* ── NEWS IMAGE UPLOAD ── */
router.post('/upload-news-image', requireAuth, uploadNews.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  res.json({ url: b64 });
});

/* ── NEWS ── */
router.post('/news', requireAuth, async (req, res, next) => {
  const { title, content, image_url, published_at, termin_id } = req.body;
  try {
    await pool.query(
      'INSERT INTO news (title, content, image_url, published_at, termin_id) VALUES (?,?,?,?,?)',
      [title, content, image_url || null, published_at || new Date(), termin_id || null]
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
router.post('/gallery', requireAuth, upload.array('photos', 30), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.redirect('/admin?msg=Kein+Foto+ausgewählt&tab=gallery');
    const caption = req.body.caption || null;
    const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM gallery');
    let nextOrder = maxRow.next;
    for (const file of req.files) {
      const ext = path.extname(file.originalname) || '.jpg';
      const filename = file.filename + ext;
      fs.renameSync(file.path, path.join(path.dirname(file.path), filename));
      await pool.query('INSERT INTO gallery (filename, caption, sort_order) VALUES (?,?,?)', [filename, caption || null, nextOrder++]);
    }
    res.redirect('/admin?msg=' + encodeURIComponent(req.files.length + ' Foto(s) hochgeladen') + '&tab=gallery');
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

function csvEscape(v) {
  if (v == null) return '';
  var s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(cols) { return cols.map(csvEscape).join(','); }

router.get('/members/export.csv', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM members ORDER BY created_at DESC');
    const lines = [
      csvRow(['Datum', 'Name', 'E-Mail', 'Interesse', 'Status']),
      ...rows.map(m => csvRow([
        new Date(m.created_at).toLocaleDateString('de-AT'),
        m.name, m.email, m.interesse || '', m.status
      ]))
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="beitrittsanfragen.csv"');
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) { next(err); }
});

router.get('/club-members/export.csv', requireAuth, async (req, res, next) => {
  try {
    const [[email], [oauth]] = await Promise.all([
      pool.query('SELECT name, email, created_at FROM club_members_auth ORDER BY created_at DESC'),
      pool.query('SELECT member_name, email, provider, created_at FROM club_oauth ORDER BY created_at DESC'),
    ]);
    const lines = [
      csvRow(['Datum', 'Name', 'E-Mail', 'Anmeldetyp']),
      ...email.map(m => csvRow([new Date(m.created_at).toLocaleDateString('de-AT'), m.name, m.email, 'E-Mail'])),
      ...oauth.map(m => csvRow([new Date(m.created_at).toLocaleDateString('de-AT'), m.member_name, m.email || '', m.provider])),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clubmitglieder.csv"');
    res.send('﻿' + lines.join('\r\n'));
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

router.post('/club-members/oauth/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_oauth WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Mitglied+gelöscht&tab=clubmembers');
  } catch (err) { next(err); }
});

router.post('/club-members/email/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_members_auth WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Mitglied+gelöscht&tab=clubmembers');
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

/* ── CHAT LEEREN ── */
router.post('/chat/clear', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_chat');
    res.redirect('/admin?msg=Chat+geleert&tab=clubmembers');
  } catch (err) { next(err); }
});

/* ── STRAVA CACHE CLEAR ── */
router.post('/strava-cache/clear', requireAuth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM strava_cache WHERE `key` IN ('club','events','club_stats','activities')");
    res.redirect('/admin?msg=Strava-Cache+geleert&tab=page');
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
  'verein_text','verein_kicker','verein_title',
  'result_1_rank','result_1_title','result_1_desc','result_1_meta',
  'result_2_rank','result_2_title','result_2_desc','result_2_meta',
  'result_3_rank','result_3_title','result_3_desc','result_3_meta',
  'nav_label_verein','nav_label_angebote','nav_label_galerie','nav_label_termine',
  'nav_label_berichte','nav_label_ergebnisse','nav_label_strava','nav_label_kontakt','nav_label_mitglieder',
  'galerie_kicker','galerie_title','galerie_desc',
  'angebote_kicker','angebote_title','angebote_desc',
  'angebote_tab1_label','angebote_tab1_title','angebote_tab1_desc','angebote_tab1_list','angebote_tab1_tag','angebote_tab1_img',
  'angebote_tab2_label','angebote_tab2_title','angebote_tab2_desc','angebote_tab2_list','angebote_tab2_tag','angebote_tab2_img',
  'angebote_tab3_label','angebote_tab3_title','angebote_tab3_desc','angebote_tab3_list','angebote_tab3_tag','angebote_tab3_img',
  'termine_kicker','termine_title',
  'ergebnisse_kicker','ergebnisse_title','ergebnisse_desc',
  'berichte_kicker','berichte_title','berichte_desc',
  'strava_kicker','strava_title',
  'join_kicker','join_title','join_intro','join_list',
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

/* ── POLLS ── */
router.post('/polls', requireAuth, async (req, res, next) => {
  const question = (req.body.question || '').trim();
  const options = (req.body.options || '').split('\n').map(o => o.trim()).filter(Boolean);
  const expires_at = req.body.expires_at || null;
  if (!question || options.length < 2) return res.redirect('/admin?msg=Mindestens+2+Optionen&tab=polls');
  try {
    await pool.query(
      'INSERT INTO club_polls (question, options, expires_at) VALUES (?,?,?)',
      [question, JSON.stringify(options), expires_at]
    );
    res.redirect('/admin?msg=Abstimmung+erstellt&tab=polls');
  } catch (err) { next(err); }
});

router.post('/polls/:id/close', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE club_polls SET active=0 WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Abstimmung+geschlossen&tab=polls');
  } catch (err) { next(err); }
});

router.post('/polls/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_poll_votes WHERE poll_id=?', [req.params.id]);
    await pool.query('DELETE FROM club_polls WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Abstimmung+gelöscht&tab=polls');
  } catch (err) { next(err); }
});

/* ── TRAININGSPLAN ── */
router.post('/trainingsplan', requireAuth, async (req, res, next) => {
  const { week_start, title, content } = req.body;
  if (!week_start || !title || !content) return res.redirect('/admin?msg=Fehlende+Felder&tab=trainingsplan');
  try {
    await pool.query(
      'INSERT INTO club_trainingsplan (week_start, title, content) VALUES (?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content)',
      [week_start, title, content]
    );
    res.redirect('/admin?msg=Trainingsplan+gespeichert&tab=trainingsplan');
  } catch (err) { next(err); }
});

router.post('/trainingsplan/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_trainingsplan WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Eintrag+gelöscht&tab=trainingsplan');
  } catch (err) { next(err); }
});

/* ── CHALLENGES ── */
router.post('/challenges', requireAuth, async (req, res, next) => {
  const { title, description, segment_id, start_date, end_date } = req.body;
  try {
    await pool.query('UPDATE club_challenges SET active=0');
    await pool.query(
      'INSERT INTO club_challenges (title, description, segment_id, start_date, end_date, active) VALUES (?,?,?,?,?,1)',
      [title, description || null, segment_id || null, start_date || null, end_date || null]
    );
    res.redirect('/admin?msg=Challenge+erstellt&tab=challenges');
  } catch (err) { next(err); }
});

router.post('/challenges/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_challenges WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Challenge+gelöscht&tab=challenges');
  } catch (err) { next(err); }
});

router.post('/challenges/:id/activate', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE club_challenges SET active=0');
    await pool.query('UPDATE club_challenges SET active=1 WHERE id=?', [req.params.id]);
    res.redirect('/admin?msg=Challenge+aktiviert&tab=challenges');
  } catch (err) { next(err); }
});

router.post('/strava-cache/segment/clear', requireAuth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM strava_cache WHERE `key` LIKE 'segment_%'");
    res.redirect('/admin?msg=Segment-Cache+geleert&tab=challenges');
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
