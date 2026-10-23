import {Response} from "express";
import {AuthRequest,canAccessTeacher,teacherFilter} from "../middleware/auth";
import {AttendanceSubstitution} from "../models/AttendanceSubstitution";
import {crossGroupEligibility,reverseSubstitution,AttendanceConflict,validAttendanceId} from "../services/crossGroupAttendance";

export function attendanceOwner(req:AuthRequest){
 const u=req.user!;
 const owner=u.user_type==="teacher"?u.id:(u.effective_teacher_id || req.body.teacher_id || req.query.teacher_id);
 if(typeof owner!=="string"||!validAttendanceId(owner)||!canAccessTeacher(req,owner))throw new AttendanceConflict("ليس لديك صلاحية لتسجيل الحضور لهذا المدرس",403);
 return owner;
}
export function substitutionError(res:Response,error:unknown){if(error instanceof AttendanceConflict){res.status(error.status).json({message:error.message});return true;}return false;}
export const eligibility=async(req:AuthRequest,res:Response)=>{
 try{res.json(await crossGroupEligibility(attendanceOwner(req),req.body));}catch(error){if(!substitutionError(res,error))throw error;}
};
export const substitutionHistory=async(req:AuthRequest,res:Response)=>{
 const page=Number(req.query.page || 1),limit=Number(req.query.limit || 20);
 if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100){res.status(400).json({message:"حدود الصفحة غير صالحة"});return;}
 const filter:any={...teacherFilter(req)};
 if(req.query.student_id){if(!validAttendanceId(req.query.student_id)){res.status(400).json({message:"معرّف الطالب غير صالح"});return;}filter.student_id=req.query.student_id;}
 const [rows,total]=await Promise.all([AttendanceSubstitution.find(filter).sort({created_at:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),AttendanceSubstitution.countDocuments(filter)]);
 res.json({data:rows.map(r=>({...r,id:String(r._id)})),total,page,limit});
};
export const revokeSubstitution=async(req:AuthRequest,res:Response)=>{
 if(!validAttendanceId(req.params.id)){res.status(400).json({message:"معرّف التعويض غير صالح"});return;}
 const row=await AttendanceSubstitution.findOne({_id:req.params.id,...teacherFilter(req)}).select("teacher_id").lean();
 if(!row){res.status(403).json({message:"سجل التعويض غير متاح لحسابك"});return;}
 try{res.json(await reverseSubstitution(String(row.teacher_id),req.params.id,{id:req.user!.actor_id||req.user!.id,type:req.user!.actor_type||req.user!.user_type},req.body.reason));}catch(error){if(!substitutionError(res,error))throw error;}
};
