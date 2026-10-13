jest.mock("../services/atomicController", () => ({ atomicController: (handler: unknown) => handler, series: (queries: PromiseLike<unknown>[]) => Promise.all(queries) }));
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { Grade } from "../models/Grade";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { prepareAttendance } from "../utils/prepareAttendance";
import { validateCrossGroupAttendance } from "../utils/attendanceScheduleValidator";
import { getStudentAttendanceSummary, upsertAttendance } from "../controllers/attendanceController";
import { updateStudent } from "../controllers/students.crud.controller";
import { setFamilyDiscount } from "../controllers/students.discount.controller";
const T="111111111111111111111111", S="222222222222222222222222", G="333333333333333333333333", Y="444444444444444444444444";
const chain=(v:unknown):any=>({lean(){return this;},select(){return this;},then(resolve:any,reject:any){return Promise.resolve(v).then(resolve,reject);}});
const req=(extra:any={}):AuthRequest=>({user:{id:T,user_type:"teacher",is_admin:false},params:{studentId:S,id:S},body:{},query:{},...extra} as AuthRequest);
const res=():any=>({statusCode:200,status(n:number){this.statusCode=n;return this;},json:jest.fn()});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test("historical attendance remains in summary after transfer",async()=>{
 jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:S,group_join_date:"2026-10-12"}));
 jest.spyOn(AttendanceRecord,"find").mockReturnValue(chain([{status:"present",session_date:"2026-10-11",month:10,year:2026},{status:"absent",session_date:"2026-10-12",month:10,year:2026}]));
 const r=res();await getStudentAttendanceSummary(req(),r);expect(r.json).toHaveBeenCalledWith([{present:1,absent:1,month:10,year:2026}]);
});
test("attendance before current membership rejected",async()=>{
 jest.spyOn(Group,"findOne").mockReturnValue(chain({_id:G,start_date:"2025-01-01"}));
 await expect(prepareAttendance(T,{_id:S,group_id:G,group_join_date:"2026-10-12"},{session_date:"2026-10-11",status:"present"})).rejects.toThrow("انضمام");
});
test("same-day record in previous group cannot be overwritten",async()=>{
 jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:S,group_id:G,group_join_date:"2025-01-01"}));
 jest.spyOn(Group,"findOne").mockReturnValue(chain({_id:G}));
 const write=jest.spyOn(AttendanceRecord,"findOneAndUpdate").mockRejectedValue({code:11000});
 const r=res();await upsertAttendance(req({body:{student_id:S,session_date:"2025-01-02",status:"present"}}),r);
 expect(r.statusCode).toBe(409);expect(write.mock.calls[0][0]).toMatchObject({teacher_id:T,group_id:G,student_id:S,session_date:"2025-01-02"});
});
test("next Sunday retains correct calendar date in Cairo",async()=>{
 jest.useFakeTimers().setSystemTime(new Date("2026-10-11T22:00:00Z"));
 const result=await validateCrossGroupAttendance({id:G,name:"الأحد",day_of_week:"الأحد"},S,"2026-10-12");
 expect(result.nextScheduledDate).toBe("2026-10-18");expect(result.reason).toContain("الأحد 2026-10-18");expect(result.decision).toBe("deny");
});
test.each([false,true])("grade mismatch cannot be bypassed by changing grade with group (%s)",async(changeGrade)=>{
 jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:S,teacher_id:T,grade_id:Y,group_id:S}));
 jest.spyOn(Group,"exists").mockResolvedValue({_id:G} as any);jest.spyOn(Grade,"exists").mockResolvedValue({_id:T} as any);
 jest.spyOn(Group,"findOne").mockReturnValue(chain({_id:G,grade_id:T}));
 const write=jest.spyOn(Student,"findOneAndUpdate");const r=res();
 await updateStudent(req({body:{group_id:G,...(changeGrade?{grade_id:T}:{})}}),r);
 expect(r.statusCode).toBe(400);expect(write).not.toHaveBeenCalled();
});
test.each(["20","bad",-1,101,{},NaN,Infinity])("invalid family discount rejected before mutation: %p",async(value)=>{
 const write=jest.spyOn(Student,"updateMany");const r=res();await setFamilyDiscount(req({body:{familyId:"test",percent:value}}),r);
 expect(r.statusCode).toBe(400);expect(write).not.toHaveBeenCalled();
});

import { getSiblings, linkSiblings } from "../controllers/students.siblings.controller";
import { SiblingFamily } from "../models/SiblingFamily";
import * as helpers from "../controllers/students.helpers";
test("book-only discount is copied when linking a new sibling",async()=>{
 jest.spyOn(Student,"find").mockResolvedValue([{_id:S,name:"One",sibling_family_id:G},{_id:Y,name:"Two"}] as any);
 jest.spyOn(SiblingFamily,"findOne").mockReturnValue({lean:()=>Promise.resolve({family_name:"Test"})} as any);
 const find=jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:S,family_discount_percent:0,family_book_discount_percent:25}));
 const write=jest.spyOn(Student,"updateMany").mockResolvedValue({} as any);
 jest.spyOn(helpers,"resolveBasePrice").mockResolvedValue(200);jest.spyOn(helpers,"syncDueSubscriptions").mockResolvedValue(undefined);
 const r=res();await linkSiblings(req({body:{studentIds:[S,Y]}}),r);
 expect(r.statusCode).toBe(200);expect(find.mock.calls[0][0]).toEqual({teacher_id:T,sibling_family_id:G});
 expect(write.mock.calls[0][1]).toMatchObject({family_book_discount_percent:25,family_discount_percent:0});
});
test("family listing includes discounts and custom price needed after reload",async()=>{
 jest.spyOn(SiblingFamily,"find").mockReturnValue(chain([]));
 const query:any=chain([]);query.sort=()=>query;query.select=jest.fn(()=>query);
 jest.spyOn(Student,"find").mockReturnValue(query);
 await getSiblings(req(),res());
 const fields=query.select.mock.calls[0][0].split(' ');
 expect(fields).toEqual(expect.arrayContaining(['family_book_discount_percent','family_book_discount_reason','discount_value','custom_monthly_price','parent_phone']));
});
