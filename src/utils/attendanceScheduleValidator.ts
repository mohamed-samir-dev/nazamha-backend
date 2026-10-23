import { getTodayInTimezone } from "./timezoneUtils";
import { scheduledOn, validAttendanceDate } from "./attendanceSession";
export interface ValidationResult {
 decision:"allow"|"deny"|"confirm"; reason:string; studentGroupId:string|null;studentGroupName:string;studentGroupSchedule:string;nextScheduledDate:string|null;scheduledDateIsToday:boolean;scheduledDateIsFuture:boolean;scheduledDateInCurrentWeek:boolean;scheduledDateInNextWeek:boolean;
}
export async function validateCrossGroupAttendance(group:{id:string;name:string;day_of_week:string;start_date?:string|null;cancelled_sessions?:string[]}|null,scannerId:string,requestedDate:string,timezone="Africa/Cairo"):Promise<ValidationResult>{
 const result:ValidationResult={decision:"deny",reason:"لا توجد حصة متاحة في الأسبوع المختار",studentGroupId:group?.id||null,studentGroupName:group?.name||"لا توجد مجموعة",studentGroupSchedule:group?.day_of_week||"—",nextScheduledDate:null,scheduledDateIsToday:false,scheduledDateIsFuture:false,scheduledDateInCurrentWeek:false,scheduledDateInNextWeek:false};
 if(!group||!validAttendanceDate(requestedDate))return {...result,reason:"الطالب أو تاريخ الجلسة غير صالح"};
 const start=new Date(requestedDate+"T12:00:00Z");start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+1)%7));
 const dates:string[]=[];
 for(let i=0;i<7;i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);const date=d.toISOString().slice(0,10);if(scheduledOn(group,date)&&(!group.start_date||date>=group.start_date)&&!group.cancelled_sessions?.includes(date))dates.push(date);}
 const selected=dates.includes(requestedDate)?requestedDate:dates.find(d=>d>=requestedDate)||dates[dates.length-1];
 if(!selected)return result;
 Object.assign(result,{nextScheduledDate:selected,scheduledDateIsToday:selected===getTodayInTimezone(timezone),scheduledDateIsFuture:selected>getTodayInTimezone(timezone),scheduledDateInCurrentWeek:true});
 if(scannerId===group.id)return {...result,decision:dates.includes(requestedDate)?"allow":"deny",reason:dates.includes(requestedDate)?"الطالب في نفس المجموعة":"التاريخ ليس من أيام المجموعة"};
 if(selected>getTodayInTimezone(timezone))return {...result,reason:"حصة مجموعة الطالب لم تأتِ بعد؛ لا يمكن تسجيل حضور مستقبلي"};
 return {...result,decision:"confirm",reason:`تسجيل بديل خارج المجموعة — حصة مجموعته في الأسبوع المختار ${selected}`};
}
