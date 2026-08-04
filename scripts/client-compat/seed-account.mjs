// Registers a Bitwarden-CLI-compatible account against a running NodeWarden.
// Usage: node scripts/client-compat/seed-account.mjs <BASE_URL> <EMAIL> <PASSWORD>
// The register endpoint enforces a same-origin write check, so the Origin
// header must be set to BASE explicitly (Node fetch omits it by default).
import { makeRegistrationPayload } from './crypto.mjs';

const [BASE, EMAIL, PASSWORD] = process.argv.slice(2);
if (!BASE || !EMAIL || !PASSWORD) {
  console.error('usage: seed-account.mjs BASE_URL EMAIL PASSWORD');
  process.exit(1);
}

const payload = makeRegistrationPayload(EMAIL, PASSWORD);
const res = await fetch(`${BASE}/api/accounts/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify(payload),
});
if (res.status !== 200) {
  console.error(`register failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`seeded ${EMAIL}`);
