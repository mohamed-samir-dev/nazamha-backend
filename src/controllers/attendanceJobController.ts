import {timingSafeEqual} from "crypto";
import {Request,Response} from "express";
import {withJobLease} from "../services/jobLease";
import {backfillAttendance} from "../services/attendanceBackfill";
/** A scheduler can invoke this on hosts that suspend background timers. */
export async function attendanceJob(req:Request,res:Response):Promise<void>{
 const secret=process.env.CRON_SECRET;
 if(!secret){res.status(503).json({message:"جدولة الحضور غير مهيأة"});return;}
 const expected=Buffer.from(`Bearer ${secret}`),received=Buffer.from(req.headers.authorization||"");
 if(received.length!==expected.length || !timingSafeEqual(received,expected)){res.status(401).json({message:"غير مصرح"});return;}
 const ran=await withJobLease("auto-absent",backfillAttendance);
 res.json({status:ran?"completed":"already_running"});
}
