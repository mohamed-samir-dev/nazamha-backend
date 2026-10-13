import { Student } from "../models/Student";
import { findScannedStudent } from "../utils/studentScan";
const id="6acbcfd799ff6181a42ded0c", teacher="111111111111111111111111";
const chain=(v:unknown):any=>({lean:()=>Promise.resolve(v)});
afterEach(()=>jest.restoreAllMocks());
test.each([id,`https://old.test/report/${id}?token=expired`])("book scan accepts stable old ID %s with tenant scope",async raw=>{
 const find=jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:id,group_id:"new"}));
 await findScannedStudent({teacher_id:teacher},{student_code:raw});
 expect(find).toHaveBeenCalledWith({teacher_id:teacher,_id:id});
});
test.each(["CTR-0001","https://old.test/report/c/CTR-0001","/report/c/CTR%2D0001"])("book scan accepts center card %s",async raw=>{
 const find=jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:id}));
 const student=await findScannedStudent({teacher_id:teacher},{student_code:raw});expect(student?._id).toBe(id);
 expect(find).toHaveBeenCalledWith({teacher_id:teacher,center_student_code:"CTR-0001"});
});
test("an explicit center card must never fall back to another student's group code",async()=>{
 const find=jest.spyOn(Student,"findOne").mockReturnValue(chain(null));
 expect(await findScannedStudent({teacher_id:teacher},{student_code:"/report/c/OTHER-1"})).toBeNull();expect(find).toHaveBeenCalledTimes(1);
});
test("invalid student ID is rejected without a Mongo cast error",async()=>{
 const find=jest.spyOn(Student,"findOne");expect(await findScannedStudent({teacher_id:teacher},{student_id:"c"})).toBeNull();expect(find).not.toHaveBeenCalled();
});
test("ambiguous raw code cannot sell to the wrong student",async()=>{
 jest.spyOn(Student,"findOne").mockReturnValueOnce(chain({_id:id})).mockReturnValueOnce(chain({_id:teacher}));
 expect(await findScannedStudent({teacher_id:teacher},{student_code:"CTR-0001"})).toBeNull();
});
import { getStudentByQR } from "../controllers/students.crud.controller";
import { AuthRequest } from "../middleware/auth";
test("scan endpoint resolves current membership independently of table pagination",async()=>{
 const find=jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:id,group_id:"new",code:"NEW-1"}));
 const response:any={status:jest.fn().mockReturnThis(),json:jest.fn()};
 await getStudentByQR({user:{id:teacher,user_type:"teacher"},query:{qr:id,page:"2",group_id:"old"}} as unknown as AuthRequest,response);
 expect(find).toHaveBeenCalledWith({teacher_id:teacher,_id:id});
 expect(response.json).toHaveBeenCalledWith(expect.objectContaining({id,group_id:"new"}));
});
test("scan endpoint rejects foreign or absent identity",async()=>{
 jest.spyOn(Student,"findOne").mockReturnValue(chain(null));const response:any={status:jest.fn().mockReturnThis(),json:jest.fn()};
 await getStudentByQR({user:{id:teacher,user_type:"teacher"},query:{qr:id}} as unknown as AuthRequest,response);
 expect(response.status).toHaveBeenCalledWith(404);
});
