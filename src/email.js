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
      <table width="560" cellpadding="0" cellspacing="0" style