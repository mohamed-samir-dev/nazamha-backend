// API audit restricted to the existing isolated QA account. Never logs credentials.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '../../reports/students-audit-runtime');
const results = [];
async function main() {
  const qa = JSON.parse(fs.readFileSync(path.join(root, 'session.json')));
  if (!/^qa\.students\..+@example\.invalid$/.test(qa.email)) throw Error('Isolated QA account required');
  const base = 'http://localhost:5000/api';
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({email: qa.email,password:qa.password}) });
  if (!login.ok) throw Error('QA login: ' + login.status);
  const cookies = login.headers.getSetCookie().map(v => v.split(';')[0]);
  const csrf = await fetch(base + '/csrf-token', { headers: { Cookie: cookies.join('; ') } });
  cookies.push(...csrf.headers.getSetCookie().map(v => v.split(';')[0]));
  const {csrfToken} = await csrf.json();
  const headers = { Cookie: cookies.join('; '), 'Content-Type':'application/json', 'x-csrf-token':csrfToken };
  async function call(label, route, method='GET', body, expected=200, key=randomUUID()) {
    const start=performance.now();
    const response=await fetch(base+route,{method,headers:{...headers,'Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
    const raw=await response.text();let data;try {data=JSON.parse(raw);}catch{data=raw;}
    const row={label,status:response.status,expected,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(raw),pass:response.status===expected};
    results.push(row); console.log(JSON.stringify(row));
    if(!row.pass) throw Error(label+' failed: '+response.status+' '+(data?.message||''));
    return data;
  }
  for (let i=0;i<3;i++) {
    await call('dashboard '+i,'/dashboard?summaryOnly=1');
    await call('groups '+i,'/groups');
    await call('students page '+i,'/students?page=1&limit=50');
    await call('QR page '+i,'/students?page=1&limit=20');
    await call('siblings '+i,'/students/siblings');
  }
  await call('unpaid modal','/dashboard/payments?unpaid=1&month=10&year=2026&page=1');
  await call('student search','/students?page=1&limit=20&search='+encodeURIComponent('قياس'));
  await call('calendar export','/groups/calendar.ics');
  await call('invalid group rejected','/groups','POST',{name:'اختبار',day_of_week:'السبت',time:'25:00',monthly_price:-5},400);
  const group=await call('create group','/groups','POST',{name:'مجموعة فحص '+Date.now(),code:'Q'+require('crypto').randomBytes(2).toString('hex').slice(0,3).toUpperCase(),day_of_week:'السبت',time:'15:30',monthly_price:150,grade_id:qa.grades[0]},201);
  await call('edit group','/groups/'+group.id,'PATCH',{name:'مجموعة فحص معدلة'});
  await call('invalid cancellation','/groups/'+group.id+'/cancel-session','POST',{date:'2026-02-30'},400);
  await call('cancel session','/groups/'+group.id+'/cancel-session','POST',{date:'2026-10-17'});
  await call('restore session','/groups/'+group.id+'/cancel-session','POST',{date:'2026-10-17'});
  const student=await call('add student','/students','POST',{name:'طالب فحص الصفحات',grade_id:qa.grades[0],group_id:group.id,subscription_start_month:10,subscription_start_year:2026},201);
  await call('profile','/students/'+student.id);
  await call('memberships','/students/'+student.id+'/memberships');
  await call('move student','/students/'+student.id,'PATCH',{group_id:qa.groups[0]});
  await call('move student back','/students/'+student.id,'PATCH',{group_id:group.id});
  await call('rename missing family','/students/rename-family','POST',{familyId:'111111111111111111111111',familyName:'لا توجد'},404);
  const family=await call('create family','/students/create-family','POST',{familyName:'عائلة اختبار الصفحات',parentPhone:'01012345678'});
  await call('rename family','/students/rename-family','POST',{familyId:family.familyId,familyName:'عائلة اختبار معدلة'});
  await call('empty family discount rejected','/students/family-discount','POST',{familyId:family.familyId,percent:10},404);
  await call('delete empty family','/students/family/'+family.familyId,'DELETE');
  const key=randomUUID(), payload={students:[{name:'طالب اختبار استيراد',grade_id:qa.grades[0],group_id:group.id,subscription_start_month:10,subscription_start_year:2026}]};
  const first=await call('bulk import','/students/bulk','POST',payload,201,key);
  const replay=await call('bulk import replay','/students/bulk','POST',payload,201,key);
  if(first.students[0].id!==replay.students[0].id) throw Error('Idempotency replay changed student');
  await call('atomic group and students deletion','/groups/'+group.id,'DELETE',{deleteStudents:true});
  await call('deleted student gone','/students/'+student.id,'GET',undefined,404);
}
main().catch(error=>{results.push({error:error.message});console.error(error.message);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(root,'teacher-pages-api-2026-10-17.json'),JSON.stringify(results,null,2)));
