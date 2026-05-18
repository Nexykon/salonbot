const axios = require('axios');

function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail(to, subject, text) {
  const email = String(to || '').trim();
  if (!email || !configured()) return false;
  await axios.post('https://api.resend.com/emails', {
    from: process.env.EMAIL_FROM,
    to: email,
    subject,
    text
  }, {
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return true;
}

async function sendBookingNotification(salon, customerName, phone, date, time, ref6, sourceLabel) {
  const subject = `Nova rezervacija - ${salon.name || 'FlowTiq'}`;
  const text = [
    `Nova ${sourceLabel || 'rezervacija'}`,
    '',
    `Podjetje: ${salon.name || '-'}`,
    `Stranka: ${customerName || '-'}`,
    `Telefon: +${phone || '-'}`,
    `Termin: ${date} ob ${time}`,
    `Ref: ${ref6}`,
    '',
    'Rezervacijo lahko uredite v FlowTiq dashboardu.'
  ].join('\n');
  return sendEmail(salon.owner_email, subject, text);
}

module.exports = { configured, sendEmail, sendBookingNotification };
