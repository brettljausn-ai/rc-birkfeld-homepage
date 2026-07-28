const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendMembershipRequest({ name, email, interesse }) {
  const labels = { jugend: 'Kids & Jugend', hobby: 'Hobby & Einsteiger', renn: 'Rennsport' };
  await transporter.sendMail({
    from: `RC Birkfeld <${process.env.SMTP_USER}>`,
    to: process.env.CONTACT_EMAIL || 'rcbirkfeld@gmail.com',
    replyTo: email,
    subject: `Beitrittsanfrage: ${name}`,
    html: `
      <h2>Neue Beitrittsanfrage</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>E-Mail:</strong> ${email}</p>
      <p><strong>Interesse:</strong> ${labels[interesse] || interesse}</p>
    `,
  });
}

module.exports = { sendMembershipRequest };
