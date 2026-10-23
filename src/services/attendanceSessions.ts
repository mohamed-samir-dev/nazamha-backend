import {AttendanceSession} from "../models/AttendanceSession";
import {scheduledOn} from "../utils/attendanceSession";
import {getTodayInTimezone} from "../utils/timezoneUtils";
/** Freeze past dates before a schedule is changed. Legacy dates use the last known schedule. */
export async function freezeAttendanceSchedule(group:any, from?:string) {
 const today=getTodayInTimezone(); const start=new Date((from||group.start_date||group.created_at?.toISOString().slice(0,10)||today)+"T12:00:00Z");
 const lower=new Date(today+"T12:00:00Z");lower.setUTCFullYear(lower.getUTCFullYear()-2);if(start<lower)start.setTime(lower.getTime());
 const ops:any[]=[];
 for(let d=start;d.toISOString().slice(0,10)<=today;d.setUTCDate(d.getUTCDate()+1)) {const date=d.toISOString().slice(0,10);if(scheduledOn(group,date))ops.push({updateOne:{filter:{group_id:group._id,session_date:date},update:{$setOnInsert:{teacher_id:group.teacher_id,group_id:group._id,session_date:date,time:group.time,cancelled:group.cancelled_sessions?.includes(date)||false}},upsert:true}});}
 if(ops.length)await AttendanceSession.bulkWrite(ops);
}
