import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { AttendanceLesson } from "../models/AttendanceLesson";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { Group } from "../models/Group";
import { Student } from "../models/Student";
import { StudentMembership } from "../models/StudentMembership";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { AttendanceSession } from "../models/AttendanceSession";
import { scheduledOn } from "../utils/attendanceSession";
import { buildLocalDate, getTodayInTimezone } from "../utils/timezoneUtils";
import { assertAttendanceWindow, attendanceTiming } from "../utils/attendanceTiming";
import { validStudentCard, studentCardToken } from "../utils/studentCard";
import { findScannedStudent } from "../utils/studentScan";

const oid = (value:unknown) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const event = (req:AuthRequest, action:string, reason:string, before?:unknown, after?:unknown) => ({actor_id:req.user!.actor_id || req.user!.id,actor_type:req.user!.actor_type || req.user!.user_type,at:new Date(),action,reason,before,after});
function reasonFor(req:AuthRequest) { const reason=String(req.body.reason || "").trim(); if(reason.length<3 || reason.length>500) throw new Error("اكتب سببًا واضحًا من 3 إلى 500 حرف"); return reason; }
const slotFor = (lesson:any) => lesson.kind === "regular" ? "regular" : String(lesson._id);
const recordFilter = (lesson:any) => lesson.kind === "regular"
  ? {teacher_id:lesson.teacher_id,group_id:lesson.group_id,session_date:lesson.session_date,session_slot:"regular"}
  : {teacher_id:lesson.teacher_id,lesson_id:lesson._id};
async function ownedLesson(req:AuthRequest) {
  if(!oid(req.params.id)) throw new Error("الحصة غير صالحة");
  const lesson=await AttendanceLesson.findOne({_id:req.params.id,...teacherFilter(req)}).lean();
  if(!lesson) throw new Error("الحصة غير موجودة أو غير متاحة لحسابك"); return lesson;
}
function canReadMoney(req:AuthRequest) {
  const u=req.user!;
  return u.staff_permissions!==undefined ? u.staff_permissions.some(p=>p==="payments" || p==="reports") : !u.is_admin || u.is_super_admin || u.financial_permissions.includes("financial.viewRevenue");
}
async function guard(req:AuthRequest,res:Response,run:()=>Promise<void>) {
  try {await run();} catch(error:any) {if(error?.code===11000) {res.status(409).json({message:"يوجد سجل سابق؛ أعد تحميل الحصة قبل المحاولة"});return;} if(error instanceof mongoose.Error || error?.errorLabels) throw error; res.status(400).json({message:error.message || "تعذر تنفيذ العملية"});}
}

export const listLessons = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  const filter:any={...teacherFilter(req)};
  if(req.query.group_id) {if(!oid(req.query.group_id)) throw new Error("المجموعة غير صالحة");filter.group_id=req.query.group_id;}
  if(req.query.date) filter.session_date=String(req.query.date);
  const lessons=await AttendanceLesson.find(filter).sort({session_date:-1,time:-1}).limit(300).lean();
  res.json(lessons.map(l=>({...l,id:String(l._id)})));
});

export const createLesson = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  if(!oid(req.body.group_id)) throw new Error("اختر مجموعة صحيحة");
  const group=await Group.findOne({_id:req.body.group_id,...teacherFilter(req)}).lean();
  if(!group) throw new Error("المجموعة غير متاحة");
  const date=String(req.body.session_date || ""),time=String(req.body.time || group.time || "");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("تاريخ أو موعد الحصة غير صالح");
  const kind=req.body.kind;
  if(!["regular","extra"].includes(kind)) throw new Error("نوع الحصة غير صالح");
  if(group.start_date && date<group.start_date) throw new Error("الحصة قبل بداية المجموعة");
  if(kind==="regular" && (!scheduledOn(group,date) || group.cancelled_sessions?.includes(date))) throw new Error("التاريخ ليس حصة عادية متاحة؛ اختر حصة إضافية");
  const title=String(req.body.title || (kind==="regular"?"حصة المجموعة":"حصة إضافية")).trim();
  const grace=Number(req.body.grace_minutes ?? 10),duration=Number(req.body.duration_minutes ?? 120),early=Number(req.body.early_minutes ?? 15);
  if(!title || title.length>120 || !Number.isInteger(grace)||grace<0||grace>120||!Number.isInteger(duration)||duration<15||duration>480||!Number.isInteger(early)||early<0||early>120) throw new Error("راجع اسم الحصة ومدد نافذة الحضور");
  const [students,memberships]=await Promise.all([Student.find({teacher_id:group.teacher_id}).lean(),StudentMembership.find({teacher_id:group.teacher_id,starts_on:{$lte:date},$or:[{ends_on:null},{ends_on:{$gte:date}}]}).sort({starts_on:-1}).lean()]);
  const roster=students.filter(s=>{
    const m=memberships.find(m=>String(m.student_id)===String(s._id));
    const joined=m?.starts_on || s.group_join_date || s.created_at?.toISOString().slice(0,10);
    return String(m?.group_id || s.group_id)===String(group._id) && (!joined || joined<=date) && (!s.is_suspended || (!!s.suspended_until && s.suspended_until<buildLocalDate(date,"23:59")));
  }).map(s=>s._id);
  const start=buildLocalDate(date,time);
  const lesson=await AttendanceLesson.create({teacher_id:group.teacher_id,group_id:group._id,title,session_date:date,time,kind,grace_minutes:grace,opens_at:new Date(+start-early*60000),closes_at:new Date(+start+duration*60000),roster,events:[event(req,"create","إنشاء الحصة")]});
  res.status(201).json(lesson);
});

