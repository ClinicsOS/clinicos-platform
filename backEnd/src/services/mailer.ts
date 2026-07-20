/**
 * Email sending service — Brevo SMTP via nodemailer.
 *
 * Development fallback:
 *   If SMTP_USER/SMTP_PASS are empty, emails are logged to the console.
 *
 * Production (Brevo):
 *   - Sign up at https://brevo.com — the free tier is 300 emails/day.
 *   - From dashboard: SMTP & API → SMTP → note your login and SMTP key.
 *   - Set the environment variables below.
 */

import nodemailer, { Transporter } from "nodemailer";

const host = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const port = Number(process.env.SMTP_PORT) || 587;
const user = process.env.SMTP_USER || "";
const pass = process.env.SMTP_PASS || "";
const mailFrom = process.env.MAIL_FROM || "ClinicOS <clinicos.system@gmail.com>";
const appUrl = process.env.APP_URL || "http://localhost:3000";

let transporter: Transporter | null = null;
if (user && pass) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: false, // Brevo uses STARTTLS on 587, not implicit TLS
    auth: { user, pass },
  });

  // Verify once at startup so misconfiguration surfaces early in the logs
  transporter
    .verify()
    .then(() => console.log(`[MAILER] SMTP ready — sending as ${mailFrom} via ${host}`))
    .catch((err) => console.error("[MAILER] SMTP verify failed:", err.message));
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

async function send({ to, subject, html }: SendArgs): Promise<void> {
  if (!transporter) {
    // Dev fallback — print email to console so the developer can copy the link
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 [MAILER — dev mode, no SMTP configured]");
    console.log("To:      ", to);
    console.log("Subject: ", subject);
    console.log("──────────────────────────────────────────────────");
    console.log(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    console.log("═══════════════════════════════════════════════════");
    return;
  }
  try {
    const info = await transporter.sendMail({ from: mailFrom, to, subject, html });
    console.log(`[MAILER] ✔ Sent to ${to} — messageId: ${info.messageId}`);
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