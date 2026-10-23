import {AttendanceSubstitution} from "../models/AttendanceSubstitution";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {Group} from "../models/Group";
import {AttendanceSession} from "../models/AttendanceSession";

/** A resolution never replaces an actual attendance record in storage. */
export async function effectiveResolutions(scope:Record<string,unknown>){
 const rows=await AttendanceSubstitution.find({...scope,active:true,state:"approved"}).lean();
 if(!rows.length)return [];
 const [records,groups,sessions]=await Promise.all([
   AttendanceRecord.find({_id:{$in:rows.map(r=>r.attendance_id)},status:"present"}).select("student_id group_id session_date").lean(),
   Group.find({_id:{$in:rows.flatMap(r=>[r.actual_group_id,r.target_group_id])}}).select("cancelled_sessions").lean(),
   AttendanceSession.find({_id:{$in:rows.flatMap(r=>[r.actual_session_id,r.target_session_id])}}).select("cancelled").lean(),
 ]);
 return rows.filter(row=>{
   const actual=records.find(r=>String(r._id)===String(row.attendance_id));
   const source=groups.find(g=>String(g._id)===String(row.actual_group_id)),target=groups.find(g=>String(g._id)===String(row.target_group_id));
   return actual&&String(actual.student_id)===String(row.student_id)&&String(actual.group_id)===String(row.actual_group_id)&&actual.session_date===row.actual_date&&source&&target&&!source.cancelled_sessions?.includes(row.actual_date)&&!target.cancelled_sessions?.includes(row.target_date!)&&!sessions.some(s=>s.cancelled&&[String(row.actual_session_id),String(row.target_session_id)].includes(String(s._id)));
 });
}

export function mergeAttendanceResolutions(records:any[],resolutions:any[]){
 const rows=records.map(r=>({...r}));
 for(const resolution of resolutions){
   let row=rows.find(r=>String(r.student_id)===String(resolution.student_id)&&String(r.group_id?._id || r.group_id)===String(resolution.target_group_id)&&r.session_date===resolution.target_date);
   if(row?.status==="present")continue;
   if(!row){const [year,month]=resolution.target_date.split("-").map(Number);row={id:`resolution-${resolution._id}`,student_id:String(resolution.student_id),group_id:String(resolution.target_group_id),teacher_id:String(resolution.teacher_id),session_date:resolution.target_date,year,month,status:"absent",derived:true};rows.push(row);}
   row.resolution=resolution.kind==="compensate"?"compensated":"exempt";
   row.substitution_id=String(resolution._id);
   row.resolved_by=String(resolution.approved_by);
   row.actual_attendance_date=resolution.actual_date;
   row.actual_attendance_group_id=String(resolution.actual_group_id);
 }
 return rows;
}