export const lessonDetails = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  const lesson=await ownedLesson(req);
  const attendanceScope={$or:[recordFilter(lesson),{teacher_id:lesson.teacher_id,actual_lesson_id:lesson._id}]};
  const [records,students,audit]=await Promise.all([
    AttendanceRecord.find(attendanceScope).lean(),
    Student.find({teacher_id:lesson.teacher_id,$or:[{_id:{$in:lesson.roster}},{group_id:lesson.group_id}]}).select("name code center_student_code group_id").lean(),
    AttendanceRecord.find({...attendanceScope,voided_at:{$exists:true}}).sort({updated_at:-1}).limit(100).lean(),
  ]);
  const names=new Map(students.map(s=>[String(s._id),s]));
  const missingNames=[...records,...audit].filter(r=>!names.has(String(r.student_id))).map(r=>r.student_id);
  if(missingNames.length) for(const s of await Student.find({_id:{$in:missingNames},teacher_id:lesson.teacher_id}).select("name code group_id").lean()) names.set(String(s._id),s);
  const present=records.filter(r=>r.status==="present"),presentIds=new Set(present.map(r=>String(r.student_id)));
  const waiting=lesson.roster.filter(id=>!presentIds.has(String(id))).map(id=>({id:String(id),name:names.get(String(id))?.name || "طالب سابق",code:names.get(String(id))?.code}));
  const finalized=lesson.state==="closed" || (lesson.state!=="cancelled" && new Date()>lesson.closes_at);
  const enrich=(r:any)=>({...r,id:String(r._id),student_name:names.get(String(r.student_id))?.name || "طالب سابق",student_code:names.get(String(r.student_id))?.code});
  res.json({lesson:{...lesson,id:String(lesson._id)},records:records.map(enrich),audit:audit.map(enrich),waiting,summary:{present:present.length,late:present.filter(r=>r.timing_state==="late").length,unverified:present.filter(r=>r.timing_state==="unverified").length,waiting:waiting.length,absent:finalized?waiting.length:0,finalized,cancelled:lesson.state==="cancelled"}});
});

export const changeLessonState = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  const lesson=await ownedLesson(req),state=req.body.state,reason=reasonFor(req);
  if(!["open","closed","cancelled","scheduled"].includes(state)) throw new Error("حالة الحصة غير صالحة");
  if(state==="open" && (new Date()<lesson.opens_at || new Date()>lesson.closes_at)) throw new Error("لا يمكن فتح الحصة خارج نافذة الحضور؛ يمكن استخدام تصحيح الحضور");
  const result=await AttendanceLesson.findOneAndUpdate({_id:lesson._id,version:lesson.version},{$set:{state},$inc:{version:1},$push:{events:event(req,state,reason)}},{new:true});
  if(!result) throw new Error("تغيرت الحصة على جهاز آخر؛ أعد التحميل");
  // A regular cancellation also remains visible to historical sheets and reports.
  if(lesson.kind==="regular") {
    if(state==="cancelled") await Group.updateOne({_id:lesson.group_id,teacher_id:lesson.teacher_id},{$addToSet:{cancelled_sessions:lesson.session_date}});
    else if(lesson.state==="cancelled") await Group.updateOne({_id:lesson.group_id,teacher_id:lesson.teacher_id},{$pull:{cancelled_sessions:lesson.session_date}});
    await AttendanceSession.updateOne({group_id:lesson.group_id,session_date:lesson.session_date},{$set:{cancelled:state==="cancelled"},$setOnInsert:{teacher_id:lesson.teacher_id,time:lesson.time}},{upsert:true});
  }
  res.json(result);
});

