const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { getClubData } = require('../lib/strava');

router.get('/', async (req, res, next) => {
  try {
    const [[gallery], [news], [termine], strava, [contentRows], [sponsors]] = await Promise.all([
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM news ORDER BY published_at DESC LIMIT 3'),
      pool.query('SELECT * FROM termine WHERE date >= CURDATE() ORDER BY date ASC'),
      getClubData(),
      pool.query('SELECT `key`, value FROM site_content'),
      pool.query('SELECT * FROM sponsors ORDER BY sort_order ASC'),
    ]);
    const content = Object.fromEntries(contentRows.map(r => [r.key, r.value]));

    res.render('index', { gallery, news, termine, strava, content, sponsors });
  } catch (err) {
    next(err);
  }
});

router.get('/laurenzibergrennen', (req, res) => {
  res.render('laurenzibergrennen');
});

module.exports = router;
