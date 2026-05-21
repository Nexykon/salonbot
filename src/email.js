const axios = require('axios');

function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail(to, subject, text) {
  const email = String(to || '').trim();
  if (!email || !configured()) return false;
  try {
    const res = await axios.post('https://api.resend.com/emails', {
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
  } catch (e) {
    const status = e.response?.status;
    const detail = JSON.stringify(e.response?.data || e.message);
    console.error(`[email] sendEmail failed (${status}): ${detail}`);
    return false;
  }
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
  try {
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
  } catch (e) {
    const status = e.response?.status;
    const detail = JSON.stringify(e.response?.data || e.message);
    console.error(`[email] sendWelcomeEmail failed (${status}): ${detail}`);
    return false;
  }
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

// Email stranki: rezervacija prejeta (čaka na potrditev)
async function sendCustomerBookingReceived(customerEmail, customerName, salonName, date, time, ref6) {
  const subject = `Rezervacija prejeta — ${salonName}`;
  const text = [
    `Pozdravljeni ${customerName},`,
    '',
    `Vaša rezervacija pri ${salonName} je bila prejeta in čaka na potrditev.`,
    '',
    `📅 Termin: ${date} ob ${time}`,
    `🔑 Referenca: ${ref6}`,
    '',
    'Ko bo rezervacija potrjena, boste prejeli še eno obvestilo.',
    '',
    `Hvala, ekipa ${salonName}`
  ].join('\n');
  return sendEmail(customerEmail, subject, text);
}

// Email stranki: rezervacija potrjena s strani admina
async function sendCustomerBookingConfirmed(customerEmail, customerName, salonName, date, time, ref6) {
  const subject = `✅ Rezervacija potrjena — ${salonName}`;
  const text = [
    `Pozdravljeni ${customerName},`,
    '',
    `Vaša rezervacija pri ${salonName} je bila potrjena! 🎉`,
    '',
    `📅 Termin: ${date} ob ${time}`,
    `🔑 Referenca: ${ref6}`,
    '',
    'Vidimo se! Če imate kakršna koli vprašanja, nam pišite na WhatsApp.',
    '',
    `Lep pozdrav, ekipa ${salonName}`
  ].join('\n');
  return sendEmail(customerEmail, subject, text);
}

// Email adminu: nova rezervacija z gumboma Potrdi/Zavrni
async function sendAdminBookingConfirmEmail(salon, customerName, phone, date, time, ref6, bookingId) {
  const baseUrl = process.env.BASE_URL || 'https://flowtiq.si';
  const confirmUrl = `${baseUrl}/api/confirm-booking?id=${bookingId}&action=confirm`;
  const cancelUrl  = `${baseUrl}/api/confirm-booking?id=${bookingId}&action=cancel`;
  const subject = `📩 Nova rezervacija — ${customerName} (${date} ob ${time})`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:24px 32px;">
          <div style="font-size:22px;font-weight:800;color:#fff;">FlowTiq</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:2px;">Nova rezervacija čaka na potrditev</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 20px;">📩 Nova rezervacija pri <strong>${salon.name || 'vaš salon'}</strong></p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;margin-bottom:28px;">
            <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">👤 Stranka</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">${customerName}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">📞 Telefon</td><td style="padding:6px 0;color:#1e293b;font-size:14px;">+${phone}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">📅 Termin</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">${date} ob ${time}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">🔑 Ref</td><td style="padding:6px 0;color:#7c3aed;font-size:14px;font-weight:700;">${ref6}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="48%" style="padding-right:8px;">
                <a href="${confirmUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:10px;">✅ Potrdi rezervacijo</a>
              </td>
              <td width="48%" style="padding-left:8px;">
                <a href="${cancelUrl}" style="display:block;text-align:center;background:#f1f5f9;color:#ef4444;font-size:15px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:10px;border:1px solid #fecaca;">❌ Zavrni</a>
              </td>
            </tr>
          </table>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin:20px 0 0;">Ali upravljajte rezervacije v <a href="${baseUrl}/dashboard.html" style="color:#7c3aed;">FlowTiq dashboardu</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const email = String(salon.owner_email || '').trim();
  if (!email || !configured()) return false;
  try {
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
  } catch (e) {
    const status = e.response?.status;
    const detail = JSON.stringify(e.response?.data || e.message);
    console.error(`[email] sendAdminBookingConfirmEmail failed (${status}): ${detail}`);
    return false;
  }
}

module.exports = { configured, sendEmail, sendWelcomeEmail, sendBookingNotification, sendAdminBookingConfirmEmail, sendPasswordReset, sendCustomerBookingReceived, sendCustomerBookingConfirmed };
