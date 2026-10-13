import { Types } from "mongoose";
import { getDashboard, invalidateDashboardCache } from "../controllers/dashboardController";
import { Teacher } from "../models/Teacher";
import { Grade } from "../models/Grade";
import { Group } from "../models/Group";
import { Student } from "../models/Student";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { BookSale } from "../models/BookSale";
const T="111111111111111111111111", G="222222222222222222222222", Y="333333333333333333333333";
const chain=(v:any):any=>({lean(){return this},select(){return this},sort(){return this},then(resolve:any,reject:any){return Promise.resolve(v).then(resolve,reject)}});
beforeEach(()=>{
 invalidateDashboardCache(T);
 jest.spyOn(Teacher,"findById").mockReturnValue(chain({_id:new Types.ObjectId(T)}));
 jest.spyOn(Grade,"find").mockReturnValue(chain([{_id:new Types.ObjectId(Y),name:"grade"}]));
 jest.spyOn(Group,"find").mockReturnValue(chain([{_id:new Types.ObjectId(G),grade_id:new Types.ObjectId(Y)}]));
 jest.spyOn(Student,"find").mockReturnValue(chain([]));
 jest.spyOn(MonthlySubscription,"find").mockReturnValue(chain([]));
 jest.spyOn(BookSale,"countDocuments").mockResolvedValue(0 as never);
 jest.spyOn(AttendanceRecord,"aggregate").mockResolvedValue([{_id:{group_id:new Types.ObjectId(G),session_date:"2026-10-12"},presentCount:73}]);
});
afterEach(()=>jest.restoreAllMocks());
async function invoke(permissions?:string[]){const res:any={json:jest.fn(),status:jest.fn().mockReturnThis()};await getDashboard({user:{id:T,user_type:"teacher",staff_permissions:permissions},query:{month:10,year:2026}} as any,res);return res.json.mock.calls[0][0]}
it("preserves complete attendance totals above 50 and normalizes grades",async()=>{const data=await invoke();expect(data.attendance[0].presentCount).toBe(73);expect(data.grades[0].id).toBe(Y);const pipeline=(AttendanceRecord.aggregate as jest.Mock).mock.calls[0][0];expect(pipeline[0].$match.teacher_id.toString()).toBe(T);expect(pipeline.find((p:any)=>p.$limit)).toEqual({$limit:5});});
it("keeps attendance hidden from payment-only staff",async()=>{expect((await invoke(["payments"])).attendance).toEqual([])});
