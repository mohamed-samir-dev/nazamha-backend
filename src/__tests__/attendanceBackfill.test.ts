import mongoose from "mongoose";
import {backfillAttendance} from "../services/attendanceBackfill";
import {AttendanceSession} from "../models/AttendanceSession";
import {StudentMembership} from "../models/StudentMembership";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {Student} from "../models/Student";
import {Group} from "../models/Group";
const chain=(v:any):any=>({lean(){return this;},then(resolve:any,reject:any){return Promise.resolve(v).then(resolve,reject);}});
const checkpoint=mongoose.model("AttendanceCheckpoint");
beforeEach(()=>{
 jest.useFakeTimers().setSystemTime(new Date("2026-10-23T12:00:00Z"));
 jest.spyOn(Group,"find").mockReturnValue(chain([{_id:"g",teacher_id:"t",day_of_week:"الإثنين",time:"10:00",start_date:"2026-01-01",cancelled_sessions:["2026-10-19"]}]));
 jest.spyOn(Student,"find").mockReturnValue(chain([{_id:"s",teacher_id:"t",group_id:"g",group_join_date:"2026-01-01"}]));
 jest.spyOn(StudentMembership,"find").mockReturnValue(chain([]));jest.spyOn(AttendanceSession,"find").mockReturnValue(chain([]));
 jest.spyOn(AttendanceSession,"bulkWrite").mockResolvedValue({} as any);jest.spyOn(AttendanceRecord,"bulkWrite").mockResolvedValue({} as any);
 jest.spyOn(checkpoint,"updateOne").mockReturnValue(chain({}));
});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test("restart catches missed classes, excludes cancellation and never overwrites present",async()=>{
 jest.spyOn(checkpoint,"findById").mockReturnValue(chain({completed_on:"2026-10-10"}));await backfillAttendance();
 const writes=(AttendanceRecord.bulkWrite as jest.Mock).mock.calls.flatMap(c=>c[0]);
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({updateOne:{filter:{student_id:"s",session_date:"2026-10-12"},update:{$setOnInsert:{status:"absent"}},upsert:true}});
 expect(writes[0].updateOne.update.$set).toBeUndefined();
});
test("long outage advances in bounded batches without skipping old dates",async()=>{
 jest.spyOn(checkpoint,"findById").mockReturnValue(chain({completed_on:"2026-08-01"}));await backfillAttendance();
 const dates=(AttendanceRecord.bulkWrite as jest.Mock).mock.calls.flatMap(c=>c[0]).map(r=>r.updateOne.filter.session_date);
 expect(dates[0]).toBe("2026-08-03");expect(dates.every(d=>d<="2026-09-01")).toBe(true);
 expect(checkpoint.updateOne).toHaveBeenLastCalledWith({_id:"auto-absent"},{$set:{completed_on:"2026-09-01"}},{upsert:true});
});
test("first installation does not invent legacy absences",async()=>{
 jest.spyOn(checkpoint,"findById").mockReturnValue(chain(null));await backfillAttendance();expect(AttendanceRecord.bulkWrite).not.toHaveBeenCalled();
});
