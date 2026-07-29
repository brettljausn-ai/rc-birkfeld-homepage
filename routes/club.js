const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');

function requireMember(req, res, next) {
  if (req.session.memberName) return next();
  res.redirect('/club/login');
}

router.get('/login', (req, res) => {
  res.render('club/login', { error: null });
});

router.post('/login', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name.length < 2) return res.render('club/login', { error: 'Bitte deinen Namen eingeben.' });
  if (req.body.pin !== (process.env.CLUB_PIN || 'birkfeld')) {
    return res.render('club/login', { error: 'Falscher Club-Code.' });
  }
  req.session.memberName = name;
  res.redirect('/club');
});

router.get('/logout', (req, res) => {
  delete req.session.memberName;
  res.redirect('/club/login');
});

router.get('/', requireMember, async (req, res, next) => {
  try {
    const [[posts], [chat], [termine]] = await Promise.all([
      pool.query('SELECT * FROM club_posts ORDER BY created_at DESC LIMIT 30'),
      pool.query('SELECT * FROM club_chat ORDER BY created_at ASC LIMIT 100'),
      pool.query(`
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
      `, [req.session.memberName]),
    ]);

    res.render('club/dashboard', {
      memberName: req.session.memberName,
      posts,
      chat,
      termine: termine.map(t => ({
        ...t,
        yes_names: t.yes_names ? t.yes_names.split(',').filter(Boolean) : [],
        no_names:  t.no_names  ? t.no_names.split(',').filter(Boolean)  : [],
      })),
    });
  } catch (err) { next(err); }
});

router.get('/chat/poll', requireMember, async (req, res, next) => {
  try {
    const after = parseInt(req.query.after) || 0;
    const [rows] = await pool.query('SELECT * FROM club_chat WHERE id > ? ORDER BY created_at ASC LIMIT 50', [after]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/post', requireMember, async (req, res, next) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.redirect('/club');
  try {
    await pool.query('INSERT INTO club_posts (author, content) VALUES (?,?)', [req.session.memberName, content]);
    res.redirect('/club#pinnwand');
  } catch (err) { next(err); }
});

router.post('/post/:id/delete', requireMember, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM club_posts WHERE id=? AND author=?', [req.params.id, req.session.memberName]);
    res.redirect('/club#pinnwand');
  } catch (err) { next(err); }
});

router.post('/chat', requireMember, async (req, res, next) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.redirect('/club');
  try {
    await pool.query('INSERT INTO club_chat (author, content) VALUES (?,?)', [req.session.memberName, content]);
    res.redirect('/club#chat');
  } catch (err) { next(err); }
});

router.post('/rsvp/:id', requireMember, async (req, res, next) => {
  const status = req.body.status;
  if (!['yes', 'no'].includes(status)) return res.redirect('/club');
  try {
    await pool.query(
      'INSERT INTO event_rsvp (termine_id, member_name, status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE status=?',
      [req.params.id, req.session.memberName, status, status]
    );
    res.redirect('/club#termine');
  } catch (err) { next(err); }
});

module.exports = router;
