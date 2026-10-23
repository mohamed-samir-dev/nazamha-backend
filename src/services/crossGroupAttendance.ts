import mongoose, {ClientSession} from "mongoose";
import {Student} from "../models/Student";
import {Group} from "../models/Group";
import {Teacher} from "../models/Teacher";
import {StudentMembership} from "../models/StudentMembership";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {AttendanceSession} from "../models/AttendanceSession";
import {AttendanceSubstitution,SubstitutionAction} from "../models/AttendanceSubstitution";
import {AuditLog} from "../models/AuditLog";
import {buildLocalDate,getTodayInTimezone} from "../utils/timezoneUtils";
import {scheduledOn,validAttendanceDate} from "../utils/attendanceSession";
import {findScannedStudent} from "../utils/studentScan";
import {validStudentCard} from "../utils/studentCard";

export class AttendanceConflict extends Error {constructor(message:string,public status=409){super(message);}}
const fail=(message:string,status=409):never=>{throw new AttendanceConflict(message,status);};
export const validAttendanceId=(id:unknown):id is string=>typeof id==="string"&&/^[a-f\d]{24}$/i.test(id);
const id=(value:unknown)=>String(value || "");
const read=(query:any,session?:ClientSession)=>query.session(session || null).lean();
export interface AttendanceActor {id:string;type:string}
export interface CrossGroupInput {student_id:string;scanner_group_id:string;requested_date:string;qr_text?:string;action?:SubstitutionAction;target_date?:string;reason?:string}
export interface LessonOption {date:string;time:string;group_id:string;group_name:string;subject:string;status:"absent"|"unrecorded";session_id?:string}