export const markLessonAttendance = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  const lesson=await ownedLesson(req),source=String(req.body.source || "manual");
  if(!["qr","manual","offline","correction"].includes(source)) throw new Error("طريقة التسجيل غير صالحة");
  const correction=source==="correction",reason=correction?reasonFor(req):"تسجيل الحضور";
  if(lesson.state==="cancelled") throw new Error("الحصة ملغاة");
  if(!correction) assertAttendanceWindow(lesson);
  if(lesson.session_date>getTodayInTimezone()) throw new Error("لا يمكن تسجيل حضور مستقبلي");
  let student:any;
  if(source==="qr" || (source==="offline" && req.body.qr)) {
    const raw=String(req.body.qr || "");
    if(!raw || raw.length>2048) throw new Error("QR غير صالح");
    student=await findScannedStudent({teacher_id:lesson.teacher_id},{student_code:raw});
    if(student) {
      const token=raw.match(/[?&]card=([^&#]+)/)?.[1];
      if(token ? !validStudentCard(student,token) : (student.card_qr_version || 0)>0) throw new Error("الكارت ملغي أو قديم؛ استخدم الكارت البديل أو التسجيل اليدوي");
    }
  } else {if(!oid(req.body.student_id)) throw new Error("اختر الطالب");student=await Student.findOne({_id:req.body.student_id,teacher_id:lesson.teacher_id}).lean();}
  if(!student) throw new Error("الطالب غير موجود في حساب المدرس");
  if(student.is_suspended && (!student.suspended_until || new Date(student.suspended_until)>=new Date())) throw new Error(`${student.name} — الطالب موقوف`);
  const member=lesson.roster.some(id=>String(id)===String(student._id));
  if(!member && req.body.cross_group_confirmed!==true) {res.status(409).json({message:`${student.name} ليس ضمن الطلاب المتوقعين؛ أكد الحضور الاستثنائي`});return;}
  if(!member) {const group=await Group.findById(lesson.group_id).lean();if(group?.grade_id && student.grade_id && String(group.grade_id)!==String(student.grade_id)) throw new Error("الطالب من صف مختلف");}
  let target=lesson;
  if(req.body.credit_lesson_id) {
    if(!oid(req.body.credit_lesson_id) || req.body.cross_group_confirmed!==true) throw new Error("حدد الحصة الأصلية وأكد التعويض");
    const original=await AttendanceLesson.findOne({_id:req.body.credit_lesson_id,teacher_id:lesson.teacher_id}).lean();
    if(!original || original.state==="cancelled" || original.session_date>getTodayInTimezone() || !original.roster.some(id=>String(id)===String(student._id))) throw new Error("الحصة الأصلية غير مؤهلة لتعويض هذا الطالب");
    target=original;
  }
  const filter={student_id:student._id,session_date:target.session_date,session_slot:slotFor(target),teacher_id:target.teacher_id};
  const timing=attendanceTiming(lesson,source),status=correction && req.body.status==="absent"?"absent":"present";
  const values={...filter,group_id:target.group_id,lesson_id:target._id,actual_lesson_id:lesson._id,is_extra:target.kind==="extra",scanner_group_id:lesson.group_id,scanner_session_date:lesson.session_date,status,source,...timing,month:Number(target.session_date.slice(5,7)),year:Number(target.session_date.slice(0,4)),voided_at:null};
  let result:any;
  await mongoose.connection.transaction(async session=>{
    const lock=await AttendanceLesson.updateOne({_id:lesson._id,...(correction?{state:{$ne:"cancelled"}}:{state:"open",opens_at:{$lte:new Date()},closes_at:{$gte:new Date()}})},{$inc:{version:1}},{session});
    if(!lock.matchedCount) throw new Error("تغيرت حالة الحصة؛ أعد تحميلها");
    if(String(target._id)!==String(lesson._id)) {const creditLock=await AttendanceLesson.updateOne({_id:target._id,state:{$ne:"cancelled"}},{$inc:{version:1}},{session});if(!creditLock.matchedCount) throw new Error("تغيرت الحصة الأصلية؛ أعد المحاولة");}
    const old=await AttendanceRecord.findOne({...filter,voided_at:null}).session(session).lean();
    // Include voided rows when restoring, while retaining their embedded history.
    const existing=old || await AttendanceRecord.findOne({...filter,voided_at:{$ne:null}}).session(session).lean();
    if(existing?.status==="present" && !existing.voided_at && !correction) {result={record:existing,duplicate:true};return;}
    const device=source==="offline" && typeof req.body.device_captured_at==="string" && Number.isFinite(Date.parse(req.body.device_captured_at))?new Date(req.body.device_captured_at):undefined;
    const record=await AttendanceRecord.findOneAndUpdate({...filter,voided_at:{$exists:true}},{$set:{...values,...(device?{device_captured_at:device}:{})},$inc:{revision:1},$push:{history:event(req,existing?"correct":"mark",reason,existing?{status:existing.status,voided_at:existing.voided_at,source:existing.source,timing_state:existing.timing_state}:null,{status,source,actual_lesson_id:lesson._id})}},{upsert:true,new:true,session,runValidators:true});
    result={record,duplicate:false};
  });
  res.status(result.duplicate?200:201).json({...result,student:{id:String(student._id),name:student.name,code:student.code}});
});

export const lessonRecordHistory = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  if(!oid(req.params.recordId)) throw new Error("السجل غير صالح");
  const record=await AttendanceRecord.findOne({_id:req.params.recordId,...teacherFilter(req),voided_at:{$exists:true}}).lean();
  if(!record) throw new Error("سجل الحضور غير متاح"); res.json(record);
});

