import { prepareAttendance } from "../utils/prepareAttendance";
import { Response } from "express";
import mongoose from "mongoose";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { AuthRequest, teacherFilter, canAccessTeacher } from "../middleware/auth";
import { buildLocalDate } from "../utils/timezoneUtils";
import { endedSession, validAttendanceDate } from "../utils/attendanceSession";
import { eligibleForSession } from "../utils/sessionEligibility";
import {StudentMembership} from "../models/StudentMembership";
import {AttendanceSession} from "../models/AttendanceSession";
import {commitCrossGroupAttendance,verifyAttendanceQR,invalidateSubstitutions} from "../services/crossGroupAttendance";
import {substitutionError} from "./attendanceSubstitutionController";
import {effectiveResolutions,mergeAttendanceResolutions} from "../services/attendanceResolutions";
import {atomicController} from "../services/atomicController";
import {AttendanceSubstitution} from "../models/AttendanceSubstitution";
const resolvedAbsenceStages=[
 {$lookup:{from:AttendanceSubstitution.collection.name,let:{sid:"$student_id",gid:"$group_id",date:"$session_date"},pipeline:[{$match:{$expr:{$and:[{$eq:["$student_id","$$sid"]},{$eq:["$target_group_id","$$gid"]},{$eq:["$target_date","$$date"]},{$eq:["$active",true]},{$eq:["$state","approved"]}]}}}],as:"attendanceResolution"}},
 {$match:{$or:[{status:"present"},{"attendanceResolution.0":{$exists:false}}]}},
];
const activeSessionStages = [
  {$lookup:{from:"groups",localField:"group_id",foreignField:"_id",as:"attendanceGroup"}},
  {$match:{$expr:{$not:[{$in:["$session_date",{$ifNull:[{$arrayElemAt:["$attendanceGroup.cancelled_sessions",0]},[]]}]}]}}},
];

/** تحويل teacher_id filter إلى ObjectId للاستخدام في aggregation $match */
function toAggregationFilter(base: Record<string, unknown>): Record<string, unknown> {
  if (!base.teacher_id) return base;
  const tid = base.teacher_id;
  const toOid = (id: string) => new mongoose.Types.ObjectId(id);
  if (typeof tid === "string") return { ...base, teacher_id: toOid(tid) };
  if (tid && typeof tid === "object" && "$in" in (tid as any)) {
    return { ...base, teacher_id: { $in: ((tid as any).$in as string[]).map(toOid) } };
  }
  return base;
}

