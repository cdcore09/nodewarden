// Org invitation email over the Cloudflare send_email binding.
// Pure builder is separated from the sender so tsx tests cover the content.
import type { Env } from '../types';

export interface OrgInviteEmailParams {
  toEmail: string;
  orgName: string;
  orgId: string;
  orgUserId: string;
  token: string;
  // Registration invite code for recipients with no account yet; null when
  // the recipient already has an account on this server.
  inviteCode: string | null;
  siteUrl: string;
}

export interface OrgEmailMessage {
  to: string;
  from?: { email: string; name?: string };
  subject: string;
  text: string;
  html?: string;
}

export function buildOrgInviteEmail(p: OrgInviteEmailParams): OrgEmailMessage {
  const query = new URLSearchParams({
    organizationId: p.orgId,
    organizationUserId: p.orgUserId,
    email: p.toEmail,
    token: p.token,
  });
  if (p.inviteCode) query.set('inviteCode', p.inviteCode);
  const link = `${p.siteUrl.replace(/\/$/, '')}/#/accept-organization?${query.toString()}`;

  const subject = `You have been invited to the "${p.orgName}" organization`;
  const text = [
    `You have been invited to join the "${p.orgName}" organization on a NodeWarden password server.`,
    '',
    'To accept, open this link, create your account if you do not have one yet, and follow the steps:',
    link,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
    'This invitation link expires in 7 days.',
  ].join('\n');
  const html = [
    `<p>You have been invited to join the <strong>${escapeHtml(p.orgName)}</strong> organization on a NodeWarden password server.</p>`,
    `<p><a href="${link}">Accept the invitation</a> (create your account first if you do not have one yet).</p>`,
    '<p>If you were not expecting this invitation, you can ignore this email. This link expires in 7 days.</p>',
  ].join('\n');

  return { to: p.toEmail, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isOrgEmailConfigured(env: Env): boolean {
  return !!(env.EMAIL && typeof env.EMAIL.send === 'function' && env.EMAIL_FROM);
}

export async function sendOrgInviteEmail(env: Env, p: OrgInviteEmailParams): Promise<void> {
  if (!isOrgEmailConfigured(env)) {
    throw new Error('Email is not configured on this server');
  }
  const msg = buildOrgInviteEmail(p);
  await env.EMAIL!.send({ ...msg, from: { email: env.EMAIL_FROM!, name: 'NodeWarden' } });
}
