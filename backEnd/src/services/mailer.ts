/**
 * Email sending service — Resend Email API (HTTPS).
 *
 * We use an HTTP API instead of raw SMTP sockets because Render's network
 * occasionally times out long-lived SMTP (587/STARTTLS) connections — a
 * known intermittent issue on many PaaS hosts. Plain HTTPS calls avoid it.
 *
 * Development fallback:
 *   If RESEND_API_KEY is empty, emails are logged to the console.
 *
 * Production (Resend):
 *   - Sign up at https://resend.com and add + verify your domain (DNS records).
 *   - Dashboard → API Keys → Create API Key.
 *   - Set the environment variables below.
 */

const apiKey = process.env.RESEND_API_KEY || "";
const mailFromEmail = process.env.MAIL_FROM_EMAIL || "no-reply@clinicosjo.com";
const mailFromName = process.env.MAIL_FROM_NAME || "ClinicOS";
const appUrl = process.env.APP_URL || "http://localhost:3000";

if (apiKey) {
  console.log(`[MAILER] Resend API ready — sending as ${mailFromName} <${mailFromEmail}>`);
} else {
  console.log("[MAILER] No RESEND_API_KEY set — running in dev/console mode");
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

async function send({ to, subject, html }: SendArgs): Promise<void> {
  if (!apiKey) {
    // Dev fallback — print email to console so the developer can copy the link
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 [MAILER — dev mode, no RESEND_API_KEY configured]");
    console.log("To:      ", to);
    console.log("Subject: ", subject);
    console.log("──────────────────────────────────────────────────");
    console.log(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    console.log("═══════════════════════════════════════════════════");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `${mailFromName} <${mailFromEmail}>`,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { id?: string };
    console.log(`[MAILER] ✔ Sent to ${to} — id: ${data.id}`);
  } catch (err) {
    console.error(`[MAILER] ✗ Failed to send to ${to}:`, (err as Error).message);
  }
}

/** ================ Email templates ================ */

const wrap = (title: string, body: string, cta?: { url: string; label: string }) => `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0c2e4e">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(12,46,78,0.08)">
        <tr><td style="background:linear-gradient(135deg,#06263F 0%,#0c2e4e 100%);padding:24px;text-align:center;color:#ffffff">
          <div style="font-size:22px;font-weight:600;letter-spacing:-0.02em">
            <span style="color:#ffffff">Clinic</span><span style="color:#4FC3B8">OS</span>
          </div>
          <div style="font-size:11px;color:#8fb3cc;margin-top:2px;letter-spacing:0.15em">SMARTER CLINIC MANAGEMENT</div>
        </td></tr>
        <tr><td style="padding:32px 32px 12px 32px">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0c2e4e">${title}</h1>
          <div style="font-size:14px;line-height:1.65;color:#4b6b85">${body}</div>
          ${cta ? `
          <div style="margin:28px 0 8px">
            <a href="${cta.url}" style="display:inline-block;background:#4FC3B8;color:#06263F;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${cta.label}</a>
          </div>
          <div style="margin-top:12px;font-size:11px;color:#8095a8">
            Or copy this link: <span style="color:#4b6b85;word-break:break-all">${cta.url}</span>
          </div>` : ""}
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #eef3f8;color:#8095a8;font-size:11px;line-height:1.5">
          Sent by ClinicOS · Amman, Jordan · You received this because someone signed up with this email.
          If it wasn't you, you can safely ignore this message.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export async function sendVerificationEmail(email: string, name: string, token: string) {
  const url = `${appUrl}/verify-email?token=${token}`;
  await send({
    to: email,
    subject: "Verify your ClinicOS email",
    html: wrap(
      `Welcome, ${name}!`,
      `<p>Thanks for signing your clinic up on ClinicOS. To finish setting up your account, please verify your email by clicking the button below. This link expires in 24 hours.</p>`,
      { url, label: "Verify email address" }
    ),
  });
}

export async function sendPasswordResetEmail(email: string, name: string, token: string) {
  const url = `${appUrl}/reset-password?token=${token}`;
  await send({
    to: email,
    subject: "Reset your ClinicOS password",
    html: wrap(
      `Hi ${name},`,
      `<p>We received a request to reset the password for your ClinicOS account. Click the button below to choose a new one — this link expires in 1 hour.</p>
       <p style="color:#8095a8;font-size:12px">If you didn't request this, no action is needed — your password stays the same.</p>`,
      { url, label: "Reset password" }
    ),
  });
}

export async function sendNewBookingNotification(
  ownerEmail: string,
  ownerName: string,
  opts: {
    patientName: string;
    patientPhone: string;
    doctorName: string;
    startAt: Date;
    refCode: string;
  }
) {
  const dashboardUrl = `${appUrl}/dashboard/appointments`;
  const dateStr = opts.startAt.toLocaleString("en-GB", {
    timeZone: "Asia/Amman",
    dateStyle: "medium",
    timeStyle: "short",
  });
  await send({
    to: ownerEmail,
    subject: `حجز جديد — ${opts.patientName}`,
    html: wrap(
      `مرحباً ${ownerName}،`,
      `<p>في حجز جديد وصل عن طريق صفحة الحجز أونلاين.</p>
       <p><b>المريض:</b> ${opts.patientName}<br/>
       <b>الهاتف:</b> ${opts.patientPhone}<br/>
       <b>الطبيب:</b> ${opts.doctorName}<br/>
       <b>الموعد:</b> ${dateStr}<br/>
       <b>رقم المرجع:</b> ${opts.refCode}</p>`,
      { url: dashboardUrl, label: "افتح لوحة التحكم" }
    ),
  });
}