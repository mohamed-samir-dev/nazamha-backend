const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const base=process.env.AUDIT_API_BASE||'http://localhost:5013/api';
const dir=path.resolve(__dirname,'../../reports/live-teacher-audit-2026-10-21');
(async()=>{
 const qa=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../reports/students-audit-runtime/session.json')));assert.match(qa.email,/^qa\.students\..+@example\.invalid$/);
 const checks=[],results=[];
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qa.email,password:qa.password}),signal:AbortSignal.timeout(30000)});assert.equal(login.status,200);
 const cookies=login.headers.getSetCookie().map(x=>x.split(';')[0]),headers={Cookie:cookies.join('; ')};
 async function call(label,route,{publicRead=false,expected=200,authorization}={}){const start=performance.now();const res=await fetch(base+route,{headers:authorization?{Authorization:authorization}:publicRead?{}:headers,signal:AbortSignal.timeout(30000)});const data=await res.json();results.push({label,status:res.status,expected,ms:Math.round(performance.now()-start)});assert.equal(res.status,expected,label);return data;}
 const check=(label,value)=>{checks.push({label,pass:!!value});assert.ok(value,label)};
 const me=await call('QA owner','/auth/me');assert.equal(me.email,qa.email);
 const id='6ad339084defffaef6189387',student=await call('profile QR metadata','/students/'+id);
 const page=await call('printed card metadata','/students?page=1&limit=500');
 check('profile and printed card share the same signed token',/^[a-f0-9]{64}$/.test(student.card_qr_token)&&page.students.find(s=>s.id===id)?.card_qr_token===student.card_qr_token);
 const url=process.env.AUDIT_QR_URL_FILE?fs.readFileSync(process.env.AUDIT_QR_URL_FILE,'utf8').trim():(process.env.AUDIT_FRONTEND_ORIGIN||'http://localhost:3000')+'/report/'+id+'?card='+student.card_qr_token;
 const decoded=new URL(url);check('rendered QR targets the same student and permanent capability',decoded.pathname==='/report/'+id&&decoded.searchParams.get('card')===student.card_qr_token&&!decoded.searchParams.has('token'));
 const report=await call('parent reads report without login','/public/student/'+id+'?card='+student.card_qr_token,{publicRead:true});
 check('public report belongs to the scanned child',report.name===student.name);
 check('public report has no internal notes, contacts or authentication data',!['notes','parent_phone','student_email','password','card_qr_token'].some(key=>Object.hasOwn(report,key)));
 await call('bare ID cannot read report','/public/student/'+id,{publicRead:true,expected:401});
 await call('tampered capability cannot read report','/public/student/'+id+'?card='+'0'.repeat(64),{publicRead:true,expected:401});
 await call('another child cannot use this card','/public/student/6ad8c45dd6a41a11268dca77?card='+student.card_qr_token,{publicRead:true,expected:401});
 await call('card is not an authenticated teacher session','/students/'+id,{authorization:'Bearer '+student.card_qr_token,expected:401});
 await call('anonymous lookup cannot initiate a payment','/subscriptions/lookup?qr='+encodeURIComponent(url),{publicRead:true,expected:401});
 const attendance=await call('attendance recognizes the unified QR','/students/scan?qr='+encodeURIComponent(url));check('attendance identity matches the printed card',attendance.id===id);
 const payment=await call('payment recognizes the unified QR','/subscriptions/lookup?qr='+encodeURIComponent(url));check('payment identity matches the printed card',payment.student.id===id);
 const summary=await call('summary identifiers','/subscriptions/summary');check('summary has valid student identifiers',summary.every(row=>row.id===row.studentId&&row.id!=='undefined'));
 const out={base,time:new Date().toISOString(),account:'dedicated QA',results,checks,completed:true};fs.writeFileSync(path.join(dir,process.env.AUDIT_REPORT_FILE||'unified-card-fixed.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1});
