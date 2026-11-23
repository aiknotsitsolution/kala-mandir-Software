import nodemailer from "nodemailer";
import { ApiError } from "../lib/errors.js";

let transporter = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function renderBrandedEmail({
  preheader,
  eyebrow,
  title,
  greeting,
  message,
  otpCode,
  details = [],
  action,
  note,
}) {
  const safe = (value) => escapeHtml(value ?? "");
  const detailText = details.map(({ label, value }) => `${label}: ${value}`).join("\n");
  const text = [
    title,
    "",
    `Hello ${greeting || "there"},`,
    message,
    otpCode ? `\nYour verification code: ${otpCode}` : "",
    detailText ? `\n${detailText}` : "",
    action ? `\n${action.label}: ${action.url}` : "",
    note ? `\n${note}` : "",
    "\nKala Mandir Dance Institute",
  ].filter(Boolean).join("\n");

  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #eadfc9;border-radius:10px;background:#fcfaf5;">${details.map(({ label, value }) => `<tr><td style="padding:11px 14px;color:#786b61;font-size:13px;border-bottom:1px solid #eee6d8;">${safe(label)}</td><td align="right" style="padding:11px 14px;color:#241a1e;font-size:13px;font-weight:600;border-bottom:1px solid #eee6d8;">${safe(value)}</td></tr>`).join("")}</table>`
    : "";
  const otpHtml = otpCode
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 18px;"><tr><td align="center" style="padding:18px 12px;border:1px solid #eadfc9;border-radius:12px;background:#fcfaf5;"><div style="margin-bottom:8px;color:#786b61;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Your one-time code</div><div style="color:#310d20;font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:700;letter-spacing:9px;">${safe(otpCode)}</div></td></tr></table>`
    : "";
  const actionHtml = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;"><tr><td align="center" bgcolor="#310d20" style="border-radius:8px;"><a href="${safe(action.url)}" style="display:inline-block;padding:14px 24px;border:1px solid #c6a45b;border-radius:8px;color:#fffaf0;font-size:14px;font-weight:700;text-decoration:none;">${safe(action.label)}</a></td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
  <body style="margin:0;padding:0;background:#f4efe5;color:#241a1e;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safe(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe5;">
      <tr><td align="center" style="padding:32px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #e8dcc5;border-radius:14px;background:#fffdf8;overflow:hidden;">
          <tr><td style="padding:27px 32px 24px;background:#310d20;border-bottom:4px solid #c6a45b;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border:1px solid #c6a45b;border-radius:50%;color:#f5e8c8;font-size:15px;font-weight:700;">KM</td>
              <td style="padding-left:12px;color:#fffaf0;font-size:15px;font-weight:700;letter-spacing:1.2px;">KALA MANDIR<br><span style="color:#e8d7b5;font-size:10px;font-weight:400;letter-spacing:1.5px;">DANCE &amp; ART STUDIO</span></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:34px 32px 24px;">
            <div style="margin-bottom:9px;color:#9b8148;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">${safe(eyebrow)}</div>
            <h1 style="margin:0 0 20px;color:#310d20;font-size:27px;line-height:1.25;font-weight:700;">${safe(title)}</h1>
            <p style="margin:0 0 12px;color:#241a1e;font-size:15px;line-height:1.65;">Hello ${safe(greeting || "there")},</p>
            <p style="margin:0;color:#574b45;font-size:14px;line-height:1.7;">${safe(message)}</p>
            ${otpHtml}
            ${detailsHtml}
            ${actionHtml}
            ${note ? `<div style="margin-top:22px;padding:13px 15px;border-left:3px solid #c6a45b;background:#f8f3e8;color:#62564d;font-size:12px;line-height:1.65;">${safe(note)}</div>` : ""}
          </td></tr>
          <tr><td style="padding:18px 32px;border-top:1px solid #eee6d8;background:#fcfaf5;color:#786b61;font-size:11px;line-height:1.6;">
            This is an automated message from Kala Mandir Dance Institute. Please do not reply to this email.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { text, html };
}

function getTransporter() {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!host || !Number.isInteger(port) || !user || !pass) {
    throw new ApiError(503, "Email delivery is not configured on the server.", "email_delivery_failed");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    });
  } catch {
    throw new ApiError(503, "Unable to send email. Check the server email settings and try again.", "email_delivery_failed");
  }
}
