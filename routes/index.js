const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { getStravaData } = require('../lib/strava');

const CLUB_ID = '300701';

router.get('/', async (req, res, next) => {
  try {
    const [[gallery], [news], [dbTermine], stravaData, [contentRows], [sponsors]] = await Promise.all([
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM news ORDER BY published_at DESC LIMIT 3'),
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC'),
      getStravaData(),
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT * FROM sponsors ORDER BY sort_order ASC'),
    ]);

    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));
    const strava = stravaData.club;

    // Flatten Strava group events into termine-like objects
    const now = new Date();
    const stravaTermine = stravaData.events.flatMap(ev =>
      (ev.upcoming_occurrences || []).map(dt => ({
        title: ev.title,
        date: new Date(dt),
        location: ev.address || null,
        description: ev.description || null,
        detail_url: `https://www.strava.com/clubs/${CLUB_ID}/group_events/${ev.id}`,
        tag: 'Strava',
        isStrava: true,
      }))
    ).filter(ev => ev.date >= now);

    // Merge and sort by date
    const termine = [...dbTermine, ...stravaTermine].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.render('index', { gallery, news, termine, strava, content, sponsors });
  } catch (err) {
    next(err);
  }
});

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
