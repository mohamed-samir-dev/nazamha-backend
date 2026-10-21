jest.mock('../services/atomicController',()=>({atomicController:(handler:unknown)=>handler,series:(queries:any[])=>Promise.all(queries)}));
jest.mock('../controllers/dashboardController',()=>({invalidateDashboardCache:jest.fn()}));
import {updateSubscription,bulkUpdateSubscriptions} from '../controllers/subscriptionsController';
import {MonthlySubscription} from '../models/MonthlySubscription';
import {Student} from '../models/Student';
const T='111111111111111111111111',S='222222222222222222222222',ID='333333333333333333333333',OTHER='444444444444444444444444';
const chain=(value:unknown):any=>({lean(){return this;},then(resolve:any,reject:any){return Promise.resolve(value).then(resolve,reject);}});
const response=():any=>({statusCode:200,status(code:number){this.statusCode=code;return this;},json:jest.fn()});
const req=(body:any):any=>({user:{id:T,user_type:'teacher'},headers:{},params:{id:ID,studentId:S},body});
beforeEach(()=>{
  jest.spyOn(MonthlySubscription,'findOne').mockReturnValue(chain({student_id:S,teacher_id:T,status:'paid',amount:800,discount:120}));
  jest.spyOn(Student,'findOne').mockImplementation((filter:any)=>chain(filter.suspension_kind ? null : {custom_monthly_price:800,teacher_id:T,family_discount_percent:50,discount_value:15}));
  jest.spyOn(MonthlySubscription,'findOneAndUpdate').mockReturnValue(chain({student_id:S,teacher_id:T,status:'due',amount:800,discount:400}));
});
afterEach(()=>jest.restoreAllMocks());
test.each([[50,400],[0,120],[null,120]])('reopening uses current family discount %s before the individual one',async(family,discount)=>{
  (Student.findOne as jest.Mock).mockReturnValue(chain({custom_monthly_price:800,teacher_id:T,family_discount_percent:family,discount_value:15}));
  const res=response();await updateSubscription(req({status:'due',amount:1,discount:1}),res);
  expect(res.statusCode).toBe(200);
  expect(MonthlySubscription.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({_id:ID,teacher_id:T}),{$set:expect.objectContaining({status:'due',amount:800,discount})},{new:true});
});
test('bulk reopening reprices due months while paid updates preserve their amount and discount',async()=>{
  jest.spyOn(MonthlySubscription,'countDocuments').mockReturnValue(chain(2));
  jest.spyOn(MonthlySubscription,'bulkWrite').mockResolvedValue({} as any);
  jest.spyOn(MonthlySubscription,'find').mockReturnValue(chain([{_id:ID,teacher_id:T},{_id:OTHER,teacher_id:T}]));
  await bulkUpdateSubscriptions(req({updates:[{id:ID,status:'due'},{id:OTHER,status:'paid'}]}),response());
  const ops=(MonthlySubscription.bulkWrite as jest.Mock).mock.calls[0][0];
  expect(ops[0].updateOne.update.$set).toEqual(expect.objectContaining({status:'due',amount:800,discount:400}));
  expect(JSON.stringify(ops[1].updateOne.update)).not.toContain('discount');
  expect(JSON.stringify(ops[1].updateOne.update)).not.toContain('amount');
});
test('unowned subscription cannot trigger repricing',async()=>{
  (MonthlySubscription.findOne as jest.Mock).mockReturnValue(chain(null));
  const res=response();await updateSubscription(req({status:'due'}),res);
  expect(res.statusCode).toBe(404);expect(Student.findOne).not.toHaveBeenCalled();
  expect(MonthlySubscription.findOneAndUpdate).not.toHaveBeenCalled();
});
