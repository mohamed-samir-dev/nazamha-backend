export function eligibleForSession(group:{start_date?:string|null;cancelled_sessions?:string[]}, student:{group_join_date?:string|null;created_at?:unknown;is_suspended?:boolean;suspended_until?:unknown}, date:string):boolean {
 if(group.start_date && group.start_date>date || group.cancelled_sessions?.includes(date)) return false;
 const joined=student.group_join_date || (student.created_at ? new Date(student.created_at as string).toLocaleDateString("en-CA",{timeZone:"Africa/Cairo"}) : null);
 if(joined && joined>date)return false;
 if(student.is_suspended && (!student.suspended_until || new Date(student.suspended_until as string).getTime()>Date.now()))return false;
 return true;
}
