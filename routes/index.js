const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { getStravaData } = require('../lib/strava');

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

/* ── OTHER PAGES ── */

router.get('/bericht/:id', async (req, res, next) => {
  try {
    const [[rows], [dbTermine]] = await Promise.all([
      pool.query('SELECT * FROM news WHERE id = ?', [req.params.id]),
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC'),
    ]);
    if (!rows.length) return res.status(404).render('404', { title: 'Nicht gefunden', termine: [] });
    res.render('bericht', { bericht: rows[0], termine: dbTermine, title: rows[0].title });
  } catch (err) { next(err); }
});

router.get('/laurenzibergrennen', (req, res) => {
  res.render('laurenzibergrennen');
});

module.exports = router;
