const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '../../reports/students-audit-runtime');
fs.mkdirSync(root, {recursive:true});
let auditBrowser;
async function main() {
 if (process.argv[2] === 'setup') {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const {Teacher}=require('../dist/models/Teacher');
  const {Grade}=require('../dist/models/Grade');
  const {Group}=require('../dist/models/Group');
  const {Student}=require('../dist/models/Student');
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
  const stamp=Date.now(), email=`qa.students.${stamp}@example.invalid`, password=require('crypto').randomBytes(18).toString('base64url');
  const teacher=await Teacher.create({name:'اختبار صفحة الطلاب أكتوبر',email,password,slug:`qa-students-${stamp}`,is_active:true,subscription:{status:'active',expires_at:new Date('2027-12-31'),students_limit:1000},features:{attendance:true,bills:true,library:true,exams:true},academic_year:{active_months:[9,10,11,12],active_month_years:[{month:9,year:2026},{month:10,year:2026},{month:11,year:2026},{month:12,year:2026}]}});
  const grades=await Grade.create([{name:'اختبار أول',teacher_id:teacher._id,monthly_price:200},{name:'اختبار ثان',teacher_id:teacher._id,monthly_price:250}]);
  const groups=await Group.create([{name:'اختبار أ',code:'QA',teacher_id:teacher._id,grade_id:grades[0]._id,day_of_week:'الأحد',time:'18:00',monthly_price:200},{name:'اختبار ب',code:'QB',teacher_id:teacher._id,grade_id:grades[0]._id,day_of_week:'الأحد',time:'19:00',monthly_price:250},{name:'اختبار ج',code:'QC',teacher_id:teacher._id,grade_id:grades[1]._id,day_of_week:'الأحد',time:'20:00',monthly_price:250}]);
  const students=await Student.insertMany(Array.from({length:45},(_,i)=>({teacher_id:teacher._id,name:`طالب اختبار ${String(i+1).padStart(2,'0')}`,code:`${i<40?'QA':'QC'}-${String(i+1).padStart(3,'0')}`,grade_id:grades[i<40?0:1]._id,group_id:groups[i<40?0:2]._id,group_join_date:'2026-10-14',subscription_start_month:10,subscription_start_year:2026})));
  fs.writeFileSync(path.join(root,'session.json'),JSON.stringify({teacherId:String(teacher._id),email,password,grades:grades.map(x=>String(x._id)),groups:groups.map(x=>String(x._id)),students:students.map(x=>String(x._id))}));
  await mongoose.disconnect(); console.log('Created isolated QA teacher, 2 grades, 3 groups, 45 synthetic students'); return;
 }
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9335'});
 auditBrowser = browser;
 const pages=await browser.pages(); const page=pages.find(p=>p.url().includes('localhost:3000')) || await browser.newPage();
 const events=[]; const errors=[];
 page.on('response',r=>{if(r.url().includes(':5000'))events.push({url:r.url().replace(/^.*\/api/,'/api'),status:r.status()});});
 page.on('pageerror',e=>errors.push(e.message));
 const mode=process.argv[2];
 if(mode==='login'){
  const session=JSON.parse(fs.readFileSync(path.join(root,'session.json')));
  await page.type('input[type=email]',session.email);await page.type('input[type=password]',session.password);
  await page.click('button[type=submit]');await page.waitForNavigation({waitUntil:'networkidle2',timeout:60000}).catch(()=>{});
  await page.goto('http://localhost:3000/teacher/students',{waitUntil:'networkidle2',timeout:60000});
 } else if(mode==='eval') {
  const source=fs.readFileSync(path.join(root,'action.js'),'utf8');
  console.log(JSON.stringify(await (new Function('page','browser','root','fs',`return (async()=>{${source}})()`))(page,browser,root,fs)));
 }
 await page.screenshot({path:path.join(root,'latest.png'),fullPage:true});
 console.log(JSON.stringify({url:page.url(),text:(await page.evaluate(()=>document.body.innerText)).slice(0,2000),controls:await page.evaluate(()=>Array.from(document.querySelectorAll('input,select,button,a')).slice(0,40).map((e,i)=>({i,tag:e.tagName,type:e.type,text:(e.innerText||e.title||e.placeholder||'').slice(0,75),name:e.name,href:e.getAttribute('href'),options:e.tagName==='SELECT'?Array.from(e.options).map(o=>({text:o.text,value:o.value})):undefined}))),events,errors}));
 fs.writeFileSync(path.join(root,`last-${mode}.json`),JSON.stringify({events,errors}));
 browser.disconnect();
}
main().catch(e=>{console.error(e);auditBrowser?.disconnect();process.exitCode=1});

