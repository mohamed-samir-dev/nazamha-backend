import mongoose from "mongoose";
import os from "os";
import path from "path";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import {Student} from "../models/Student";
import {Group} from "../models/Group";
import {Teacher} from "../models/Teacher";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {AttendanceSession} from "../models/AttendanceSession";
import {AttendanceSubstitution} from "../models/AttendanceSubstitution";
import {AuditLog} from "../models/AuditLog";
import {StudentMembership} from "../models/StudentMembership";
import {crossGroupEligibility,commitCrossGroupAttendance,reverseSubstitution,invalidateSubstitutions,verifyAttendanceQR,resolveLesson} from "../services/crossGroupAttendance";
import {effectiveResolutions,mergeAttendanceResolutions} from "../services/attendanceResolutions";
import {studentCardToken} from "../utils/studentCard";
import {upsertAttendance,getAttendance,getAllTimeStats,deleteAttendance} from "../controllers/attendanceController";
import {getLastSessionAbsentees} from "../controllers/attendanceController";
import {toggleCancelSession} from "../controllers/groupsController";

jest.setTimeout(240000);
let server:MongoMemoryReplSet;
const T=new mongoose.Types.ObjectId(),OTHER=new mongoose.Types.ObjectId(),S=new mongoose.Types.ObjectId(),G=new mongoose.Types.ObjectId(),D=new mongoose.Types.ObjectId(),GRADE=new mongoose.Types.ObjectId();
const actor={id:String(T),type:"teacher"};
const current="2026-10-26",previous="2026-10-24",future="2026-10-31";
const input=(extra:Record<string,unknown>={}):any=>({student_id:String(S),scanner_group_id:String(D),requested_date:current,...extra});
const request=(body:any={},params:any={},query:any={}):any=>({user:{id:String(T),user_type:"teacher",actor_id:String(T),actor_type:"teacher",is_admin:false},body,params,query,headers:{},method:"POST",originalUrl:"/api/attendance"});
const response=():any=>({statusCode:200,status(n:number){this.statusCode=n;return this;},json(value:unknown){this.body=value;return this;},body:undefined,end(){return this;}});
beforeAll(async()=>{
 process.env.JWT_SECRET="cross-group-test-secret-never-production";
 server=await MongoMemoryReplSet.create({binary:{version:"7.0.14",downloadDir:path.join(os.tmpdir(),"codex-cross-group-mongodb-7.0.14")},replSet:{count:1}});
 await mongoose.connect(server.getUri(),{dbName:"cross_group_attendance_test"});
 await Promise.all([AttendanceRecord.init(),AttendanceSubstitution.init(),AttendanceSession.init()]);
});
afterAll(async()=>{jest.useRealTimers();await mongoose.disconnect();await server?.stop();});
beforeEach(async()=>{
 jest.useRealTimers();
 for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
 jest.useFakeTimers({doNotFake:["nextTick","setImmediate","clearImmediate","setTimeout","clearTimeout","setInterval","clearInterval","queueMicrotask","performance","hrtime"]}).setSystemTime(new Date("2026-10-26T14:10:00Z"));
 // Raw inserts avoid unrelated password/account lifecycle hooks in this isolated DB.
 await Teacher.collection.insertOne({_id:T,name:"مدرس",subject:"الفيزياء",academic_year:{active_month_years:[{month:10,year:2026},{month:11,year:2026}]}});
 await Group.create([{_id:G,teacher_id:T,grade_id:GRADE,name:"الأصلية",code:"A",day_of_week:"السبت",time:"17:00",start_date:"2026-09-01"},{_id:D,teacher_id:T,grade_id:GRADE,name:"الحالية",code:"B",day_of_week:"الإثنين",time:"17:00",start_date:"2026-09-01"}]);
 await Student.create({_id:S,teacher_id:T,name:"أحمد",code:"A-1",group_id:G,grade_id:GRADE,group_join_date:"2026-09-01"});
 await AttendanceRecord.create({teacher_id:T,student_id:S,group_id:G,session_date:previous,month:10,year:2026,status:"absent"});
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});

