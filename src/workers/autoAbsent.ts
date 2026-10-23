import {withJobLease} from "../services/jobLease";
import {schedulePeriodicTask} from "../services/periodicTask";
import {backfillAttendance} from "../services/attendanceBackfill";
export function scheduleAutoAbsent(){
 return schedulePeriodicTask(()=>withJobLease("auto-absent",backfillAttendance),60_000,error=>console.error("[auto-absent]",error));
}
