const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'../../reports/live-teacher-audit-2026-10-21'),base=process.env.AUDIT_API_BASE||'https://nazamha-backend.vercel.app/api';
(async()=>{
 const qa=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../reports/students-audit-runtime/session.json')));assert.match(qa.email,/^qa\.students\..+@example\.invalid$/);
 const fixture=JSON.parse(fs.readFileSync(path.join(dir,'financial-flow-audit.json')));assert.ok(fixture.completed);
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qa.email,password:qa.password})});assert.equal(login.status,200);const cookies=login.headers.getSetCookie().map(x=>x.split(';')[0]);
 const csrf=await fetch(base+'/csrf-token',{headers:{Cookie:cookies.join('; ')}});cookies.push(...csrf.headers.getSetCookie().map(x=>x.split(';')[0]));const headers={Cookie:cookies.join('; '),'Content-Type':'application/json','x-csrf-token':(await csrf.json()).csrfToken};
 async function call(route,method='GET',body){const res=await fetch(base+route,{method,headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});assert.equal(res.status,200);return res.json()}
 const me=await call('/auth/me');assert.equal(me.email,qa.email);const book=await call('/books/'+fixture.fixtures.book);assert.equal(book.teacher_id,me.id);
 const route='/books/student/'+fixture.fixtures.studentA,result={account:'dedicated QA',bookId:book.id,studentId:fixture.fixtures.studentA};
 result.before=(await call(route)).some(b=>b.book_id===book.id&&b.purchased);
 try{await call('/books/'+book.id,'PATCH',{status:'unavailable'});result.after=(await call(route)).some(b=>b.book_id===book.id&&b.purchased)}finally{await call('/books/'+book.id,'PATCH',{status:book.status});result.restored=(await call(route)).some(b=>b.book_id===book.id&&b.purchased)}
 result.issueReproduced=result.before&&!result.after&&result.restored;fs.writeFileSync(path.join(dir,process.env.AUDIT_API_BASE?'book-history-visibility-fixed.json':'book-history-visibility-audit.json'),JSON.stringify({...result,base},null,2));console.log(JSON.stringify(result));
 if(process.env.AUDIT_API_BASE)assert.ok(result.before&&result.after&&result.restored,'Purchased book history must stay visible');
})().catch(e=>{console.error(e.message);process.exitCode=1});
