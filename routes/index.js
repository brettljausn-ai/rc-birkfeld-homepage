const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { getStravaData, getClubStats } = require('../lib/strava');

const CLUB_ID = '300701';

/* ── MAIN PAGE (shell only – data loads via API) ── */
router.get('/', async (req, res, next) => {
  try {
    const [[contentRows], [termine], [sponsors]] = await Promise.all([
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC LIMIT 6'),
      pool.query('SELECT * FROM sponsors ORDER BY sort_order ASC'),
    ]);
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('index', { content, termine, sponsors });
  } catch (err) { next(err); }
});

/* ── PUBLIC API ── */

router.get('/api/news', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, title, content, image_url, published_at FROM news ORDER BY published_at DESC LIMIT 3');
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/api/termine', async (req, res, next) => {
  try {
    const [[rows], stravaData] = await Promise.all([
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC'),
      getStravaData(),
    ]);
    const now = new Date();
    const stravaTermine = stravaData.events.flatMap(ev =>
      (ev.upcoming_occurrences || []).map(dt => ({
        title: ev.title, date: new Date(dt), location: ev.address || null,
        detail_url: `https://www.strava.com/clubs/${CLUB_ID}/group_events/${ev.id}`,
        tag: 'Strava', isStrava: true,
      }))
    ).filter(ev => ev.date >= now);
    const termine = [...rows, ...stravaTermine].sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(termine);
  } catch (err) { next(err); }
});

router.get('/api/galerie', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT filename, caption FROM gallery ORDER BY sort_order ASC');
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/api/strava', async (req, res, next) => {
  try {
    const data = await getStravaData();
    res.json(data.club || null);
  } catch (err) { next(err); }
});

router.get('/api/strava-stats', async (req, res, next) => {
  try {
    const stats = await getClubStats();
    res.json(stats);
  } catch (err) { next(err); }
});

router.get('/api/strava-events', async (req, res, next) => {
  try {
    const data = await getStravaData();
    const now = new Date();
    const events = data.events.flatMap(ev =>
      (ev.upcoming_occurrences || []).map(dt => ({
        title: ev.title,
        date: new Date(dt),
        location: ev.address || null,
        detail_url: `https://www.strava.com/clubs/${CLUB_ID}/group_events/${ev.id}`,
      }))
    ).filter(ev => ev.date >= now).sort((a, b) => a.date - b.date).slice(0, 5);
    res.json(events);
  } catch (err) { next(err); }
});

/* ── SITEMAP ── */
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const [[berichte], [termine]] = await Promise.all([
      pool.query('SELECT id, published_at FROM news ORDER BY published_at DESC'),
      pool.query('SELECT id, date FROM termine ORDER BY date DESC LIMIT 100'),
    ]);
    const BASE = 'https://www.rc-birkfeld.at';
    const url = (loc, lastmod, freq, pri) =>
      `<url><loc>${loc}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
    const urls = [
      url(`${BASE}/`, '', 'weekly', '1.0'),
      url(`${BASE}/berichte`, '', 'weekly', '0.8'),
      ...berichte.map(b => url(`${BASE}/bericht/${b.id}`, b.published_at ? new Date(b.published_at).toISOString().split('T')[0] : '', 'monthly', '0.7')),
      ...termine.map(t => url(`${BASE}/termin/${t.id}`, t.date ? new Date(t.date).toISOString().split('T')[0] : '', 'monthly', '0.6')),
    ];
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
  } catch (err) { next(err); }
});

/* ── OTHER PAGES ── */

router.get('/berichte', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 12;
    const offset = (page - 1) * limit;
    const [[rows], [countRows], [contentRows]] = await Promise.all([
      pool.query('SELECT id, title, content, image_url, published_at FROM news ORDER BY published_at DESC LIMIT ? OFFSET ?', [limit, offset]),
      pool.query('SELECT COUNT(*) AS total FROM news'),
      pool.query('SELECT `key`, value FROM site_content'),
    ]);
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('berichte', { berichte: rows, page, totalPages, total, content });
  } catch (err) { next(err); }
});

router.get('/bericht/:id', async (req, res, next) => {
  try {
    const [[rows], [dbTermine], [contentRows]] = await Promise.all([
      pool.query('SELECT * FROM news WHERE id = ?', [req.params.id]),
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC'),
      pool.query('SELECT `key`, value FROM site_content'),
    ]);
    if (!rows.length) return res.status(404).render('404', { title: 'Nicht gefunden', termine: [] });
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('bericht', { bericht: rows[0], termine: dbTermine, title: rows[0].title, content });
  } catch (err) { next(err); }
});

router.get('/termin/:id', async (req, res, next) => {
  try {
    const [[rows], [contentRows], [berichtRows]] = await Promise.all([
      pool.query(`
        SELECT t.*,
          COALESCE(SUM(r.status='yes'),0) AS yes_count,
          COALESCE(SUM(r.status='no'),0)  AS no_count,
          GROUP_CONCAT(CASE WHEN r.status='yes' THEN r.member_name END ORDER BY r.updated_at SEPARATOR ',') AS yes_names,
          GROUP_CONCAT(CASE WHEN r.status='no'  THEN r.member_name END ORDER BY r.updated_at SEPARATOR ',') AS no_names,
          MAX(CASE WHEN r.member_name=? THEN r.status END) AS my_status
        FROM termine t
        LEFT JOIN event_rsvp r ON t.id = r.termine_id
        WHERE t.id = ?
        GROUP BY t.id
      `, [req.session.memberName || '', req.params.id]),
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT id, title FROM news WHERE termin_id = ? LIMIT 1', [req.params.id]),
    ]);
    if (!rows.length) return res.status(404).render('404', { title: 'Termin nicht gefunden', termine: [] });
    const t = rows[0];
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    res.render('termin', {
      termin: t,
      yesNames: t.yes_names ? t.yes_names.split(',').filter(Boolean) : [],
      noNames:  t.no_names  ? t.no_names.split(',').filter(Boolean)  : [],
      myRsvp: t.my_status || null,
      memberName: req.session.memberName || null,
      linkedBericht: berichtRows[0] || null,
      termine: [],
      content,
      title: t.title,
    });
  } catch (err) { next(err); }
});

router.get('/laurenzibergrennen', (req, res) => {
  res.render('laurenzibergrennen');
});

/* ── CUSTOM TERMIN URLS (detail_url) ── */
router.get('/:slug', async (req, res, next) => {
  try {
    const path = '/' + req.params.slug;
    const [rows] = await pool.query('SELECT id FROM termine WHERE detail_url = ? LIMIT 1', [path]);
    if (rows.length) return res.redirect('/termin/' + rows[0].id);
    next();
  } catch (err) { next(err); }
});

router.get('/impressum', (req, res) => {
  res.render('impressum', { content: {}, termine: [] });
});

router.get('/datenschutz', (req, res) => {
  res.redirect('/impressum#datenschutz');
});

module.exports = router;
