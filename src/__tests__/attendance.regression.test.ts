import {Group} from "../models/Group";
import {Student} from "../models/Student";
import {AttendanceRecord} from "../models/AttendanceRecord";
import {prepareAttendance} from "../utils/prepareAttendance";
import {AttendanceSubstitution} from "../models/AttendanceSubstitution";
import {autoMarkAbsent,batchAutoMarkAbsent,getAttendance,bulkUpsertAttendance} from "../controllers/attendanceController";
import mongoose from "mongoose";
import {AttendanceSession} from "../models/AttendanceSession";
const T="111111111111111111111111",S="222222222222222222222222",G="333333333333333333333333";
const chain=(v:any):any=>({lean(){return this;},session(){return this;},select(){return this;},sort(){return this;},skip(){return this;},limit(){return this;},then(resolve:any,reject:any){return Promise.resolve(v).then(resolve,reject);}});
const group:any={_id:G,teacher_id:T,time:"10:00",day_of_week:"الإثنين",start_date:"2026-01-01",cancelled_sessions:["2026-10-19"]};
const student:any={_id:S,group_id:G,group_join_date:"2026-01-01"};
const req=(body:any={},query:any={}):any=>({user:{id:T,user_type:"teacher"},body,query});
const res=():any=>({statusCode:200,status(n:number){this.statusCode=n;return this;},json:jest.fn()});
beforeEach(()=>{jest.useFakeTimers().setSystemTime(new Date("2026-10-23T12:00:00Z"));jest.spyOn(AttendanceSession,"findOne").mockReturnValue(chain(null));jest.spyOn(AttendanceSubstitution,"updateMany").mockReturnValue(chain({matchedCount:0}));jest.spyOn(AttendanceSubstitution,"find").mockReturnValue(chain([]));jest.spyOn(Student,"updateMany").mockReturnValue(chain({matchedCount:1}));jest.spyOn(Group,"updateMany").mockReturnValue(chain({matchedCount:1}));});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test("same-group attendance rejects a day outside the schedule",async()=>{
 jest.spyOn(Group,"findOne").mockReturnValue(chain(group));
 await expect(prepareAttendance(T,student,{session_date:"2026-10-20",status:"present",group_id:G})).rejects.toThrow("أيام");
});
test("a frozen session remains editable after changing schedule",async()=>{
 jest.spyOn(Group,"findOne").mockReturnValue(chain({...group,cancelled_sessions:[]}));
 (AttendanceSession.findOne as jest.Mock).mockReturnValue(chain({session_date:"2026-10-20",cancelled:false}));
 await expect(prepareAttendance(T,student,{session_date:"2026-10-20",status:"present",group_id:G})).resolves.toMatchObject({session_date:"2026-10-20"});
});
test.each(["2026-10-19","2026-10-20","bad","2026-02-30"])("auto-absent rejects cancelled/non-scheduled/invalid session %s",async(date)=>{
 jest.spyOn(Group,"findOne").mockReturnValue(chain(group));const write=jest.spyOn(AttendanceRecord,"bulkWrite");const r=res();
 await autoMarkAbsent(req({group_id:G,session_date:date}),r);expect(r.statusCode).toBe(400);expect(write).not.toHaveBeenCalled();
});
test("duplicate sessions produce exactly one insert-only upsert and include expired suspensions",async()=>{
 jest.spyOn(Group,"find").mockReturnValue(chain([group]));jest.spyOn(Student,"find").mockReturnValue(chain([{...student,is_suspended:true,suspended_until:"2026-10-01"}]));jest.spyOn(AttendanceRecord,"find").mockReturnValue(chain([]));
 const write=jest.spyOn(AttendanceRecord,"bulkWrite").mockResolvedValue({} as any);const session={group_id:G,session_date:"2026-10-12"};
 await batchAutoMarkAbsent(req({sessions:[session,session]}),res());
 expect(write.mock.calls[0][0]).toHaveLength(1);expect(write.mock.calls[0][0][0]).toMatchObject({updateOne:{upsert:true,update:{$setOnInsert:{status:"absent"}}}});
});
test.each([false,true])("legacy cross-group confirmation (%s) cannot implicitly credit an original lesson",async(confirmed)=>{
 jest.spyOn(Group,"findOne").mockReturnValue(chain({...group,cancelled_sessions:[]}));
 await expect(prepareAttendance(T,student,{session_date:"2026-10-12",status:"present",scanner_group_id:S,cross_group_confirmed:confirmed})).rejects.toThrow("اختيار");
});

test.each([{month:"1.5",year:"2026"},{month:"1",year:"2026.5"},{limit:"50000"},{limit:"-1"}])("invalid numeric query is rejected: %p",async(query)=>{
 const r=res();await getAttendance(req({},query),r);expect(r.statusCode).toBe(400);
});
test("bulk response returns persisted IDs, skips suspended students and reads groups in two bounded batches including commit revalidation",async()=>{
 const students=[student,{...student,_id:S.slice(0,-1)+"3",is_suspended:true,name:"Suspended"}];
 jest.spyOn(Student,"find").mockReturnValue(chain(students));const groups=jest.spyOn(Group,"find").mockReturnValue(chain([group]));
 jest.spyOn(Group,"findOne").mockImplementation(()=>{throw Error("N+1 query");});
 jest.spyOn(mongoose.connection,"transaction").mockImplementation(async(cb:any)=>cb({}));
 const write=jest.spyOn(AttendanceRecord,"bulkWrite").mockResolvedValue({} as any);
 jest.spyOn(AttendanceRecord,"find").mockReturnValue(chain([{id:"saved-id",student_id:S,session_date:"2026-10-12",status:"present"}]));
 const r=res();await bulkUpsertAttendance(req({records:students.map(s=>({student_id:s._id,session_date:"2026-10-12",status:"present"}))}),r);
 expect(groups).toHaveBeenCalledTimes(2);expect(write.mock.calls[0][0]).toHaveLength(1);
 expect(r.json).toHaveBeenCalledWith(expect.objectContaining({data:[expect.objectContaining({id:"saved-id"})],suspended_skipped:["Suspended"]}));
});
