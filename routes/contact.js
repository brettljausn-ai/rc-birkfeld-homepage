const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { sendMembershipRequest } = require('../lib/mailer');

router.post('/beitritt', async (req, res) => {
  const { name, email, interesse } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name und E-Mail sind erforderlich.' });
  }

  try {
    await pool.query(
      'INSERT INTO members (name, email, interesse) VALUES (?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), interesse || 'hobby']
    );

    await sendMembershipRequest({ name: name.trim(), email: email.trim(), interesse });

    res.json({ ok: true, message: `Danke, ${name.trim()}! Wir melden uns bald.` });
  } catch (err) {
    console.error('Beitrittsanfrage-Fehler:', err);
    res.status(500).json({ error: 'Anfrage konnte nicht gesendet werden. Bitte versuche es später erneut.' });
  }
});

module.exports = router;
