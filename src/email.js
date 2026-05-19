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

async function sendWelcomeEmail(salon, setupUrl) {
  const name = salon.owner_name || salon.name || 'lastnik';
  const subject = `Dobrodošli v FlowTiq — nastavite svoje geslo`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2a2a4a;">
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">FlowTiq</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">Pametni AI asistent za rezervacije</div>
        </td></tr>
        <tr><td style="padding:40px 40px 32px;">
          <p style="color:#e2e8f0;font-size:18px;font-weight:600;margin:0 0 12px;">Pozdravljeni, ${name}! 👋</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
            Vaš FlowTiq račun za <strong style="color:#e2e8f0;">${salon.name}</strong> je pripravljen.<br>
            Za dostop do vašega dashboarda morate najprej nastaviti geslo.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0 32px;">
              <a href="${setupUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:12px;">
                Nastavi geslo →
              </a>
            </td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 8px;">
            Link je aktiven <strong style="color:#94a3b8;">72 ur</strong>. Če ga niste zahtevali, sporočilo ignorirajte.
          </p>
          <p style="color:#475569;font-size:12px;margin:0;">
            Direktni link: <a href="${setupUrl}" style="color:#7c3aed;">${setupUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #2a2a4a;text-align:center;">
          <p style="color:#475569;font-size:12px;margin:0;">FlowTiq · noreply@flowtiq.si</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const email = String(salon.owner_email || '').trim();
  if (!email || !configured()) return false;
  await axios.post('https://api.resend.com/emails', {
    from: process.env.EMAIL_FROM,
    to: email,
    subject,
    html
  }, {
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return true;
}

async function sendBookingNotification(salon, customerName, phone, date, time, ref6, sourceLabel, formAnswers = {}) {
  const answerLines = Object.entries(formAnswers || {}).map(([key, value]) => `${key}: ${value}`);
  const subject = `Nova rezervacija - ${salon.name || 'FlowTiq'}`;
  const text = [
    `Nova ${sourceLabel || 'rezervacija'}`,
    '',
    `Podjetje: ${salon.name || '-'}`,
    `Stranka: ${customerName || '-'}`,
    `Telefon: +${phone || '-'}`,
    `Termin: ${date} ob ${time}`,
    `Ref: ${ref6}`,
    ...(answerLines.length ? ['', 'Dodatni odgovori:', ...answerLines] : []),
    '',
    'Rezervacijo lahko uredite v FlowTiq dashboardu.'
  ].join('\n');
  return sendEmail(salon.owner_email, subject, text);
}

async function sendPasswordReset(to, resetUrl) {
  return sendEmail(
    to,
    'FlowTiq ponastavitev gesla',
    [
      'Pozdravljeni,',
      '',
      'Za ponastavitev FlowTiq gesla odprite spodnjo povezavo:',
      resetUrl,
      '',
      'Povezava velja 30 minut. Ce tega niste zahtevali vi, sporocilo ignorirajte.'
    ].join('\n')
  );
}

module.exports = { configured, sendEmail, sendWelcomeEmail, sendBookingNotification, sendPasswordReset };