export const getAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  const { month, year, group_id, session_date, status } = req.query;
  const base = teacherFilter(req);

  if (group_id || session_date) {
    const filter: Record<string, unknown> = { ...base };
    if (group_id && session_date) filter.$or = [{group_id,session_date}, {scanner_group_id:group_id,scanner_session_date:session_date}];
    else if(group_id) filter.$or = [{group_id}, {scanner_group_id:group_id}];
    else if(session_date) filter.$or = [{session_date},{scanner_session_date:session_date}];
    if (status) filter.status = status;
    if (req.query.student_id) filter.student_id = req.query.student_id;
    const records = await AttendanceRecord.find(filter).lean() as any[];
    const studentIds = [...new Set(records.map((r) => String(r.student_id)))];
    const studentDocs = await Student.find({ _id: { $in: studentIds } }).lean().select("_id name") as any[];
    const nameMap = new Map(studentDocs.map((s) => [String(s._id), s.name as string]));
    const enriched = records.map((r) => ({ ...r, id:String(r._id), student_name: nameMap.get(String(r.student_id)) ?? null }));
    if(!status){const resolutionScope:any={...base};if(group_id)resolutionScope.target_group_id=group_id;if(session_date)resolutionScope.target_date=session_date;if(req.query.student_id)resolutionScope.student_id=req.query.student_id;res.json(mergeAttendanceResolutions(enriched,await effectiveResolutions(resolutionScope)));}
    else res.json(enriched);
    return;
  }

  const { limit } = req.query;
  if (limit || req.query.all === "true") {
    const size = Number(limit || 1000), page = Number(req.query.page || 1);
    if (!Number.isInteger(size) || size < 1 || size > 1000 || !Number.isInteger(page) || page < 1) { res.status(400).json({message:"حدود الصفحة غير صالحة"}); return; }
    const filter: Record<string, unknown> = { ...base };
    if (status) filter.status = status;
    const records = await AttendanceRecord.find(filter)
      .sort({ session_date: -1 })
      .skip((page - 1) * size).limit(size);
    res.json(records);
    return;
  }

  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(y)) {
    res.status(400).json({ message: "month و year مطلوبان" });
    return;
  }
  if (m < 1 || m > 12) {
    res.status(400).json({ message: "month يجب أن يكون بين 1 و 12" }); return;
  }
  if (y < 2000 || y > 2100) {
    res.status(400).json({ message: "year غير صالح" }); return;
  }
  const filter: Record<string, unknown> = { ...base, month: m, year: y };
  if (req.query.student_id) filter.student_id = req.query.student_id;
  const records = await AttendanceRecord.find(filter).lean();
  const prefix=`${y}-${String(m).padStart(2,"0")}`;
  const resolutions=await effectiveResolutions({...base,target_date:{$gte:`${prefix}-01`,$lte:`${prefix}-31`},...(req.query.student_id?{student_id:req.query.student_id}:{})});
  res.json(mergeAttendanceResolutions(records.map((r: any) => ({
    ...r,
    id: String(r._id),
    student_id: String(r.student_id),
    group_id: r.group_id ? String(r.group_id) : null,
    teacher_id: r.teacher_id ? String(r.teacher_id) : undefined,
    _id: undefined,
    __v: undefined,
  })),resolutions));
};

/**
 * التحقق من صلاحية تسجيل حضور طالب عبر المجموعات
 * يُستخدم قبل عرض تأكيد الحضور في Frontend
 */
export {eligibility as validateCrossGroupScan} from "./attendanceSubstitutionController";

