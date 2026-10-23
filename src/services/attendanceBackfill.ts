import mongoose,{Schema} from "mongoose";
import {Group} from "../models/Group";
import {Student} from "../models/Student";
import {StudentMembership} from "../models/StudentMembership";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {AttendanceSession} from "../models/AttendanceSession";
import {endedSession} from "../utils/attendanceSession";
import {eligibleForSession} from "../utils/sessionEligibility";
import {getTodayInTimezone} from "../utils/timezoneUtils";
const checkpointSchema=new Schema({_id:String,completed_on:String});
const Checkpoint=mongoose.models.AttendanceCheckpoint || mongoose.model("AttendanceCheckpoint",checkpointSchema);
export async function backfillAttendance() {
 const today=getTodayInTimezone(),now=new Date();
 const checkpoint=await Checkpoint.findById("auto-absent").lean() as any;
 const start=new Date((checkpoint?.completed_on||today)+"T12:00:00Z");
 if(checkpoint?.completed_on)start.setUTCDate(start.getUTCDate()+1);
 // Process at most 31 days per tick, advancing the durable cursor without
 // skipping older downtime. First installation starts today deliberately.
 if(start.toISOString().slice(0,10)>today)return;
 const upper=new Date(start);upper.setUTCDate(upper.getUTCDate()+30);
 const through=upper.toISOString().slice(0,10)<today?upper.toISOString().slice(0,10):today;
 const from=start.toISOString().slice(0,10);
 const [groups,students,memberships,frozen]=await Promise.all([
  Group.find({}).lean(), Student.find({}).lean(), StudentMembership.find({starts_on:{$lte:today},$or:[{ends_on:null},{ends_on:{$gte:from}}]}).lean(), AttendanceSession.find({session_date:{$gte:from,$lte:today}}).lean(),
 ]);
 const byStudent=new Map<string,any[]>();for(const m of memberships){const id=String(m.student_id);byStudent.set(id,[...(byStudent.get(id)||[]),m]);}
 const snapshots=new Map(frozen.map(s=>[`${s.group_id}|${s.session_date}`,s]));
 for(const d=new Date(start);d.toISOString().slice(0,10)<=through;d.setUTCDate(d.getUTCDate()+1)) {
  const date=d.toISOString().slice(0,10),ops:any[]=[],sessionOps:any[]=[];
  for(const group of groups){
   const snapshot=snapshots.get(`${group._id}|${date}`);
   const g=snapshot?{...group,time:snapshot.time,day_of_week:undefined,cancelled_sessions:snapshot.cancelled?[date]:[]}:group;
   if(!endedSession(g,date,now))continue;
   sessionOps.push({updateOne:{filter:{group_id:group._id,session_date:date},update:{$setOnInsert:{teacher_id:group.teacher_id,group_id:group._id,session_date:date,time:g.time,cancelled:false}},upsert:true}});
   for(const student of students){
    if(String(student.teacher_id)!==String(group.teacher_id))continue;
    const history=byStudent.get(String(student._id))||[];
    const membership=history.filter(m=>m.starts_on<=date&&(!m.ends_on||m.ends_on>=date)).sort((a,b)=>b.starts_on.localeCompare(a.starts_on))[0];
    if(String(membership?.group_id||student.group_id)!==String(group._id))continue;
    if(!eligibleForSession(g,{...student,group_join_date:membership?.starts_on||student.group_join_date},date))continue;
    const [year,month]=date.split("-").map(Number);
    const row={student_id:student._id,group_id:group._id,teacher_id:group.teacher_id,session_date:date,status:"absent",month,year};
    ops.push({updateOne:{filter:{student_id:student._id,group_id:group._id,session_date:date},update:{$setOnInsert:row},upsert:true}});
   }
  }
  if(sessionOps.length)await AttendanceSession.bulkWrite(sessionOps);
  if(ops.length)await AttendanceRecord.bulkWrite(ops,{ordered:false});
  if(date<today)await Checkpoint.updateOne({_id:"auto-absent"},{$set:{completed_on:date}},{upsert:true});
 }
 // Persist a restart cursor even when no yesterday was processed on first launch.
 if(!checkpoint){const yesterday=new Date(today+"T12:00:00Z");yesterday.setUTCDate(yesterday.getUTCDate()-1);await Checkpoint.updateOne({_id:"auto-absent"},{$setOnInsert:{completed_on:yesterday.toISOString().slice(0,10)}},{upsert:true});}
}