test("eligibility resolves actual group, subject and previous/future options without writing attendance",async()=>{
 const r=await crossGroupEligibility(String(T),input());expect(r.studentGroupId).toBe(String(G));expect(r.destinationGroupName).toBe("الحالية");expect(r.previous.map(x=>x.date)).toContain(previous);expect(r.future.map(x=>x.date)).toContain(future);expect(r.previous[0].subject).toBe("الفيزياء");expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(0);
});
test("guest attendance is actual destination attendance and preserves original absence/membership",async()=>{
 const before=await Student.findById(S).lean();const result=await commitCrossGroupAttendance(String(T),input({action:"guest"}),actor);
 expect(String(result.record.group_id)).toBe(String(D));expect(result.record.session_date).toBe(current);expect(result.record.attendance_kind).toBe("guest");expect(String((await Student.findById(S))!.group_id)).toBe(String(before!.group_id));expect((await AttendanceRecord.findOne({group_id:G}))!.status).toBe("absent");expect(await AttendanceSubstitution.countDocuments()).toBe(0);
});
test("a previous absence is preserved and linked separately to actual attendance",async()=>{
 const result=await commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor);
 expect(result.substitution.active).toBe(true);expect(String(result.substitution.attendance_id)).toBe(String(result.record._id));expect(String(result.substitution.actual_session_id)).not.toBe(String(result.substitution.target_session_id));expect((await AttendanceRecord.findOne({group_id:G,session_date:previous}))!.status).toBe("absent");expect(await AuditLog.countDocuments({action:"attendance.mark"})).toBe(1);
});
test("future exemption never creates future physical attendance or cancels the group lesson",async()=>{
 await commitCrossGroupAttendance(String(T),input({action:"exempt",target_date:future}),actor);
 expect(await AttendanceRecord.countDocuments({group_id:G,session_date:future})).toBe(0);expect((await AttendanceSession.findOne({group_id:G,session_date:future}))!.cancelled).toBe(false);expect((await AttendanceSubstitution.findOne())!.kind).toBe("exempt");
});
test.each(["guest","compensate","exempt"])("same %s operation can be safely retried",async action=>{
 const payload=input({action,target_date:action==="compensate"?previous:future});await commitCrossGroupAttendance(String(T),payload,actor);const retry=await commitCrossGroupAttendance(String(T),payload,actor);expect(retry.duplicate).toBe(true);expect(await AttendanceRecord.countDocuments({group_id:D,session_date:current})).toBe(1);expect(await AttendanceSubstitution.countDocuments()).toBe(action==="guest"?0:1);
});
test("concurrent duplicate requests create only one actual attendance and one substitution",async()=>{
 const payload=input({action:"compensate",target_date:previous});const results=await Promise.allSettled(Array.from({length:5},()=>commitCrossGroupAttendance(String(T),payload,actor)));expect(results.some(r=>r.status==="fulfilled")).toBe(true);expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(1);expect(await AttendanceSubstitution.countDocuments({active:true})).toBe(1);
});
test("different substitutions racing for one attendance cannot both commit",async()=>{
 await Promise.allSettled([commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor),commitCrossGroupAttendance(String(T),input({action:"exempt",target_date:future}),actor)]);expect(await AttendanceSubstitution.countDocuments({active:true})).toBe(1);expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(1);
});
test("an already attended target cannot be compensated",async()=>{await AttendanceRecord.updateOne({group_id:G},{$set:{status:"present"}});await expect(commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor)).rejects.toThrow("مؤهلة");expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(0);});
test("compensation requires an explicit absence and never infers an old missing lesson",async()=>{await expect(commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:"2026-10-17"}),actor)).rejects.toThrow("مؤهلة");});
test.each(["compensate","exempt"])("cancelled %s target is rejected",async action=>{const date=action==="compensate"?previous:future;await Group.updateOne({_id:G},{$addToSet:{cancelled_sessions:date}});await expect(commitCrossGroupAttendance(String(T),input({action,target_date:date}),actor)).rejects.toThrow("مؤهلة");});
test("an already started lesson cannot be selected as future exemption",async()=>{await expect(commitCrossGroupAttendance(String(T),input({action:"exempt",target_date:previous}),actor)).rejects.toThrow("مؤهلة");});
test.each(["student","destination"])("foreign teacher cannot use another teacher's %s",async which=>{if(which==="student")await Student.updateOne({_id:S},{$set:{teacher_id:OTHER}});else await Group.updateOne({_id:D},{$set:{teacher_id:OTHER}});await expect(crossGroupEligibility(String(T),input())).rejects.toThrow("متاح");});
test("different grades are rejected even when teacher is shared",async()=>{await Group.updateOne({_id:D},{$set:{grade_id:new mongoose.Types.ObjectId()}});await expect(crossGroupEligibility(String(T),input())).rejects.toThrow("الصف");});
test("different delegated course owners are not assumed equivalent",async()=>{await Group.updateOne({_id:D},{$set:{sub_teacher_id:new mongoose.Types.ObjectId()}});await expect(crossGroupEligibility(String(T),input())).rejects.toThrow("مسارين");});
test("inactive academic dates never appear as substitution targets",async()=>{await Teacher.updateOne({_id:T},{$set:{academic_year:{active_month_years:[{month:11,year:2026}]}}});await expect(crossGroupEligibility(String(T),input())).rejects.toThrow("الدراسية");});
test("suspended student is rejected server-side",async()=>{await Student.updateOne({_id:S},{$set:{is_suspended:true}});await expect(crossGroupEligibility(String(T),input())).rejects.toThrow("موقوف");});
test.each(["2026-10-25","2026-10-27","invalid"])("non-open actual date %s is rejected",async date=>{await expect(crossGroupEligibility(String(T),input({requested_date:date}))).rejects.toThrow();});
test("a cancelled actual session cannot create guest attendance",async()=>{await Group.updateOne({_id:D},{$addToSet:{cancelled_sessions:current}});await expect(commitCrossGroupAttendance(String(T),input({action:"guest"}),actor)).rejects.toThrow("ملغاة");});
test.each(["invalid","000000000000000000000000"])("invalid or unknown student %s is rejected",async student=>{await expect(crossGroupEligibility(String(T),input({student_id:student}))).rejects.toThrow();});
test("valid permanent QR is scoped to its student; tampered or revoked token fails",async()=>{
 const student=await Student.findById(S).lean();const raw=`https://example.test/report/${S}?card=${studentCardToken(student!)}`;
 await expect(verifyAttendanceQR(String(T),student,raw)).resolves.toBeUndefined();await expect(verifyAttendanceQR(String(T),student,raw.replace(/.$/,"z"))).rejects.toThrow("الكارت");await Student.updateOne({_id:S},{$inc:{card_qr_version:1}});await expect(verifyAttendanceQR(String(T),await Student.findById(S).lean(),raw)).rejects.toThrow("الكارت");
});
test("a QR belonging to a different student is rejected",async()=>{await expect(verifyAttendanceQR(String(T),await Student.findById(S).lean(),`https://example.test/report/${new mongoose.Types.ObjectId()}`)).rejects.toThrow("يطابق");});
test("database failure rolls back both attendance and substitution",async()=>{
 const write=jest.spyOn(AuditLog,"create").mockRejectedValueOnce(new Error("test audit failure"));await expect(commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor)).rejects.toThrow("test audit failure");write.mockRestore();expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(0);expect(await AttendanceSubstitution.countDocuments()).toBe(0);expect((await AttendanceRecord.findOne({group_id:G}))!.status).toBe("absent");
});
test("reversal preserves attendance and audit history; repeating reversal is safe",async()=>{
 const created=await commitCrossGroupAttendance(String(T),input({action:"exempt",target_date:future}),actor);const result=await reverseSubstitution(String(T),String(created.substitution._id),actor,"تم اختيار حصة بالخطأ");expect(result.history).toHaveLength(2);expect(result.active).toBe(false);expect((await AttendanceRecord.findById(created.record._id))!.status).toBe("present");await reverseSubstitution(String(T),String(result._id),actor,"إعادة محاولة");expect((await AttendanceSubstitution.findById(result._id))!.history).toHaveLength(2);
});
test("another teacher cannot reverse substitution",async()=>{const created=await commitCrossGroupAttendance(String(T),input({action:"exempt",target_date:future}),actor);await expect(reverseSubstitution(String(OTHER),String(created.substitution._id),{id:String(OTHER),type:"teacher"},"غير مصرح")).rejects.toThrow("متاح");expect((await AttendanceSubstitution.findById(created.substitution._id))!.active).toBe(true);});
test("a second actual lesson cannot compensate an already resolved target",async()=>{
 await commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor);const third=await Group.create({teacher_id:T,grade_id:GRADE,name:"ثالثة",code:"C",day_of_week:"الإثنين",time:"17:00"});await expect(commitCrossGroupAttendance(String(T),input({scanner_group_id:String(third._id),action:"compensate",target_date:previous}),actor)).rejects.toThrow("مؤهلة");
});
test("cancelling actual lesson flags dependents for review and removes coverage",async()=>{
 await commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor);const res=response();await toggleCancelSession(request({date:current},{id:String(D)}),res);expect(res.statusCode).toBe(200);expect((await AttendanceSubstitution.findOne())!.state).toBe("review");expect(await effectiveResolutions({teacher_id:T})).toHaveLength(0);expect(await AttendanceRecord.countDocuments({group_id:D})).toBe(1);
});
test("deleting actual attendance invalidates coverage, preserving the substitution history",async()=>{
 const created=await commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor);const res=response();await deleteAttendance(request({}, {id:String(created.record._id)}),res);expect(res.statusCode).toBe(200);expect((await AttendanceSubstitution.findOne())!.state).toBe("review");expect((await AttendanceSubstitution.findOne())!.history).toHaveLength(2);
});
test("reports distinguish actual guest and compensated absence without double-counting",async()=>{
 await commitCrossGroupAttendance(String(T),input({action:"compensate",target_date:previous}),actor);const rows=mergeAttendanceResolutions(await AttendanceRecord.find({student_id:S}).lean(),await effectiveResolutions({teacher_id:T}));expect(rows.find(r=>r.session_date===previous)!.status).toBe("absent");expect(rows.find(r=>r.session_date===previous)!.resolution).toBe("compensated");expect(rows.filter(r=>r.status==="present")).toHaveLength(1);const res=response();await getAllTimeStats(request(),res);expect(res.body[String(S)]?.absent||0).toBe(0);expect(res.body[String(S)]?.present||0).toBe(0);
});
test("normal same-group QR attendance remains automatic and repeated scans stay unique",async()=>{
 const normal=await Student.create({teacher_id:T,group_id:D,grade_id:GRADE,name:"طالب عادي",code:"B-1",group_join_date:"2026-09-01"});const body={student_id:String(normal._id),scanner_group_id:String(D),group_id:String(D),session_date:current,status:"present",qr_text:`https://example.test/report/${normal._id}?card=${studentCardToken(normal)}`};
 const a=response();await upsertAttendance(request(body),a);expect(a.statusCode).toBe(201);const b=response();await upsertAttendance(request(body),b);expect(b.statusCode).toBe(201);expect(await AttendanceRecord.countDocuments({student_id:normal._id,group_id:D,session_date:current})).toBe(1);
});
test("the database permits two actual groups on one day but forbids duplicate student/lesson",async()=>{
 await commitCrossGroupAttendance(String(T),input({action:"guest"}),actor);const base={student_id:S,teacher_id:T,group_id:G,session_date:current,month:10,year:2026,status:"present"};await AttendanceRecord.create(base);await expect(AttendanceRecord.create(base)).rejects.toMatchObject({code:11000});expect(await AttendanceRecord.countDocuments({student_id:S,session_date:current})).toBe(2);
});
