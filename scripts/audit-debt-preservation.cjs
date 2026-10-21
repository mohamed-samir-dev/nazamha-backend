// Isolated reproduction: real service, mocked models; never connects to MongoDB.
require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../tsconfig.json')});
const Module=require('module'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const original=Module._load,deleted=[],query=(rows)=>({lean(){return this},select(){return Promise.resolve(rows)}});
const records=[{_id:'old-overdue',student_id:'qa-student',month:10,year:2025,status:'due',amount:600,discount:0},{_id:'current-due',student_id:'qa-student',month:10,year:2026,status:'due',amount:600,discount:0}];
const models={
 Teacher:{findById:()=>({lean:async()=>({monthly_price:600,academic_year:{active_month_years:[{month:10,year:2026}]}})})},
 Student:{find:()=>query([{_id:'qa-student',subscription_start_month:10,subscription_start_year:2025}])},
 Group:{find:()=>query([])},
 MonthlySubscription:{find:(filter)=>query(filter.status?records:records.filter(r=>!deleted.includes(r._id))),deleteMany:async(filter)=>{deleted.push(...filter._id.$in);return{deletedCount:filter._id.$in.length}},bulkWrite:async()=>({})}
};
Module._load=function(id,parent,...rest){for(const [name,model] of Object.entries(models))if(id.endsWith('/models/'+name))return{[name]:model};return original.call(this,id,parent,...rest)};
(async()=>{try{const {syncAllStudentsForTeacher}=require('../src/services/subscriptionLifecycle');await syncAllStudentsForTeacher('isolated-qa');const result={mode:'real service with in-memory mocked model methods; no database',oldDebt:records[0],deletedIds:deleted,debtPreserved:!deleted.includes('old-overdue')};assert.ok(result.debtPreserved,'Old debt must be preserved');fs.writeFileSync(path.resolve(__dirname,'../../reports/live-teacher-audit-2026-10-21/debt-preservation-fixed.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{Module._load=original}})().catch(e=>{console.error(e);process.exitCode=1});