export async function verifyAttendanceQR(teacherId:string,student:any,raw:unknown){
  if(raw===undefined)return; // Existing authenticated manual attendance remains available.
  if(typeof raw!=="string"||!raw.trim()||raw.length>2048)fail("رمز الطالب غير صالح",400);
  const resolved=await findScannedStudent({teacher_id:teacherId},{student_code:raw as string});
  if(!resolved || id(resolved._id)!==id(student._id))fail("رمز الطالب لا يطابق الطالب أو حساب المدرس",403);
  const token=(raw as string).match(/[?&]card=([^&#]+)/)?.[1];
  if(token ? !validStudentCard(student,token) : (student.card_qr_version || 0)>0)fail("الكارت ملغي أو غير صالح؛ استخدم الكارت الحالي",403);
}

function checkAcademicDate(teacher:any,date:string){
 const years=teacher.academic_year?.active_month_years || [];
 const month=Number(date.slice(5,7)),year=Number(date.slice(0,4));
 if(years.length&&!years.some((m:any)=>m.month===month&&m.year===year))fail("الحصة خارج الشهور والسنوات الدراسية المفعلة",400);
 const months=teacher.academic_year?.active_months || [];
 if(!years.length&&months.length&&!months.includes(month))fail("شهر الحصة غير مفعل في السنة الدراسية",400);
}

export function resolveLesson(group:any,date:string,snapshots:any[]){
 const saved=snapshots.find(s=>id(s.group_id)===id(group._id)&&s.session_date===date);
 if(group.cancelled_sessions?.includes(date)||saved?.cancelled)return null;
 if(!saved && (!scheduledOn(group,date)||(group.start_date&&date<group.start_date)))return null;
 return {date,time:saved?.time || group.time,session_id:saved? id(saved._id):undefined};
}

async function loadContext(teacherId:string,input:CrossGroupInput,session?:ClientSession){
 if(!validAttendanceId(teacherId)||!validAttendanceId(input.student_id)||!validAttendanceId(input.scanner_group_id)||!validAttendanceDate(input.requested_date))fail("معرّف الطالب أو المجموعة أو تاريخ الحصة غير صالح",400);
 const student=await read(Student.findOne({_id:input.student_id,teacher_id:teacherId}),session);
 if(!student)fail("الطالب غير متاح في حساب المدرس",403);
 if(student.is_suspended&&(!student.suspended_until||new Date(student.suspended_until)>=new Date()))fail("الطالب موقوف ولا يمكن تسجيل حضوره",403);
 const teacher=await read(Teacher.findById(teacherId).select("subject academic_year"),session);
 if(!teacher)fail("حساب المدرس غير متاح",403);
 const groups=await read(Group.find({_id:{$in:[student.group_id,input.scanner_group_id]},teacher_id:teacherId}),session);
 const original=groups.find((g:any)=>id(g._id)===id(student.group_id)),destination=groups.find((g:any)=>id(g._id)===input.scanner_group_id);
 if(!original||!destination)fail("المجموعة الأصلية أو مجموعة الحصة غير متاحة",403);
 if(id(original._id)===id(destination._id))fail("استخدم تسجيل الحضور العادي للطالب في مجموعته",400);
 // This product has one subject per teacher; grades and delegated course owners
 // must also agree. A shared grade across different teachers never grants access.
 if(!original.grade_id||!destination.grade_id||id(original.grade_id)!==id(destination.grade_id)||(student.grade_id&&id(student.grade_id)!==id(original.grade_id)))fail("المجموعتان غير متوافقتين في الصف الدراسي",403);
 if(id(original.sub_teacher_id)!==id(destination.sub_teacher_id))fail("المجموعتان تتبعان مسارين تدريسيين مختلفين",403);
 checkAcademicDate(teacher,input.requested_date);
 const today=getTodayInTimezone(),lower=new Date(today+"T12:00:00Z");lower.setUTCDate(lower.getUTCDate()-90);
 const upper=new Date(today+"T12:00:00Z");upper.setUTCDate(upper.getUTCDate()+56);
 const from=lower.toISOString().slice(0,10),to=upper.toISOString().slice(0,10);
 const [snapshots,memberships,records,substitutions]=await Promise.all([
   read(AttendanceSession.find({teacher_id:teacherId,group_id:{$in:[original._id,destination._id]},session_date:{$gte:from,$lte:to}}),session),
   read(StudentMembership.find({teacher_id:teacherId,student_id:student._id}).sort({starts_on:-1}),session),
   read(AttendanceRecord.find({teacher_id:teacherId,student_id:student._id,session_date:{$gte:from,$lte:to}}),session),
   read(AttendanceSubstitution.find({teacher_id:teacherId,student_id:student._id,active:true}),session),
 ]);
 const actual=resolveLesson(destination,input.requested_date,snapshots);
 if(!actual)fail("الحصة الحالية ملغاة أو غير موجودة في الجدول",400);
 const now=new Date(),starts=buildLocalDate(actual.date,actual.time);
 // Match the existing attendance window: five minutes before, one hour after.
 if(input.requested_date!==today||now.getTime()<starts.getTime()-5*60000||now.getTime()>=starts.getTime()+3600000)fail("الحصة ليست مفتوحة الآن للحضور خارج المجموعة",400);
 const joined=student.group_join_date || student.created_at?.toISOString().slice(0,10);
 if(joined&&input.requested_date<joined)fail("لا يمكن تسجيل الحضور قبل انضمام الطالب",400);
 const enrolled=(date:string)=>{
   const membership=memberships.find((m:any)=>m.starts_on<=date&&(!m.ends_on||m.ends_on>=date));
   if(membership)return id(membership.group_id)===id(original._id);
   return (!joined||date>=joined)&&id(student.group_id)===id(original._id);
 };
 const previous:LessonOption[]=[],future:LessonOption[]=[];
 for(const cursor=new Date(from+"T12:00:00Z");cursor.toISOString().slice(0,10)<=to;cursor.setUTCDate(cursor.getUTCDate()+1)){
   const date=cursor.toISOString().slice(0,10),lesson=resolveLesson(original,date,snapshots);
   if(!lesson||!enrolled(date))continue;
   try{checkAcademicDate(teacher,date);}catch{continue;}
   const record=records.find((r:any)=>r.session_date===date&&id(r.group_id)===id(original._id));
   const covered=substitutions.some((s:any)=>s.target_date===date&&id(s.target_group_id)===id(original._id));
   if(covered||record?.status==="present")continue;
   const start=buildLocalDate(date,lesson.time);
   const option:LessonOption={...lesson,group_id:id(original._id),group_name:original.name,subject:teacher.subject || "مادة المدرس",status:record?.status || "unrecorded"};
   if(start.getTime()+3600000<=now.getTime()&&record?.status==="absent")previous.push(option);
   else if(start>now)future.push(option);
 }
 const existing=records.find((r:any)=>id(r.group_id)===id(destination._id)&&r.session_date===input.requested_date&&r.status==="present");
 return {student,teacher,original,destination,actual,previous:previous.reverse(),future,existing,substitutions};
}

export async function crossGroupEligibility(teacherId:string,input:CrossGroupInput){
 const c=await loadContext(teacherId,input);
 await verifyAttendanceQR(teacherId,c.student,input.qr_text);
 return {decision:"confirm" as const,reason:"اختر حضورًا كضيف فقط، أو تعويض غياب سابق، أو إعفاء حصة قادمة. لا يتغير انضمام الطالب لمجموعته.",studentGroupId:id(c.original._id),studentGroupName:c.original.name,studentGroupSchedule:c.original.day_of_week,destinationGroupName:c.destination.name,actualLesson:{date:c.actual.date,time:c.actual.time,group_id:id(c.destination._id)},alreadyPresent:!!c.existing,previous:c.previous,future:c.future,previousUnavailable:"لا يوجد غياب سابق مؤهل خلال آخر 90 يومًا في الشهور الدراسية المفعلة.",futureUnavailable:"لا توجد حصة قادمة مؤهلة خلال 8 أسابيع في الشهور الدراسية المفعلة.",nextScheduledDate:null,scheduledDateIsToday:false,scheduledDateIsFuture:false,scheduledDateInCurrentWeek:false,scheduledDateInNextWeek:false};
}

async function ensureSession(teacherId:string,group:any,date:string,time:string,session:ClientSession){
 const row=await AttendanceSession.findOneAndUpdate({teacher_id:teacherId,group_id:group._id,session_date:date},{$setOnInsert:{time,cancelled:false},$inc:{attendance_revision:1}},{upsert:true,new:true,session});
 if(!row||row.cancelled)fail("تغيرت الحصة أو ألغيت؛ أعد التحميل");return row;
}
const actorEvent=(actor:AttendanceActor,action:string,reason:string,previous:string,result:string)=>({at:new Date(),actor_id:actor.id,actor_type:actor.type,action,reason,previous_state:previous,resulting_state:result});

export async function commitCrossGroupAttendance(teacherId:string,input:CrossGroupInput,actor:AttendanceActor){
 if(!["guest","compensate","exempt"].includes(input.action || ""))fail("اختر طريقة تسجيل الحضور صراحة",400);
 if(input.reason && (typeof input.reason!=="string"||input.reason.length>500))fail("الملاحظة يجب ألا تتجاوز 500 حرف",400);
 if(input.action!=="guest"&&(!input.target_date||!/^\d{4}-\d{2}-\d{2}$/.test(input.target_date)))fail("اختر حصة محددة للتعويض أو الإعفاء",400);
 let result:any;
 try{await mongoose.connection.transaction(async session=>{
   const c=await loadContext(teacherId,input,session);
   await verifyAttendanceQR(teacherId,c.student,input.qr_text);
   // Lock the same documents used by enrollment/schedule changes. Retrying the
   // transaction reruns the authoritative eligibility reads with fresh state.
   await Student.updateOne({_id:c.student._id,teacher_id:teacherId},{$inc:{mutation_version:1}},{session});
   for(const groupId of [id(c.original._id),id(c.destination._id)].sort())await Group.updateOne({_id:groupId,teacher_id:teacherId},{$inc:{__v:1}},{session});
   const active=c.substitutions.find((s:any)=>id(s.attendance_id)===id(c.existing?._id));
   if(c.existing){
     if(input.action==="guest"&&!active){result={record:c.existing,duplicate:true};return;}
     if(active&&active.kind===input.action&&active.target_date===input.target_date){result={record:c.existing,substitution:active,duplicate:true};return;}
     fail("يوجد حضور سابق لهذه الحصة؛ راجع سجل التعويض قبل إجراء تغيير");
   }
   const option=input.action==="compensate"?c.previous.find(l=>l.date===input.target_date):input.action==="exempt"?c.future.find(l=>l.date===input.target_date):null;
   if(input.action!=="guest"&&!option)fail("الحصة المختارة لم تعد مؤهلة للتعويض أو الإعفاء؛ أعد تحميل الخيارات");
   const actualSession=await ensureSession(teacherId,c.destination,c.actual.date,c.actual.time,session);
   const record=await AttendanceRecord.findOneAndUpdate({teacher_id:teacherId,student_id:c.student._id,group_id:c.destination._id,session_date:c.actual.date},{$set:{status:"present",attendance_kind:input.action==="guest"?"guest":"substitute",original_group_id:c.original._id,session_id:actualSession._id,scanner_group_id:c.destination._id,scanner_session_date:c.actual.date,month:Number(c.actual.date.slice(5,7)),year:Number(c.actual.date.slice(0,4))},$inc:{attendance_revision:1}},{upsert:true,new:true,runValidators:true,session});
   let substitution:any;
   if(option){
     const target=await ensureSession(teacherId,c.original,option.date,option.time,session);
     [substitution]=await AttendanceSubstitution.create([{teacher_id:teacherId,student_id:c.student._id,original_group_id:c.original._id,actual_group_id:c.destination._id,actual_date:c.actual.date,actual_session_id:actualSession._id,attendance_id:record!._id,target_group_id:c.original._id,target_date:option.date,target_session_id:target._id,kind:input.action,approved_by:actor.id,active:true,state:"approved",history:[actorEvent(actor,"approve",input.reason || "اعتماد من شاشة سكان الحضور","none","approved")]}],{session});
   }
   await AuditLog.create([{actor_id:actor.id,actor_type:actor.type,teacher_id:teacherId,action:"attendance.mark",resource_type:"attendance",resource_id:id(record!._id),outcome:"success",new_data:{student_id:id(c.student._id),original_group_id:id(c.original._id),actual_group_id:id(c.destination._id),actual_session_id:id(actualSession._id),actual_date:c.actual.date,operation:input.action,target_date:option?.date,target_session_id:substitution?.target_session_id,reason:input.reason}}],{session});
   result={record,substitution,duplicate:false};
 });}catch(error:any){
   if(error?.code===11000)fail("تغيرت بيانات الحضور أو سبق تنفيذ العملية؛ أعد تحميل الحصة");
   if(error?.code===20||error?.codeName==="IllegalOperation")fail("التسجيل خارج المجموعة يحتاج قاعدة بيانات تدعم المعاملات؛ لم يُحفظ أي تغيير",503);
   throw error;
 }
 return result;
}

export async function reverseSubstitution(teacherId:string,substitutionId:string,actor:AttendanceActor,reason:string){
 if(!validAttendanceId(substitutionId)||typeof reason!=="string"||reason.trim().length<3||reason.length>500)fail("المعرّف وسبب التراجع الواضح مطلوبان",400);
 let result:any;
 await mongoose.connection.transaction(async session=>{
   const row=await read(AttendanceSubstitution.findOne({_id:substitutionId,teacher_id:teacherId}),session);
   if(!row)fail("سجل التعويض غير متاح",403);
   if(row.state==="revoked"){result=row;return;}
   result=await AttendanceSubstitution.findOneAndUpdate({_id:row._id,teacher_id:teacherId,state:row.state},{$set:{active:false,state:"revoked"},$push:{history:actorEvent(actor,"reverse",reason.trim(),row.state,"revoked")}},{new:true,session});
   if(!result)fail("تغير سجل التعويض؛ أعد التحميل");
   await AuditLog.create([{actor_id:actor.id,actor_type:actor.type,teacher_id:teacherId,action:"request.write",resource_type:"attendance_substitution",resource_id:id(row._id),old_data:{state:row.state},new_data:{state:"revoked",reason:reason.trim()},outcome:"success"}],{session});
 });
 return result;
}

/** Used by cancellation and attendance corrections, in their existing transaction. */
export async function invalidateSubstitutions(filter:Record<string,unknown>,actor:AttendanceActor,reason:string,session?:ClientSession){
 return AttendanceSubstitution.updateMany({...filter,active:true},{$set:{active:false,state:"review"},$push:{history:actorEvent(actor,"invalidate",reason,"approved","review")}},{session});
}