export const rotateAttendanceCard = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  if(!oid(req.params.studentId)) throw new Error("الطالب غير صالح");
  const student=await Student.findOneAndUpdate({_id:req.params.studentId,...teacherFilter(req)},{$inc:{card_qr_version:1}},{new:true}).lean();
  if(!student) throw new Error("الطالب غير متاح");
  res.json({id:String(student._id),name:student.name,card_qr_token:studentCardToken(student),center_student_code:student.center_student_code});
});

export const attendanceDebt = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  if(!canReadMoney(req)) {res.status(403).json({message:"ليس لديك صلاحية الاطلاع على المديونية"});return;}
  if(!oid(req.params.studentId)) throw new Error("الطالب غير صالح");
  const student=await Student.findOne({_id:req.params.studentId,...teacherFilter(req)}).lean();
  if(!student) throw new Error("الطالب غير متاح");
  const today=getTodayInTimezone(),year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
  const rows=await MonthlySubscription.find({student_id:student._id,teacher_id:student.teacher_id,status:"due",$or:[{year:{$lt:year}},{year,month:{$lte:month}}]}).lean();
  res.json({amount:rows.reduce((sum,r)=>sum+Math.max(0,r.amount-r.discount),0),months:rows.length});
});

export const lessonsReport = async(req:AuthRequest,res:Response) => guard(req,res,async()=>{
  const today=getTodayInTimezone(),from=String(req.query.from || today.slice(0,7)+"-01"),to=String(req.query.to || today);
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(from)||!valid(to)||from>to||to>today||Date.parse(to)-Date.parse(from)>366*86400000) throw new Error("اختر فترة صحيحة حتى اليوم بحد أقصى سنة");
  const query:any={...teacherFilter(req),session_date:{$gte:from,$lte:to}};
  if(req.query.group_id){if(!oid(req.query.group_id)) throw new Error("المجموعة غير صالحة");query.group_id=req.query.group_id;}
  const lessons=await AttendanceLesson.find(query).sort({session_date:1,time:1}).lean();
  const eligible=lessons.filter(l=>l.state!=="cancelled"&&(l.state==="closed"||new Date()>l.closes_at));
  const regular=eligible.filter(l=>l.kind==="regular").map(l=>({group_id:l.group_id,session_date:l.session_date,session_slot:"regular"}));
  const records=eligible.length?await AttendanceRecord.find({...teacherFilter(req),status:"present",$or:[{lesson_id:{$in:eligible.map(l=>l._id)}},...regular]}).lean():[];
  const students=await Student.find({...teacherFilter(req),_id:{$in:[...eligible.flatMap(l=>l.roster),...records.map(r=>r.student_id)]}}).select("name code").lean();
  const rows=new Map<string,{id:string;name:string;code?:string;required:number;present:number;late:number;unverified:number;exceptional:number;absent:number;percent:number}>();
  for(const s of students)rows.set(String(s._id),{id:String(s._id),name:s.name,code:s.code,required:0,present:0,late:0,unverified:0,exceptional:0,absent:0,percent:0});
  for(const lesson of eligible){
    const matches=records.filter(r=>String(r.lesson_id)===String(lesson._id)||(lesson.kind==="regular"&&String(r.group_id)===String(lesson.group_id)&&r.session_date===lesson.session_date&&r.session_slot==="regular"));
    const byStudent=new Map(matches.map(r=>[String(r.student_id),r]));
    for(const id of lesson.roster){const row=rows.get(String(id));if(!row)continue;row.required++;const record=byStudent.get(String(id));if(record){row.present++;if(record.timing_state==="late")row.late++;if(record.timing_state==="unverified")row.unverified++;}}
    for(const record of matches)if(!lesson.roster.some(id=>String(id)===String(record.student_id))){const row=rows.get(String(record.student_id));if(row)row.exceptional++;}
  }
  for(const row of rows.values()){row.absent=row.required-row.present;row.percent=row.required?Math.round(row.present/row.required*100):0;}
  res.json({from,to,completed:eligible.length,cancelled:lessons.filter(l=>l.state==="cancelled").length,pending:lessons.length-eligible.length-lessons.filter(l=>l.state==="cancelled").length,students:[...rows.values()]});
});
