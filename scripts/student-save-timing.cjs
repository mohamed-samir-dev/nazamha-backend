// Uses only the isolated QA account created by students-page-audit.cjs.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../reports/students-audit-runtime');
async function main() {
  const qa = JSON.parse(fs.readFileSync(path.join(root, 'session.json')));
  if (!qa.email.startsWith('qa.students.') || !qa.email.endsWith('@example.invalid')) throw new Error('QA account required');
  const base = 'http://localhost:5000/api';
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: qa.email, password: qa.password }) });
  if (!login.ok) throw new Error('QA login failed: ' + login.status);
  const cookies = login.headers.getSetCookie().map(v => v.split(';')[0]);
  const csrf = await fetch(base + '/csrf-token', { headers: { Cookie: cookies.join('; ') } });
  cookies.push(...csrf.headers.getSetCookie().map(v => v.split(';')[0]));
  const { csrfToken } = await csrf.json();
  const headers = { Cookie: cookies.join('; '), 'Content-Type': 'application/json', 'x-csrf-token': csrfToken };
  if (process.argv[2] === 'report') {
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'new-student.json')));
    const response = await fetch(base + '/students/' + sample.id + '/share-token', { method: 'POST', headers, body: JSON.stringify({ ttl_hours: 1 }) });
    if (!response.ok) throw new Error('Report preparation failed');
    const report = await response.json();
    console.log('http://localhost:3000/report/' + sample.id + '?token=' + report.share_token);
    return;
  }
  const results = [];
  for (let i = 0; i < 3; i++) {
    let start = performance.now();
    const created = await fetch(base + '/students', { method: 'POST', headers: { ...headers, 'Idempotency-Key': require('crypto').randomUUID() }, body: JSON.stringify({ name: 'طالب قياس السرعة', grade_id: qa.grades[0], group_id: qa.groups[0], subscription_start_month: 10, subscription_start_year: 2026 }) });
    const student = await created.json();
    if (!created.ok) throw new Error('Creation failed: ' + created.status);
    const addMs = Math.round(performance.now() - start);
    start = performance.now();
    const moved = await fetch(base + '/students/' + student.id, { method: 'PATCH', headers: { ...headers, 'Idempotency-Key': require('crypto').randomUUID() }, body: JSON.stringify({ group_id: qa.groups[1] }) });
    const result = await moved.json();
    if (!moved.ok || result.group_id !== qa.groups[1] || !Array.isArray(result._subscriptions)) throw new Error('Transfer response validation failed');
    results.push({ addMs, transferMs: Math.round(performance.now() - start), subscriptions: result._subscriptions.length });
  }
  fs.writeFileSync(path.join(root, 'save-timing-2026-10-16.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