export const upsertAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  // For assistant: always use effective_teacher_id (ignore body teacher_id for security)
  let teacherId: string;
  if (req.user!.user_type === "staff" && req.user!.effective_teacher_id) {
    teacherId = req.user!.effective_teacher_id;
  } else if (req.user!.is_admin) {
    teacherId = req.body.teacher_id || req.user!.id;
    if (!canAccessTeacher(req, teacherId)) { res.status(403).json({ message: "غير مصرح" }); return; }
  } else if (req.user!.user_type === "center" || req.user!.user_type === "staff") {
    teacherId = req.body.teacher_id;
    if (!req.user!.center_teacher_ids?.includes(teacherId)) {
      res.status(403).json({ message: "ليس لديك صلاحية لتسجيل حضور لهذا المدرس" }); return;
    }
  } else {
    teacherId = req.user!.id;
  }

  // Check ownership: student must belong to this teacher
  const student = await Student.findOne({ _id: req.body.student_id, teacher_id: teacherId })
    .lean()
    .select("_id teacher_id card_qr_version group_id grade_id group_join_date created_at is_suspended suspended_until suspension_reason") as any;
  if (!student) {
    res.status(403).json({ message: "ليس لديك صلاحية لتسجيل حضور هذا الطالب" }); return;
  }

  let record;
  if(req.body.scanner_group_id && String(req.body.scanner_group_id)!==String(student.group_id)) {
    try {
      const outcome=await commitCrossGroupAttendance(teacherId,{student_id:String(student._id),scanner_group_id:req.body.scanner_group_id,requested_date:req.body.session_date,qr_text:req.body.qr_text,action:req.body.cross_group_action,target_date:req.body.target_date,reason:req.body.reason},{id:req.user!.actor_id||req.user!.id,type:req.user!.actor_type||req.user!.user_type});
      const data=typeof outcome.record.toJSON==="function"?outcome.record.toJSON():{...outcome.record,id:String(outcome.record._id)};
      res.status(outcome.duplicate?200:201).json({...data,cross_group_action:req.body.cross_group_action,substitution_id:outcome.substitution?String(outcome.substitution._id):undefined,duplicate:outcome.duplicate});return;
    }catch(error){if(substitutionError(res,error))return;throw error;}
  }
  try{await verifyAttendanceQR(teacherId,student,req.body.qr_text);}catch(error){if(substitutionError(res,error))return;throw error;}
  try { record = await prepareAttendance(teacherId, student, req.body); }
  catch (error) { res.status(400).json({ message: (error as Error).message }); return; }

  // Check suspension
  if (student.is_suspended) {
    if (!student.suspended_until || new Date(student.suspended_until) >= new Date()) {
      res.status(403).json({ message: "هذا الطالب محظور ولا يمكن تسجيل حضوره", suspended: true, suspended_until: student.suspended_until, name: student.name });
      return;
    }
    // Auto-lift expired suspension
    await Student.findByIdAndUpdate(record.student_id, { is_suspended: false, suspended_until: null, suspension_reason: null });
  }

  await atomicController(async (_request, transactionRes) => {
    const fresh=await Student.findOne({_id:req.body.student_id,teacher_id:teacherId}).lean();
    if(!fresh || (fresh.is_suspended && (!fresh.suspended_until || new Date(fresh.suspended_until)>=new Date()))) {transactionRes.status(403).json({message:"الطالب غير متاح لتسجيل الحضور"});return;}
    await Student.updateOne({_id:fresh._id,teacher_id:teacherId},{$inc:{mutation_version:1}});
    try{await verifyAttendanceQR(teacherId,fresh,req.body.qr_text);}catch(error){if(substitutionError(transactionRes,error))return;throw error;}
    let prepared;
    try{prepared=await prepareAttendance(teacherId,fresh,req.body);}catch(error){transactionRes.status(400).json({message:(error as Error).message});return;}
    await Group.updateOne({_id:prepared.group_id,teacher_id:teacherId},{$inc:{__v:1}});
    try {
      const result=await AttendanceRecord.findOneAndUpdate(
        {student_id:prepared.student_id,session_date:prepared.session_date,teacher_id:teacherId,group_id:prepared.group_id},
        {$set:prepared,$inc:{attendance_revision:1}}, {upsert:true,new:true,runValidators:true});
      const actor={id:req.user!.actor_id||req.user!.id,type:req.user!.actor_type||req.user!.user_type};
      await invalidateSubstitutions({teacher_id:teacherId,student_id:prepared.student_id,target_group_id:prepared.group_id,target_date:prepared.session_date},actor,"تعديل الحضور الفعلي في الحصة الأصلية");
      if(prepared.status!=="present") await invalidateSubstitutions({teacher_id:teacherId,attendance_id:result!._id},actor,"تم تصحيح الحضور الفعلي إلى غياب");
      transactionRes.status(201).json(result);
    } catch(error:any) {
      if(error?.code===11000){transactionRes.status(409).json({message:"تغير سجل الحضور؛ أعد تحميل الحصة"});return;}throw error;
    }
  })(req,res);
};

