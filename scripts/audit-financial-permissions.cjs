// Exercise only the actual middleware. No live accounts or database writes.
const path=require('path'),fs=require('fs');
require('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../tsconfig.json')});
const {enforceResourcePermissions}=require('../src/middleware/resourcePermissions');
const staff={staff_permissions:['students'],is_admin:false,financial_permissions:[]};
const admin={is_admin:true,is_super_admin:false,financial_permissions:['financial.viewRevenue']};
const cases=[
 ['staff direct discount',staff,'/family-discount',{percent:50}],
 ['staff link inherits discount',staff,'/link-siblings',{studentIds:['a','b']}],
 ['staff unlink removes discount',staff,'/unlink-sibling',{studentId:'a'}],
 ['staff transfer family reprices',staff,'/transfer-family',{studentId:'a',targetFamilyId:'b'}],
 ['staff transfer group reprices',staff,'/a',{group_id:'b'},'PATCH'],
 ['staff subscription start hides earlier debt',staff,'/a',{subscription_start_month:12,subscription_start_year:2026},'PATCH'],
 ['admin direct price',admin,'/a',{custom_monthly_price:1},'PATCH'],
 ['admin bulk custom price',admin,'/bulk',{teacher_id:'qa',students:[{name:'طالب اختبار',custom_monthly_price:1}]}]
];
const results=cases.map(([label,user,route,body,method='POST'])=>{let allowed=false,denied=false;const response={status(){denied=true;return this},json(){return this}};enforceResourcePermissions({user,baseUrl:'/api/students',path:route,method,body},response,()=>{allowed=true});return{label,allowed,denied,expectedDeny:true,pass:denied&&!allowed}});
fs.writeFileSync(path.resolve(__dirname,'../../reports/live-teacher-audit-2026-10-21/financial-permission-fixed.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
require('assert/strict').ok(results.every(result=>result.pass),'Financial permission regression');
