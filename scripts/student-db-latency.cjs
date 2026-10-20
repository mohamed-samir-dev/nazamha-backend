// Read-only latency probe; never logs connection strings or student records.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
async function main() {
  const root = path.resolve(__dirname, '../../reports/students-audit-runtime');
  const qa = JSON.parse(fs.readFileSync(path.join(root, 'session.json')));
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, maxPoolSize: 2, serverSelectionTimeoutMS: 15000 });
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await mongoose.connection.db.command({ ping: 1 });
    const pingMs = Math.round(performance.now() - start);
    const readStart = performance.now();
    await mongoose.connection.db.collection('teachers').findOne({ _id: new mongoose.Types.ObjectId(qa.teacherId) }, { projection: { _id: 1 } });
    samples.push({ pingMs, indexedReadMs: Math.round(performance.now() - readStart) });
  }
  fs.writeFileSync(path.join(root, 'db-latency-2026-10-16.json'), JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples));
}
main().catch(e => { console.error(e.name); process.exitCode = 1; }).finally(() => mongoose.disconnect());