export const bulkUpsertAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  // For assistant: always use effective_teacher_id (ignore body teacher_id for security)
  let resolvedTeacherId: string;
  if (req.user!.user_type === "staff" && req.user!.effective_teacher_id) {
    resolvedTeacherId = req.user!.effective_teacher_id;
  } else if (req.user!.is_admin) {
    resolvedTeacherId = req.body.teacher_id || req.user!.id;
    if (!canAccessTeacher(req, resolvedTeacherId)) { res.status(403).json({ message: "غير مصرح" }); return; }
  } else if (req.user!.user_type === "center" || req.user!.user_type === "staff") {
    resolvedTeacherId = req.body.teacher_id;
    if (resolvedTeacherId && !req.user!.center_teacher_ids?.includes(resolvedTeacherId)) {
      res.status(403).json({ message: "ليس لديك صلاحية لهذا المدرس" }); return;
    }
  } else {
    resolvedTeacherId = req.user!.id;
  }

  if (!Array.isArray(req.body.records) || req.body.records.length === 0 || req.body.records.length > 1000) { res.status(400).json({ message: "أرسل من 1 إلى 1000 سجل" }); return; }
  const records = req.body.records.map((r: Record<string, unknown>) => ({ ...r, teacher_id: resolvedTeacherId || req.user!.id })) as Array<{ student_id: string; session_date: string } & Record<string, unknown>>;

  // Check ownership: all student_ids must belong to this teacher
  const studentIds = records.map((r) => r.student_id);
  const students = await Student.find({ _id: { $in: studentIds }, teacher_id: resolvedTeacherId || req.user!.id }).lean() as any[];
  const ownedIds = new Set(students.map((s) => String(s._id)));
  const unauthorizedIds = studentIds.filter((id) => !ownedIds.has(id));
  if (unauthorizedIds.length > 0) {
    res.status(403).json({ message: "بعض الطلاب ليسوا تابعين لك" }); return;
  }

  // Filter out suspended students
  const suspendedIds = new Set(
    students
      .filter((s) => s.is_suspended && (!s.suspended_until || new Date(s.suspended_until) >= new Date()))
      .map((s) => String(s._id))
  );
  const allowedRecords = records.filter((r) => !suspendedIds.has(r.student_id));
  const suspendedNames = students.filter((s) => suspendedIds.has(String(s._id))).map((s) => s.name);

  let prepared;
  try {
    const groupIds = [...new Set([...students.map(s => String(s.group_id)), ...allowedRecords.map(r => String(r.scanner_group_id || r.group_id || ""))].filter(id => mongoose.isValidObjectId(id)))];
    const groups = await Group.find({ _id: { $in: groupIds }, teacher_id: resolvedTeacherId || req.user!.id }).lean();
    const groupMap = new Map(groups.map(g => [String(g._id), g]));
    const studentMap = new Map(students.map(s => [String(s._id), s]));
    prepared = await Promise.all(allowedRecords.map(r => prepareAttendance(resolvedTeacherId || req.user!.id, studentMap.get(r.student_id), r, groupMap)));
  } catch (error) { res.status(400).json({ message: (error as Error).message }); return; }
  const ops = prepared.map((r) => ({
    updateOne: {
      filter: { student_id: r.student_id, session_date: r.session_date, teacher_id: r.teacher_id, group_id: r.group_id } as Record<string, unknown>,
      update: { $set: r as Record<string, unknown> },
      upsert: true,
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any[];
  try {
    if (ops.length > 0) await mongoose.connection.transaction(async session => {
      const owner=resolvedTeacherId || req.user!.id;
      const freshStudents=await Student.find({_id:{$in:studentIds},teacher_id:owner}).session(session).lean();
      await Student.updateMany({_id:{$in:freshStudents.map(s=>s._id)},teacher_id:owner},{$inc:{mutation_version:1}},{session});
      const groupIds=[...new Set([...freshStudents.map(s=>String(s.group_id)),...prepared.map(r=>String(r.group_id))])];
      const currentGroups=await Group.find({_id:{$in:groupIds},teacher_id:owner}).session(session).lean();
      const currentGroupMap=new Map(currentGroups.map(g=>[String(g._id),g]));
      await Group.updateMany({_id:{$in:groupIds},teacher_id:owner},{$inc:{__v:1}},{session});
      for(const r of allowedRecords){
        const fresh=freshStudents.find(s=>String(s._id)===r.student_id);
        if(!fresh || (fresh.is_suspended&&(!fresh.suspended_until||new Date(fresh.suspended_until)>=new Date())))throw new Error("تغيرت أهلية الطالب؛ أعد تحميل الحصة");
        await verifyAttendanceQR(owner,fresh,r.qr_text);
        const rechecked=await prepareAttendance(owner,fresh,r,currentGroupMap);
        const old=prepared.find(p=>p.student_id===r.student_id&&p.session_date===r.session_date);
        if(!old || String(old.group_id)!==String(rechecked.group_id))throw new Error("تغيرت مجموعة الطالب؛ أعد تحميل الحصة");
      }
      await AttendanceRecord.bulkWrite(ops, { session });
      for(const r of prepared) await invalidateSubstitutions({teacher_id:owner,student_id:r.student_id,$or:[{target_group_id:r.group_id,target_date:r.session_date},...(r.status==="present"?[]:[{actual_group_id:r.group_id,actual_date:r.session_date}])]},{id:req.user!.actor_id||req.user!.id,type:req.user!.actor_type||req.user!.user_type},"تصحيح جماعي للحضور المرتبط بالتعويض",session);
    });
  } catch (error: any) {
    if (error?.code === 11000) { res.status(409).json({ message: "يوجد حضور سابق في مجموعة أخرى؛ لم يتم تغيير أي سجل" }); return; }
    if(substitutionError(res,error))return;
    throw error;
  }
  const data = prepared.length ? await AttendanceRecord.find({ teacher_id: resolvedTeacherId || req.user!.id, $or: prepared.map(r => ({student_id:r.student_id,group_id:r.group_id,session_date:r.session_date})) }) : [];
  res.status(201).json({ message: "تم الحفظ بنجاح", data, suspended_skipped: suspendedNames });
};

export const getStudentAttendanceSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { Student: S } = await import("../models/Student");
  const student = await S.findOne({ _id: studentId, ...teacherFilter(req) }).lean() as any;
  if (!student) { res.status(403).json({ message: "ليس لديك صلاحية لعرض بيانات هذا الطالب" }); return; }



  const records = await AttendanceRecord.find({
    student_id: studentId,
    ...teacherFilter(req),
  }).lean().select("status month year session_date group_id attendance_kind") as any[];
  const resolved=mergeAttendanceResolutions(records,await effectiveResolutions({...teacherFilter(req),student_id:studentId}));
  const groupIds=[...new Set(records.map(r=>r.group_id).filter(Boolean))];
  const groups=groupIds.length ? await Group.find({_id:{$in:groupIds}}).select("cancelled_sessions").lean() : [];
  const cancelled=new Map(groups.map(g=>[String(g._id),new Set(g.cancelled_sessions||[])]));



  const map = new Map<string, { present: number; absent: number; month: number; year: number;compensated?:number;exempt?:number;guest?:number }>();
  for (const r of resolved) {
    if(cancelled.get(String(r.group_id))?.has(r.session_date))continue;
    const key = `${r.year}-${r.month}`;
    const cur:NonNullable<ReturnType<typeof map.get>> = map.get(key) ?? { present: 0, absent: 0, month: r.month, year: r.year };
    if(r.resolution)cur[r.resolution==="compensated"?"compensated":"exempt"]=(cur[r.resolution==="compensated"?"compensated":"exempt"]||0)+1;
    else if(r.attendance_kind==="guest"||r.attendance_kind==="substitute")cur.guest=(cur.guest||0)+1;
    else if (r.status === "present") cur.present++; else cur.absent++;
    map.set(key, cur);
  }
  const summary = Array.from(map.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );
  res.json(summary);
};

export const getAllTimeStats = async (req: AuthRequest, res: Response): Promise<void> => {
  const matchBase = toAggregationFilter(teacherFilter(req));
  const pipeline = [
    { $match: matchBase },
    ...activeSessionStages,
    {$match:{attendance_kind:{$nin:["guest","substitute"]}}},
    ...resolvedAbsenceStages,
    { $group: { _id: { student_id: "$student_id", status: "$status" }, count: { $sum: 1 } } },
    { $group: {
      _id: "$_id.student_id",
      present: { $sum: { $cond: [{ $eq: ["$_id.status", "present"] }, "$count", 0] } },
      absent:  { $sum: { $cond: [{ $eq: ["$_id.status", "absent"]  }, "$count", 0] } },
    }},
  ];
  const results = await AttendanceRecord.aggregate(pipeline);
  const stats: Record<string, { present: number; absent: number }> = {};
  for (const r of results) stats[String(r._id)] = { present: r.present, absent: r.absent };
  res.json(stats);
};

// آخر حصة لكل مجموعة + الغائبون — aggregation واحدة بدل جلب كل السجلات
export const getLastSessionAbsentees = async (req: AuthRequest, res: Response): Promise<void> => {
  const base = teacherFilter(req);
  const matchBase = toAggregationFilter(base);

  // خطوة 1: آخر session_date لكل group_id
  const lastSessionPipeline = [
    { $match: matchBase },
    ...activeSessionStages,
    {$match:{session_date:{$lte:new Date().toLocaleDateString("en-CA",{timeZone:"Africa/Cairo"})}}},
    {$lookup:{from:AttendanceSession.collection.name,let:{gid:"$group_id",date:"$session_date"},pipeline:[{$match:{$expr:{$and:[{$eq:["$group_id","$$gid"]},{$eq:["$session_date","$$date"]}]}}}],as:"frozenSession"}},
    {$addFields:{attendanceStartsAt:{$dateFromString:{dateString:{$concat:["$session_date","T",{$ifNull:[{$arrayElemAt:["$frozenSession.time",0]},{$ifNull:[{$arrayElemAt:["$attendanceGroup.time",0]},"23:59"]}]},":00"]},timezone:"Africa/Cairo",onError:null}}}},
    {$match:{$expr:{$and:[{$ne:["$attendanceStartsAt",null]},{$lte:[{$add:["$attendanceStartsAt",3600000]},"$$NOW"]}]}}},
    { $group: { _id: "$group_id", lastDate: { $max: "$session_date" } } },
  ];
  const lastSessions = await AttendanceRecord.aggregate(lastSessionPipeline) as { _id: string; lastDate: string }[];
  if (lastSessions.length === 0) { res.json({}); return; }
  const resolutions=await effectiveResolutions({...base,$or:lastSessions.map(s=>({target_group_id:s._id,target_date:s.lastDate}))});
  const resolvedTargets=new Set(resolutions.map(r=>`${r.student_id}|${r.target_group_id}|${r.target_date}`));

  // خطوة 2: من كان حاضراً في آخر حصة لكل مجموعة
  const orConditions = lastSessions.map((s) => ({ group_id: s._id, session_date: s.lastDate, status: "present" }));
  const presentRecords = await AttendanceRecord.find({ $or: orConditions, ...base })
    .lean()
    .select("student_id group_id session_date") as any[];

  const presentMap = new Map<string, Set<string>>();
  for (const r of presentRecords) {
    const key = String(r.group_id);
    if (!presentMap.has(key)) presentMap.set(key, new Set());
    presentMap.get(key)!.add(String(r.student_id));
  }

  // خطوة 3: الطلاب لكل مجموعة
  const groupIds = lastSessions.map((s) => s._id).filter(Boolean);
  const memberships=await StudentMembership.find({group_id:{$in:groupIds},...base}).lean();
  const groups=await Group.find({_id:{$in:groupIds},...base}).lean();
  const frozen=await AttendanceSession.find({...base,$or:lastSessions.map(s=>({group_id:s._id,session_date:s.lastDate}))}).lean();
  const frozenMap=new Map(frozen.map(s=>[`${s.group_id}|${s.session_date}`,s]));
  const groupMap=new Map(groups.map(g=>[String(g._id),g]));
  const students = await Student.find({$or:[{group_id:{$in:groupIds}},{_id:{$in:memberships.map(m=>m.student_id)}}], ...base })
    .lean()
    .select("_id name code parent_phone phone group_id group_join_date created_at is_suspended suspended_until") as any[];

  const result: Record<string, { sessionDate: string; absentees: { id: string; name: string; code: string | null }[] }> = {};
  for (const { _id: groupId, lastDate } of lastSessions) {
    if (!groupId) continue;
    const key = String(groupId);
    const originalGroup=groupMap.get(key);
    const snapshot=frozenMap.get(`${key}|${lastDate}`);
    const group=snapshot && originalGroup ? {...originalGroup,start_date:undefined,day_of_week:undefined,time:snapshot.time,cancelled_sessions:snapshot.cancelled?[lastDate]:[]} : originalGroup;
    if(!group || !endedSession(group,lastDate))continue;
    const presentIds = presentMap.get(key) ?? new Set();
    const absentees = students
      .filter((s: any) => {
        const history=memberships.filter(m=>String(m.student_id)===String(s._id));
        const membership=history.filter(m=>m.starts_on<=lastDate&&(!m.ends_on||m.ends_on>=lastDate)).sort((a,b)=>b.starts_on.localeCompare(a.starts_on))[0];
        if (String(membership?.group_id || s.group_id) !== key) return false;
        const joinDate = membership?.starts_on || s.group_join_date || s.created_at?.toISOString().slice(0,10) || null;
        if(!eligibleForSession(group,{...s,group_join_date:joinDate},lastDate))return false;
        if (joinDate && joinDate > lastDate) return false;
        if(resolvedTargets.has(`${s._id}|${key}|${lastDate}`))return false;
        return !presentIds.has(String(s._id));
      })
      .map((s: any) => ({ id: String(s._id), name: s.name, code: s.code ?? null, parent_phone: s.parent_phone || s.phone || null }));
    result[key] = { sessionDate: lastDate, absentees };
  }

  res.json(result);
};

export const deleteAttendance = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const record=await AttendanceRecord.findOne({_id:req.params.id,...teacherFilter(req)}).lean();
  if(!record){res.status(404).json({message:"سجل الحضور غير موجود"});return;}
  await invalidateSubstitutions({teacher_id:record.teacher_id,student_id:record.student_id,$or:[{attendance_id:record._id},{target_group_id:record.group_id,target_date:record.session_date}]},{id:req.user!.actor_id||req.user!.id,type:req.user!.actor_type||req.user!.user_type},"تم إلغاء الحضور الفعلي؛ التعويض أو الإعفاء يحتاج مراجعة");
  await AttendanceRecord.findOneAndDelete({_id:record._id,...teacherFilter(req)});
  res.json({message:"تم إلغاء الحضور؛ حُفظ تاريخ التعويض للمراجعة"});
});

