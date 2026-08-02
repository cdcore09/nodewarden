import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgInviteEmail, sendOrgInviteEmail, isOrgEmailConfigured } from '../src/services/org-mail';

const params = {
  toEmail: 'parent@example.com',
  orgName: 'Parents Household',
  orgId: 'org-1',
  orgUserId: 'ou-1',
  token: 'tok.abc',
  inviteCode: 'REG-CODE-1',
  siteUrl: 'https://vault-test.example.com',
};

test('buildOrgInviteEmail produces a complete message with a well-formed accept link', () => {
  const msg = buildOrgInviteEmail(params);
  assert.equal(msg.to, 'parent@example.com');
  assert.ok(msg.subject.includes('Parents Household'));
  const link = `https://vault-test.example.com/#/accept-organization?organizationId=org-1&organizationUserId=ou-1&email=${encodeURIComponent('parent@example.com')}&token=tok.abc&inviteCode=REG-CODE-1`;
  assert.ok(msg.text.includes(link), `text should contain ${link}`);
  assert.ok(msg.html && msg.html.includes('accept-organization'));
});

test('buildOrgInviteEmail omits inviteCode param when not provided', () => {
  const msg = buildOrgInviteEmail({ ...params, inviteCode: null });
  assert.ok(!msg.text.includes('inviteCode='));
});

test('buildOrgInviteEmail strips control chars/CRLF from the org name before it reaches headers or body', () => {
  const msg = buildOrgInviteEmail({ ...params, orgName: 'Evil\r\nBcc: attacker@example.com' });
  assert.ok(!/[\r\n]/.test(msg.subject), `subject should have no CR/LF: ${JSON.stringify(msg.subject)}`);
  assert.ok(msg.subject.includes('EvilBcc: attacker@example.com'));
  assert.ok(!msg.text.includes('\r'), 'text should contain no bare CR');
  assert.ok(msg.html && msg.html.includes('EvilBcc: attacker@example.com'));
  assert.ok(msg.html && !msg.html.includes('\r'), 'html should contain no bare CR');
});

test('sendOrgInviteEmail throws when email is not configured', async () => {
  await assert.rejects(
    () => sendOrgInviteEmail({ EMAIL_FROM: 'x@y.z' } as any, params),
    /Email is not configured/
  );
  assert.equal(isOrgEmailConfigured({} as any), false);
});

test('sendOrgInviteEmail delivers through the EMAIL binding with the configured from', async () => {
  const sent: any[] = [];
  const env: any = { EMAIL: { send: async (m: any) => { sent.push(m); } }, EMAIL_FROM: 'vault@corderocore.com' };
  await sendOrgInviteEmail(env, params);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].from, { email: 'vault@corderocore.com', name: 'NodeWarden' });
});
