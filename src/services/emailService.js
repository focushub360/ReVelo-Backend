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
export async function sendVerificationRequest({ email, name, dealershipName, token, message }) {
  const client = mailer();
  const verificationUrl = `${env.CLIENT_ORIGIN}/verify-documents?token=${encodeURIComponent(token)}`;
  if (!client) return { status: 'not_configured', verificationUrl: env.NODE_ENV === 'development' ? verificationUrl : undefined };
  const greeting = `Hello ${name},`;
  const privacy = 'Your details and documents will be used only to verify this vehicle enquiry and will not be used for unrelated purposes.';
  await client.sendMail({
    from: env.SMTP_FROM, to: email,
    subject: `ReVelo verification request for your vehicle`,
    text: `${greeting}\n\nThank you for your vehicle enquiry with ${dealershipName}.${message ? `\n\n${message}` : ''}\n\nFor the next verification stage, please use this secure private link to provide the requested documents: ${verificationUrl}\n\n${privacy}\n\nThis link expires in 7 days.`,
    html: `<p>${escapeHtml(greeting)}</p><p>Thank you for your vehicle enquiry with <strong>${escapeHtml(dealershipName)}</strong>.</p>${message ? `<p>${escapeHtml(message)}</p>` : ''}<p>For the next verification stage, please use this <a href="${verificationUrl}">secure private link</a> to provide the requested documents.</p><p><strong>Your privacy matters:</strong> ${escapeHtml(privacy)}</p><p>This link expires in 7 days.</p>`,
  });
  return { status: 'sent' };
}
export async function sendDocumentCorrectionRequest({ email, name, token, category, reason }) {
  const client = mailer();
  const verificationUrl = `${env.CLIENT_ORIGIN}/verify-documents?token=${encodeURIComponent(token)}`;
  if (!client) return { status: 'not_configured', verificationUrl: env.NODE_ENV === 'development' ? verificationUrl : undefined };
  await client.sendMail({
    from: env.SMTP_FROM, to: email,
    subject: `Action needed: update your ${category} for ReVelo`,
    text: `Hello ${name},\n\nWe reviewed your ${category}, but it needs an update before we can continue.\n\nReason: ${reason}\n\nPlease use this secure link to upload a corrected document or provide the requested information: ${verificationUrl}\n\nYour documents are used only to verify your vehicle enquiry. This link expires in 7 days.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>We reviewed your <strong>${escapeHtml(category)}</strong>, but it needs an update before we can continue.</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p><p>Please use this <a href="${verificationUrl}">secure link</a> to upload a corrected document or provide the requested information.</p><p>Your documents are used only to verify your vehicle enquiry. This link expires in 7 days.</p>`,
  });
  return { status: 'sent' };
}
export async function sendInspectionStartedNotice({ email, name, registration }) {
  const client = mailer();
  if (!client) return { status: 'not_configured' };
  await client.sendMail({
    from: env.SMTP_FROM, to: email,
    subject: `Your vehicle ${registration || ''} is under technical inspection | ReVelo`,
    text: `Hello ${name},\n\nYour vehicle ${registration || ''} has entered the ReVelo technical inspection stage. Our Senior Technician is reviewing the vehicle's mechanical, structural, and road-test condition. We will update you once the assessment is complete.\n\nThank you,\nReVelo`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Your vehicle <strong>${escapeHtml(registration || '')}</strong> has entered the ReVelo technical inspection stage.</p><p>Our Senior Technician is reviewing its mechanical, structural, and road-test condition. We will update you once the assessment is complete.</p><p>Thank you,<br/>ReVelo</p>`,
  });
  return { status: 'sent' };
}
export async function sendSellerMeetingScheduled({ email, name, registration, kind, scheduledAt, location, agenda }) {
  const client = mailer(); if (!client) return { status: 'not_configured' };
  const when = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  await client.sendMail({ from: env.SMTP_FROM, to: email, subject: `ReVelo ${kind} scheduled for ${registration || 'your vehicle'}`, text: `Hello ${name},\n\nYour ${kind} has been scheduled for ${when}.${location ? `\nLocation / call mode: ${location}` : ''}${agenda ? `\nAgenda: ${agenda}` : ''}\n\nPlease keep your vehicle and relevant documents ready.\n\nReVelo`, html: `<p>Hello ${escapeHtml(name)},</p><p>Your <strong>${escapeHtml(kind)}</strong> has been scheduled for <strong>${escapeHtml(when)}</strong>.</p>${location ? `<p><strong>Location / call mode:</strong> ${escapeHtml(location)}</p>` : ''}${agenda ? `<p><strong>Agenda:</strong> ${escapeHtml(agenda)}</p>` : ''}<p>Please keep your vehicle and relevant documents ready.</p><p>ReVelo</p>` });
  return { status: 'sent' };
}
export async function sendVehicleIntakeRejectionNotice({ email, name, registration, reason }) {
  const client = mailer(); if (!client) return { status: 'not_configured' };
  await client.sendMail({ from: env.SMTP_FROM, to: email, subject: `Update on your vehicle ${registration || ''} | ReVelo`, text: `Hello ${name},\n\nFollowing the physical assessment of your vehicle ${registration || ''}, we are unable to proceed with technical inspection at this time.\n\nReason: ${reason}\n\nThank you for your time.\nReVelo`, html: `<p>Hello ${escapeHtml(name)},</p><p>Following the physical assessment of your vehicle <strong>${escapeHtml(registration || '')}</strong>, we are unable to proceed with technical inspection at this time.</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p><p>Thank you for your time.<br/>ReVelo</p>` });
  return { status: 'sent' };
}
