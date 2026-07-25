/**
 * Notification delivery: Telegram and email.
 *
 * Both are optional and fail soft — a broken email provider must never stop a
 * Telegram alert from going out, and neither must ever fail the whole run and
 * leave you without a committed schedule snapshot.
 *
 * Secrets come from env (GitHub Actions secrets):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   RESEND_API_KEY, MAIL_TO, MAIL_FROM          (preferred email path)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (fallback email path)
 */

const TZ = 'Europe/Chisinau';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ Telegram */

export async function sendTelegram(html, { token, chatId } = {}) {
  const t = token ?? process.env.TELEGRAM_BOT_TOKEN;
  const c = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN/CHAT_ID not set' };

  // Telegram caps messages at 4096 chars.
  const body = html.length > 4000 ? `${html.slice(0, 3950)}\n\n…(truncat)` : html;

  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c,
        text: body,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      return { ok: false, reason: json.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.message ?? err) };
  }
}

/* --------------------------------------------------------------------- Email */

async function sendViaResend(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_TO;
  if (!key || !to) return { ok: false, skipped: true, reason: 'RESEND_API_KEY/MAIL_TO not set' };

  const from = process.env.MAIL_FROM || 'Filmradar <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: to.split(',').map((s) => s.trim()), subject, html }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, reason: `Resend HTTP ${res.status} ${txt.slice(0, 200)}` };
    }
    return { ok: true, via: 'resend' };
  } catch (err) {
    return { ok: false, reason: String(err.message ?? err) };
  }
}

async function sendViaSmtp(subject, html) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !MAIL_TO) return { ok: false, skipped: true, reason: 'SMTP_HOST/MAIL_TO not set' };

  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    return { ok: false, reason: 'nodemailer not installed (run: npm i nodemailer)' };
  }

  try {
    const port = Number(SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to: MAIL_TO,
      subject,
      html,
    });
    return { ok: true, via: 'smtp' };
  } catch (err) {
    return { ok: false, reason: String(err.message ?? err) };
  }
}

export async function sendEmail(subject, html) {
  if (process.env.RESEND_API_KEY) return sendViaResend(subject, html);
  return sendViaSmtp(subject, html);
}

/* ----------------------------------------------------------------- Formatting */

function slotLine(h) {
  const when = [h.dayName, h.start && h.end ? `${h.start}–${h.end}` : h.start]
    .filter(Boolean)
    .join(' ');
  return { when: when || 'oră necunoscută', channel: h.channel };
}

export function buildTelegramMessage({ hits, maybes, watchCount, runAt }) {
  const lines = [];

  if (hits.length) {
    lines.push('🎬 <b>DETECTAT ÎN GRILA TV</b>');
    lines.push('');
    for (const h of hits) {
      const { when } = slotLine(h);
      lines.push(`<b>${escapeHtml(h.watched)}</b>`);
      lines.push(`📺 ${escapeHtml(h.channel)} · ${escapeHtml(when)}`);
      lines.push(`   listat ca: <i>${escapeHtml(h.slotTitle)}</i>`);
      lines.push(`   <a href="${h.live}">▶ stream live</a> · încredere ${h.confidence}`);
      lines.push('');
    }
  }

  if (maybes.length) {
    lines.push(`🔎 <b>Posibile</b> (rubrici generice, ${maybes.length})`);
    for (const m of maybes.slice(0, 12)) {
      const { when } = slotLine(m);
      lines.push(`· ${escapeHtml(m.channel)} ${escapeHtml(when)} — ${escapeHtml(m.slotTitle)}`);
    }
    if (maybes.length > 12) lines.push(`· …și încă ${maybes.length - 12}`);
    lines.push('');
  }

  lines.push(
    `<i>${watchCount} titluri urmărite · verificat ${escapeHtml(runAt)}</i>`,
  );
  return lines.join('\n');
}

export function buildEmailHtml({ hits, maybes, watchCount, runAt, siteUrl }) {
  const card = (h, accent) => {
    const { when } = slotLine(h);
    return `
      <tr><td style="padding:0 0 12px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid ${accent};background:#f7f7f5;border-radius:6px">
          <tr><td style="padding:14px 16px;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a18">
            <div style="font-weight:600;font-size:16px">${escapeHtml(h.watched ?? h.rubric ?? h.slotTitle)}</div>
            <div style="margin-top:4px;color:#55554e">${escapeHtml(h.channel)} · ${escapeHtml(when)}</div>
            <div style="margin-top:4px;color:#75756c;font-size:13px">listat ca: <i>${escapeHtml(h.slotTitle)}</i></div>
            <div style="margin-top:10px"><a href="${h.live}" style="color:#b8593f;text-decoration:none;font-weight:600">▶ Stream live</a>
              &nbsp;·&nbsp; <a href="${h.schedule}" style="color:#75756c;text-decoration:none">grila completă</a></div>
          </td></tr>
        </table>
      </td></tr>`;
  };

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f7">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td style="font:600 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a18;padding-bottom:4px">
      ${hits.length ? '🎬 Titlu detectat în grila TV' : 'Raport verificare grilă TV'}
    </td></tr>
    <tr><td style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#75756c;padding-bottom:20px">
      ${watchCount} titluri urmărite · ${escapeHtml(runAt)}
    </td></tr>
    ${hits.length ? hits.map((h) => card(h, '#b8593f')).join('') : ''}
    ${
      maybes.length
        ? `<tr><td style="font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#55554e;padding:16px 0 10px">
             Posibile — rubrici fără titlu (${maybes.length})</td></tr>
           ${maybes.slice(0, 15).map((m) => card(m, '#c9c9c0')).join('')}`
        : ''
    }
    ${
      siteUrl
        ? `<tr><td style="padding-top:16px;font:13px -apple-system,Segoe UI,Roboto,sans-serif">
             <a href="${siteUrl}" style="color:#b8593f">Deschide panoul de control →</a></td></tr>`
        : ''
    }
  </table></body></html>`;
}

export function nowInChisinau() {
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TZ,
  }).format(new Date());
}

export default { sendTelegram, sendEmail, buildTelegramMessage, buildEmailHtml, nowInChisinau };
