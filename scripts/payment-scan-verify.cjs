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
 const lookup=await call('combined lookup','/subscriptions/lookup?qr='+encodeURIComponent(st.code));
 if(lookup.student.id!==st.id||!Array.isArray(lookup.subscriptions))throw Error('combined lookup mismatch');
 const route='/subscriptions/student/'+st.id+'/pay',body={items:[{id:target.id,amount:target.amount,discount:target.discount}]},key=randomUUID();
 const assert=(label,pass)=>{rows.push({label,pass});if(!pass)throw Error(label)};
 try {
 await call('stale amount rejection',route,'POST',{items:[{...body.items[0],amount:target.amount+1}]});
 assert('stale amount returns conflict',rows.at(-1).status===409);
 const paid=await call('scanner pay',route,'POST',body,key);
 assert('payment committed with receipt and IDs',paid.receipt?.id===key&&paid.receipt.amount===target.amount-target.discount&&paid.subscriptions.every(x=>!!x.id));
 const replay=await call('same key replay',route,'POST',body,key);
 assert('same key returns original receipt',JSON.stringify(paid)===JSON.stringify(replay));
 await call('different key same payment',route,'POST',body);
 assert('different key cannot charge paid month',rows.at(-1).status===409);
 const history=await call('durable payment history','/subscriptions/payments/recent');
 assert('receipt appears exactly once',history.filter(x=>x.id===key).length===1);
 const current=await call('verify payment timestamp','/subscriptions/student/'+st.id);
 assert('original paid timestamp preserved',current.find(x=>x.id===target.id).paid_at===paid.subscriptions.find(x=>x.id===target.id).paid_at);
 }finally{await call('restore QA due month','/subscriptions/'+target.id,'PATCH',{status:target.status,paid_at:target.paid_at});}
 fs.writeFileSync(path.join(dir,'payment-scan-api-verification.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