// تسجيل غياب تلقائي لكل طالب لم يُسجَّل حضوره بعد مرور ساعة على وقت الحصة
export const autoMarkAbsent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_id, session_date } = req.body as { group_id: string; session_date: string };
  if (!group_id || !session_date) {
    res.status(400).json({ message: "group_id و session_date مطلوبان" });
    return;
  }

  // Resolve effective teacher ID (supports assistant)
  const group = await Group.findOne({ _id: group_id, ...teacherFilter(req) }).lean() as any;
  if (!group) { res.status(404).json({ message: "المجموعة غير موجودة" }); return; }
  const effectiveTeacherId = String(group.teacher_id);
  if (!endedSession(group, session_date)) { res.status(400).json({message:"الجلسة غير صالحة أو ملغاة أو لم تنتهِ"}); return; }

  // تحقق أن ساعة مرت على وقت الحصة (بـ timezone المدرس)
  const teacherTz = (group as any).teacher_timezone || "Africa/Cairo";
  const sessionTime = buildLocalDate(session_date, group.time as string, teacherTz);
  sessionTime.setTime(sessionTime.getTime() + 60 * 60 * 1000); // +1 hour
  if (new Date() < sessionTime) {
    res.status(400).json({ message: "لم تمر ساعة على وقت الحصة بعد" });
    return;
  }

  const students = await Student.find({ group_id, teacher_id: effectiveTeacherId }).lean() as any[];
  const existing = await AttendanceRecord.find({ group_id, session_date }).lean() as any[];
  const existingIds = new Set(existing.map((r: any) => String(r.student_id)));

  const toInsert = students
    .filter(s => eligibleForSession(group, s, session_date))
    .filter((s: any) => !existingIds.has(String(s._id)))
    .filter((s: any) => {
      const joinDate = s.group_join_date || new Date(s.created_at).toISOString().slice(0, 10);
      return joinDate <= session_date;
    })
    .map((s: any) => ({
      student_id: s._id,
      group_id,
      teacher_id: effectiveTeacherId,
      session_date,
      month: parseInt(session_date.split("-")[1], 10),
      year: parseInt(session_date.split("-")[0], 10),
      status: "absent",
    }));

  const saved=toInsert.length ? await AttendanceRecord.bulkWrite(toInsert.map(r => ({updateOne:{filter:{student_id:r.student_id,group_id:r.group_id,session_date:r.session_date},update:{$setOnInsert:r},upsert:true}})) as any) : null;
  res.json({ marked: saved?.upsertedCount || 0 });
};

