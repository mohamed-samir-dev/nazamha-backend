const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
(async()=>{
 const dir=path.resolve(__dirname,'../../reports/students-audit-runtime');
 const qa=JSON.parse(fs.readFileSync(path.join(dir,'session.json')));
 if(!/^qa\.students\..+@example\.invalid$/.test(qa.email))throw Error('QA only');
 const base='http://localhost:5011/api', rows=[];
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qa.email,password:qa.password}),signal:AbortSignal.timeout(20000)});
 if(!login.ok)throw Error('login '+login.status);
 const cookies=login.headers.getSetCookie().map(x=>x.split(';')[0]);
 const csrf=await fetch(base+'/csrf-token',{headers:{Cookie:cookies.join('; ')}});cookies.push(...csrf.headers.getSetCookie().map(x=>x.split(';')[0]));
 const headers={Cookie:cookies.join('; '),'Content-Type':'application/json','x-csrf-token':(await csrf.json()).csrfToken};
 async function call(label,route,method='GET',body,key=randomUUID()) {const t=performance.now();const r=await fetch(base+route,{method,headers:{...headers,'Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();rows.push({label,status:r.status,ms:Math.round(performance.now()-t)});if(r.status>=500)throw Error(label+' '+r.status);return d;}
 const st=await call('permanent ID lookup','/students/scan?qr=6ad339084defffaef6189387');
 if(st.name!=='طالب مراجعة الواجهة')throw Error('QA student mismatch');
 await call('group code lookup','/students/scan?qr='+encodeURIComponent(st.code));
 await call('unknown code','/students/scan?qr=INVALID-AUDIT-CODE');
 const subs=await call('subscriptions','/subscriptions/student/'+st.id), target=subs.find(x=>x.status==='due');
 if(!target)throw Error('no disposable due month');
 const route='/subscriptions/student/'+st.id+'/bulk-update',body={updates:[{id:target.id,status:'paid'}]},key=randomUUID();
 try {
 const paid=await call('bulk pay',route,'POST',body,key);
 rows.push({label:'bulk response identity',hasId:!!paid[0]?.id,hasMongoId:!!paid[0]?._id});
 const replay=await call('same key replay',route,'POST',body,key);
 rows.push({label:'replay timestamp stable',pass:paid[0].paid_at===replay[0].paid_at});
 const repeat=await call('different key same payment',route,'POST',body);
 rows.push({label:'repeat changed paid_at',observed:paid[0].paid_at!==repeat[0].paid_at});
 }finally{await call('restore QA due month','/subscriptions/'+target.id,'PATCH',{status:target.status,paid_at:target.paid_at});}
 fs.writeFileSync(path.join(dir,'payment-scan-api-audit.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
