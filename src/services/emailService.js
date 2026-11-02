import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function mailer() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) return null;
  if (!transporter) transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
  return transporter;
}

export async function sendDealerInvitation({ email, name, dealershipName, token }) {
  const client = mailer();
  const invitationUrl = `${env.CLIENT_ORIGIN}/accept-invitation?token=${encodeURIComponent(token)}`;
  if (!client) return { status: 'not_configured', invitationUrl: env.NODE_ENV === 'development' ? invitationUrl : undefined };
  await client.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: `Set up your ReVelo account for ${dealershipName}`,
    text: `Hello ${name},\n\nYou have been invited to ReVelo for ${dealershipName}. Set your password within 72 hours: ${invitationUrl}\n\nIf you were not expecting this email, you can ignore it.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>You have been invited to ReVelo for <strong>${escapeHtml(dealershipName)}</strong>.</p><p><a href="${invitationUrl}">Set your password</a> within 72 hours.</p><p>If you were not expecting this email, you can ignore it.</p>`,
  });
  return { status: 'sent' };
}
