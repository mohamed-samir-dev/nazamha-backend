import { studentCardToken, validStudentCard } from "../utils/studentCard";
import { Student } from "../models/Student";
import { StudentShareToken } from "../models/StudentShareToken";
import { validateShareToken } from "../routes/public";
import { findScannedStudent } from "../utils/studentScan";

const S="111111111111111111111111", T="222222222222222222222222";
const identity={_id:S,teacher_id:T,card_qr_version:0};
const chain=(value:unknown):any=>({select(){return this;},lean(){return Promise.resolve(value);}});
const originalSecret=process.env.STUDENT_CARD_SECRET;
beforeEach(()=>{process.env.STUDENT_CARD_SECRET="test-only-student-card-secret";});
afterEach(()=>{jest.restoreAllMocks();if(originalSecret===undefined)delete process.env.STUDENT_CARD_SECRET;else process.env.STUDENT_CARD_SECRET=originalSecret;});

test("profile JSON and lean student listings emit the same permanent card token",()=>{
  const model=new Student({...identity,name:"طالب اختبار"});
  expect((model.toJSON() as any).card_qr_token).toBe(studentCardToken(identity));
  expect(validStudentCard(identity,studentCardToken(identity))).toBe(true);
});
test("group transfer, changed student code and passage of time do not change the card",()=>{
  const token=studentCardToken(identity);
  expect(studentCardToken({...identity,...{group_id:"another",code:"CHANGED",discount_value:20}})).toBe(token);
  expect(studentCardToken({...identity,card_qr_version:undefined})).toBe(token);
});
test.each([{...identity,_id:T},{...identity,teacher_id:S},{...identity,card_qr_version:1}])("a card cannot grant another student, owner or revoked version access",other=>{
  expect(validStudentCard(other,studentCardToken(identity))).toBe(false);
});
test.each([undefined,null,"","abc","g".repeat(64),["a".repeat(64)]])("malformed card capabilities are rejected",token=>{
  expect(validStudentCard(identity,token)).toBe(false);
});
const response=():any=>({statusCode:200,status(code:number){this.statusCode=code;return this;},json:jest.fn(),set:jest.fn()});
test("a parent can read this student's report without an authenticated cookie",async()=>{
  jest.spyOn(Student,"findOne").mockReturnValue(chain(identity));
  const res=response(),next=jest.fn();
  await validateShareToken({params:{id:S},query:{card:studentCardToken(identity)}} as any,res,next);
  expect(next).toHaveBeenCalledTimes(1);expect(res.set).toHaveBeenCalledWith("Referrer-Policy","no-referrer");
});
test("bare student IDs cannot open a public report",async()=>{
  const find=jest.spyOn(Student,"findOne"),res=response(),next=jest.fn();
  await validateShareToken({params:{id:S},query:{}} as any,res,next);
  expect(res.statusCode).toBe(401);expect(next).not.toHaveBeenCalled();expect(find).not.toHaveBeenCalled();
});
test.each([null,{...identity,card_qr_version:1}])("deleted students and revoked cards fail closed",async student=>{
  jest.spyOn(Student,"findOne").mockReturnValue(chain(student));const res=response(),next=jest.fn();
  await validateShareToken({params:{id:S},query:{card:studentCardToken(identity)}} as any,res,next);
  expect(res.statusCode).toBe(401);expect(next).not.toHaveBeenCalled();
});
test("existing temporary report links remain valid",async()=>{
  jest.spyOn(StudentShareToken,"findOne").mockReturnValue(chain({student_id:S}));const next=jest.fn();
  await validateShareToken({params:{id:S},query:{token:"a".repeat(64)}} as any,response(),next);expect(next).toHaveBeenCalled();
});
test("a center student's unified card resolves the matching enrollment inside the scanning teacher's scope",async()=>{
  const find=jest.spyOn(Student,"findOne").mockReturnValue(chain({_id:S,center_student_code:"CTR-0001"}));
  await findScannedStudent({teacher_id:T},{student_code:`https://school.invalid/report/${S}?card=${"a".repeat(64)}&identity=CTR-0001`});
  expect(find).toHaveBeenCalledWith({teacher_id:T,center_student_code:"CTR-0001"});
});
