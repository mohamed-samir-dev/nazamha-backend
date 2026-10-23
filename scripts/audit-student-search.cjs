const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.AUDIT_API_BASE||'http://localhost:5013/api';
(async()=>{
 const qa=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../reports/students-audit-runtime/session.json'),'utf8'));
 assert.match(qa.email,/^qa\.students\..+@example\.invalid$/);
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qa.email,password:qa.password}),signal:AbortSignal.timeout(30000)});
 assert.equal(login.status,200);
 const headers={Cookie:login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
 async function read(q){const res=await fetch(base+'/students?'+new URLSearchParams({page:'1',limit:'500',...(q?{search:q}:{})}),{headers,signal:AbortSignal.timeout(30000)});assert.equal(res.status,200);return res.json();}
 const page=await read();
 const student=page.students.find(s=>(s.center_student_code||s.code||'').includes('-'));assert.ok(student);
 const code=student.center_student_code||student.code;
 const prefix=code.slice(0,code.indexOf('-'));
 const results=[];
 for(const [label,q] of [['prefix',prefix],['prefix with dash',prefix+'-'],['complete code',code],['copied Unicode dash',code.replace('-','–')],['Arabic digits',code.replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)])],['bidirectional pasted code','\u200f'+code+'\u200e']]){
  const result=await read(q);const found=result.students.some(s=>s.id===student.id);results.push({label,status:200,found});assert.ok(found,label);
 }
 const negative=await read('.*');assert.ok(!negative.students.some(s=>s.id===student.id));results.push({label:'regex punctuation is literal',pass:true});
 const cleared=await read();assert.equal(cleared.total,page.total);results.push({label:'clearing returns the full QA result count',pass:true});
 const report={base,account:'dedicated QA',results,completed:true};
 fs.writeFileSync(path.resolve(__dirname,'../../reports/student-search-api-2026-10-23.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
