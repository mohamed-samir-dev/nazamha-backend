const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'../../reports/live-teacher-audit-2026-10-21');
const base='https://nazamha-backend.vercel.app/api';
(async()=>{
  const qa=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../reports/students-audit-runtime/session.json')));
  assert.match(qa.email,/^qa\.students\..+@example\.invalid$/);
  const results=[],issues=[];
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qa.email,password:qa.password}),signal:AbortSignal.timeout(25000)});
  assert.equal(login.status,200,'QA login');
  let cookies=login.headers.getSetCookie().map(x=>x.split(';')[0]);
  async function call(label,route,expected=200){const start=performance.now();const res=await fetch(base+route,{headers:{Cookie:cookies.join('; ')},signal:AbortSignal.timeout(25000)});const data=await res.json();results.push({label,status:res.status,expected,ms:Math.round(performance.now()-start),pass:res.status===expected});if(res.status!==expected)issues.push({label,status:res.status,message:data.message});return data;}
  const me=await call('account ownership','/auth/me');assert.equal(me.email,qa.email,'Only the dedicated QA account may be audited');
  const [grades,groups,page,subs,dashboard,families]=await Promise.all([
    call('grades','/grades'),call('groups','/groups'),call('student page','/students?page=1&limit=500'),
    call('all subscriptions','/subscriptions'),call('dashboard summary','/dashboard?summary=1&month=10&year=2026&refresh=1'),call('families','/students/siblings'),
  ]);
  assert.ok(Array.isArray(page.students)&&Array.isArray(subs)&&Array.isArray(groups));
  const students=page.students,studentMap=new Map(students.map(s=>[s.id,s])),groupMap=new Map(groups.map(g=>[g.id,g]));
  const keys=new Set();
  for(const sub of subs){const key=[sub.student_id,sub.year,sub.month].join(':');if(keys.has(key))issues.push({kind:'duplicate month',id:sub.id});keys.add(key);
    if(!studentMap.has(sub.student_id))issues.push({kind:'orphan or foreign student subscription',id:sub.id});
    if(!Number.isFinite(sub.amount)||!Number.isFinite(sub.discount)||sub.amount<0||sub.discount<0||sub.discount>sub.amount)issues.push({kind:'invalid money',id:sub.id,amount:sub.amount,discount:sub.discount});
    const student=studentMap.get(sub.student_id);
    if(student&&['due','not_due'].includes(sub.status)){const pct=student.family_discount_percent>0?student.family_discount_percent:(student.discount_value||0),expected=sub.amount-Math.round(sub.amount*(1-pct/100));if(sub.discount!==expected)issues.push({kind:'stale unpaid discount',studentId:student.id,subscriptionId:sub.id,month:sub.month,year:sub.year,amount:sub.amount,discount:sub.discount,expected});}
  }
  const active=subs.filter(s=>s.year===2026&&s.month===10&&studentMap.has(s.student_id));
  const paid=active.filter(s=>['paid','exempt'].includes(s.status)).length,due=active.filter(s=>s.status==='due').length;
  if(dashboard.totals?.paid!==paid||dashboard.totals?.due!==due||dashboard.totals?.totalStudents!==page.total)issues.push({kind:'dashboard mismatch',actual:dashboard.totals,expected:{paid,due,totalStudents:page.total}});
  const summary=await call('subscription summary','/subscriptions/summary');
  if(summary.some(s=>s.id==='undefined'))issues.push({kind:'summary returns literal undefined ID',count:summary.filter(s=>s.id==='undefined').length});
  const profile=await call('student profile','/students/6ad339084defffaef6189387');
  if(profile.id){await call('student subscriptions','/subscriptions/student/'+profile.id);await call('student memberships','/students/'+profile.id+'/memberships');await call('QR combined lookup','/subscriptions/lookup?qr='+profile.id);await call('QR code lookup','/students/scan?qr='+encodeURIComponent(profile.code||profile.id));}
  await call('unknown QR','/subscriptions/lookup?qr=INVALID-LIVE-AUDIT-CODE',404);
  await call('foreign student isolation','/students/6ad0b5f67a9d51b28eea4637',404);
  await call('foreign subscriptions isolation','/subscriptions/student/6ad0b5f67a9d51b28eea4637',404);
  await call('payment history','/subscriptions/payments/recent');
  await call('unpaid dashboard list','/dashboard/payments?unpaid=1&month=10&year=2026&page=1');
  await call('financial dashboard data','/dashboard/payments?month=10&year=2026');
  await call('books','/books');await call('book delivery counts','/books/sales-count?student_ids='+students.slice(0,5).map(s=>s.id).join(','));
  const report={base,account:'dedicated QA',time:new Date().toISOString(),totals:{students:page.total,groups:groups.length,grades:grades.length,subscriptions:subs.length,families:families.length},results,issues};
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'read-api-audit.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(dir,'qa-fixtures.json'),JSON.stringify({ownerId:me.id,grades,groups,students,subscriptions:subs,families},null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
