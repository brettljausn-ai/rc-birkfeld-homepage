const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { getClubData } = require('../lib/strava');

router.get('/', async (req, res, next) => {
  try {
    const [galleryRes, newsRes, termineRes, strava] = await Promise.all([
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM news ORDER BY published_at DESC LIMIT 3'),
      pool.query('SELECT * FROM termine WHERE date >= CURRENT_DATE ORDER BY date ASC'),
      getClubData(),
    ]);

    res.render('index', {
      gallery: galleryRes.rows,
      news: newsRes.rows,
      termine: termineRes.rows,
      strava,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/laurenzibergrennen', (req, res) => {
  res.render('laurenzibergrennen');
});

module.exports = router;