// Batch auto-absent: مجموعة حصص في request واحد
export const batchAutoMarkAbsent = async (req: AuthRequest, res: Response): Promise<void> => {
  let sessions = req.body.sessions as { group_id: string; session_date: string }[];
  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 1000 || sessions.some(s => !s || !mongoose.isValidObjectId(s.group_id) || !validAttendanceDate(s.session_date))) {
    res.status(400).json({ message: "sessions مطلوبة" });
    return;
  }
  sessions = [...new Map(sessions.map(s => [`${s.group_id}|${s.session_date}`,s])).values()];

  const now = new Date();
  const groupIds = [...new Set(sessions.map((s) => s.group_id))];
  const groups = await Group.find({ _id: { $in: groupIds }, ...teacherFilter(req) }).lean() as any[];
  const groupMap = new Map(groups.map((g) => [String(g._id), g]));

  const validSessions = sessions.filter(({ group_id, session_date }) => {
    const group = groupMap.get(group_id);
    if (!group) return false;
    if (!endedSession(group, session_date, now)) return false;
    const teacherTz = (group as any).teacher_timezone || "Africa/Cairo";
    const threshold = buildLocalDate(session_date, group.time as string, teacherTz);
    threshold.setTime(threshold.getTime() + 60 * 60 * 1000);
    return now >= threshold;
  });

  if (validSessions.length === 0) { res.json({ marked: 0 }); return; }

  // جلب كل الطلاب والسجلات بقواريين
  const [allStudents, existingRecords] = await Promise.all([
    Student.find({ group_id: { $in: groupIds }, teacher_id: {$in:groups.map(g=>g.teacher_id)} }).lean() as any,
    AttendanceRecord.find({
      group_id: { $in: groupIds },
      session_date: { $in: [...new Set(validSessions.map((s) => s.session_date))] },
    }).lean().select("student_id group_id session_date"),
  ]);

  const existingSet = new Set(existingRecords.map((r: any) => `${String(r.student_id)}|${String(r.group_id)}|${r.session_date}`));
  const studentsByGroup = new Map<string, any[]>();
  for (const s of allStudents) {
    const key = String(s.group_id);
    if (!studentsByGroup.has(key)) studentsByGroup.set(key, []);
    studentsByGroup.get(key)!.push(s);
  }

  const toInsert: object[] = [];
  for (const { group_id, session_date } of validSessions) {
    const groupStudents = studentsByGroup.get(group_id) ?? [];
    for (const s of groupStudents) {
      const key = `${String(s._id)}|${group_id}|${session_date}`;
      const joinDate = s.group_join_date || new Date(s.created_at).toISOString().slice(0, 10);
      if (!existingSet.has(key) && joinDate <= session_date && eligibleForSession(groupMap.get(group_id), s, session_date)) {
        existingSet.add(key);
        toInsert.push({
          student_id: s._id, group_id, teacher_id: groupMap.get(group_id).teacher_id,
          session_date,
          month: parseInt(session_date.split("-")[1], 10),
          year: parseInt(session_date.split("-")[0], 10),
          status: "absent",
        });
      }
    }
  }

  const saved=toInsert.length ? await AttendanceRecord.bulkWrite((toInsert as any[]).map(r => ({updateOne:{filter:{student_id:r.student_id,group_id:r.group_id,session_date:r.session_date},update:{$setOnInsert:r},upsert:true}}))) : null;
  res.json({ marked: saved?.upsertedCount || 0 });
};
