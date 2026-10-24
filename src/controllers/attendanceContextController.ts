import {Response} from "express";
import {AuthRequest,teacherFilter} from "../middleware/auth";
import {StudentMembership} from "../models/StudentMembership";
import {Group} from "../models/Group";
import {AttendanceSession} from "../models/AttendanceSession";
import {validCalendarDate} from "../utils/groupValidation";
export async function attendanceContext(req:AuthRequest,res:Response){
 const {start,end}=req.query;
 if((start||end)&&(!validCalendarDate(start)||!validCalendarDate(end)||String(start)>String(end))){res.status(400).json({message:"فترة الحضور غير صالحة"});return;}
 const owner=teacherFilter(req);
 const [memberships,groups,sessions]=await Promise.all([
  StudentMembership.find(owner).select("student_id group_id grade_id starts_on ends_on").lean(),
  Group.find(owner).select("name grade_id day_of_week time start_date created_at cancelled_sessions").lean(),
  AttendanceSession.find({...owner,...(start&&end?{session_date:{$gte:start,$lte:end}}:{})}).select("group_id session_date time cancelled").lean(),
 ]);
 res.json({memberships:memberships.map(m=>({...m,student_id:String(m.student_id),group_id:String(m.group_id),grade_id:m.grade_id?String(m.grade_id):undefined})),groups:groups.map(g=>({...g,id:String(g._id),grade_id:g.grade_id?String(g.grade_id):null})),sessions:sessions.map(s=>({...s,group_id:String(s.group_id)}))});
}
