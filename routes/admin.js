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
    const [newsRes, termineRes, galleryRes, membersRes] = await Promise.all([
      pool.query('SELECT * FROM news ORDER BY published_at DESC'),
      pool.query('SELECT * FROM termine ORDER BY date ASC'),
      pool.query('SELECT * FROM gallery ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM members ORDER BY created_at DESC LIMIT 50'),
    ]);
    res.render('admin/dashboard', {
      news: newsRes.rows,
      termine: termineRes.rows,
      gallery: galleryRes.rows,
      members: membersRes.rows,
      flash: req.query.msg || null,
    });
  } catch (err) { next(err); }
});

/* ── NEWS ── */
router.post('/news', requireAuth, async (req, res, next) => {
  const { title, content, image_url, published_at } = req.body;
  try {
    await pool.query(
      'INSERT INTO news (title, content, image_url, published_at) VALUES ($1,$2,$3,$4)',
      [title, content, image_url || null, published_at || new Date()]
    );
    res.redirect('/admin?msg=Bericht+gespeichert');
  } catch (err) { next(err); }
});

router.post('/news/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM news WHERE id=$1', [req.params.id]);
    res.redirect('/admin?msg=Bericht+gelöscht');
  } catch (err) { next(err); }
});

/* ── TERMINE ── */
router.post('/termine', requireAuth, async (req, res, next) => {
  const { title, date, location, description, detail_url, tag } = req.body;
  try {
    await pool.query(
      'INSERT INTO termine (title, date, location, description, detail_url, tag) VALUES ($1,$2,$3,$4,$5,$6)',
      [title, date, location, description || null, detail_url || null, tag || 'Vereinsrennen']
    );
    res.redirect('/admin?msg=Termin+gespeichert');
  } catch (err) { next(err); }
});

router.post('/termine/:id/delete', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM termine WHERE id=$1', [req.params.id]);
    res.redirect('/admin?msg=Termin+gelöscht');
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
      'INSERT INTO gallery (filename, caption, sort_order) VALUES ($1,$2,$3)',
      [filename, caption || null, parseInt(sort_order) || 0]
    );
    res.redirect('/admin?msg=Foto+hochgeladen');
  } catch (err) { next(err); }
});

router.post('/gallery/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const row = await pool.query('SELECT filename FROM gallery WHERE id=$1', [req.params.id]);
    if (row.rows.length) {
      const fp = path.join(__dirname, '..', 'images', 'galerie', row.rows[0].filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query('DELETE FROM gallery WHERE id=$1', [req.params.id]);
    res.redirect('/admin?msg=Foto+gelöscht');
  } catch (err) { next(err); }
});

module.exports = router;
