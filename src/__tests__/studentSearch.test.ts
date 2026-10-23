import { studentSearchFilter } from '../utils/studentSearch';
import { getStudents } from '../controllers/students.crud.controller';
import { Student } from '../models/Student';
function matches(student:Record<string,string>,q:string) {
 const filter=studentSearchFilter(q) as any;
 return !filter.$or || filter.$or.some((branch:any)=>{const [field,rule]=Object.entries(branch)[0] as [string,any];return new RegExp(rule.$regex,rule.$options).test(student[field]||'');});
}
const student={name:'أحمد محمد',code:'GROUP-0100',center_student_code:'TPC7-0003'};
test.each(['T','TP','TPC7','TPC7-','TPC7-0','TPC7-0003','tpc7-0003','TPC7–0003','TPC7‑٠٠٠٣','\u200fTPC7-0003\u200e',' TPC7 - 0003 '])('progressive/normalized center code search keeps matching %s',q=>expect(matches(student,q)).toBe(true));
test('name and group code remain searchable; regex input stays literal',()=>{
 expect(matches(student,'أحمد')).toBe(true);expect(matches(student,'GROUP-')).toBe(true);
 expect(matches(student,'.*')).toBe(false);expect(matches(student,'TPC7-9999')).toBe(false);
 expect(matches(student,'   ')).toBe(true);
});
afterEach(()=>jest.restoreAllMocks());
test('listing applies center code search together with owner and grade filters',async()=>{
 const chain:any={select(){return this;},sort(){return this;},skip(){return this;},limit(){return this;},lean:jest.fn().mockResolvedValue([])};
 const find=jest.spyOn(Student,'find').mockReturnValue(chain),count=jest.spyOn(Student,'countDocuments').mockResolvedValue(0);
 const response:any={json:jest.fn(),status:jest.fn().mockReturnThis()};
 await getStudents({query:{page:'1',search:'TPC7-',grade_id:'grade'},user:{id:'owner',user_type:'teacher',is_admin:false}} as any,response);
 const filter=(find.mock.calls as unknown as any[][])[0][0];
 expect(filter.teacher_id).toBe('owner');expect(filter.grade_id).toBe('grade');
 expect(filter.$or).toContainEqual({center_student_code:{$regex:'TPC7-',$options:'i'}});
 expect(count).toHaveBeenCalledWith(filter);
});
