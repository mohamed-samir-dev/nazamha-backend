jest.mock('../services/atomicController', () => ({ atomicController: (handler: unknown) => handler, series: (queries: any[]) => Promise.all(queries) }));
jest.mock('../controllers/dashboardController', () => ({ invalidateDashboardCache: jest.fn() }));
import { paySubscriptions } from '../controllers/subscriptionsController';
import { Student } from '../models/Student';
import { MonthlySubscription } from '../models/MonthlySubscription';
import { SubscriptionPayment } from '../models/SubscriptionPayment';
const T='111111111111111111111111', S='222222222222222222222222', ID='333333333333333333333333';
const chain = (value: unknown): any => ({ lean() { return this; }, select() { return this; }, sort() { return this; }, then(resolve: any, reject: any) { return Promise.resolve(value).then(resolve,reject); } });
const response = (): any => ({ statusCode:200, status(code:number) { this.statusCode=code; return this; }, json:jest.fn() });
const request = (amount=200): any => ({ params:{studentId:S}, headers:{'idempotency-key':'test-key'}, user:{id:T,user_type:'teacher'}, body:{items:[{id:ID,amount,discount:20}]} });
beforeEach(() => {
  jest.spyOn(Student,'findOne').mockImplementation((filter:any) => filter.suspension_kind ? chain(null) : chain(new Student({_id:S,teacher_id:T,name:'QA',code:'QA-1'})));
  jest.spyOn(SubscriptionPayment,'findOne').mockReturnValue(chain(null));
  jest.spyOn(SubscriptionPayment,'create').mockResolvedValue({} as never);
  jest.spyOn(Student,'findById').mockReturnValue(chain(new Student({_id:S,teacher_id:T,name:'QA',is_suspended:true})));
  jest.spyOn(MonthlySubscription,'find').mockReturnValue(chain([new MonthlySubscription({_id:ID,student_id:S,teacher_id:T,status:'due',month:10,year:2026,amount:200,discount:20})]));
  jest.spyOn(MonthlySubscription,'updateMany').mockResolvedValue({modifiedCount:1} as any);
});
afterEach(() => jest.restoreAllMocks());
test('payment derives receipt total from server records and returns id fields',async()=>{
  const res=response(); await paySubscriptions(request(),res);
  expect(res.statusCode).toBe(200);
  const data=res.json.mock.calls[0][0];
  expect(data.receipt.amount).toBe(180); expect(data.subscriptions[0].id).toBe(ID); expect(data.student.id).toBe(S);
  expect(SubscriptionPayment.create).toHaveBeenCalledWith(expect.objectContaining({teacher_id:expect.anything(),operation_key:'test-key',response:expect.anything()}));
  expect(Student.findOne).toHaveBeenCalledTimes(1);
  expect(Student.findById).not.toHaveBeenCalled();
});
test('stale displayed amount rejects the entire payment before writing',async()=>{
  const res=response(); await paySubscriptions(request(250),res); expect(res.statusCode).toBe(409);
  expect(MonthlySubscription.updateMany).not.toHaveBeenCalled(); expect(SubscriptionPayment.create).not.toHaveBeenCalled();
});
test('paid or exempt months cannot be charged with a different operation',async()=>{
  (MonthlySubscription.find as jest.Mock).mockReturnValue(chain([new MonthlySubscription({_id:ID,student_id:S,teacher_id:T,status:'paid',month:10,year:2026,amount:200,discount:20})]));
  const res=response(); await paySubscriptions(request(),res); expect(res.statusCode).toBe(409); expect(MonthlySubscription.updateMany).not.toHaveBeenCalled();
});
test('foreign or missing subscription rejects without partial writes',async()=>{
  (MonthlySubscription.find as jest.Mock).mockReturnValue(chain([]));
  const res=response(); await paySubscriptions(request(),res); expect(res.statusCode).toBe(404); expect(MonthlySubscription.updateMany).not.toHaveBeenCalled();
});
test('duplicate ids and missing operation key are rejected',async()=>{
  const req=request(); req.body.items.push(req.body.items[0]); let res=response(); await paySubscriptions(req,res); expect(res.statusCode).toBe(400);
  const missing=request(); missing.headers={}; res=response(); await paySubscriptions(missing,res); expect(res.statusCode).toBe(400);
});
test('manual suspension is preserved without extra student queries',async()=>{
  (Student.findOne as jest.Mock).mockReturnValue(chain(new Student({_id:S,teacher_id:T,name:'QA',is_suspended:true,suspension_kind:'manual'})));
  const update=jest.spyOn(Student,'findOneAndUpdate').mockReturnValue(chain(null));
  const res=response(); await paySubscriptions(request(),res);
  expect(res.json.mock.calls[0][0].student.is_suspended).toBe(true);
  expect(update).not.toHaveBeenCalled();
});
test('financial suspension is lifted only below its configured threshold',async()=>{
  (Student.findOne as jest.Mock).mockReturnValue(chain(new Student({_id:S,teacher_id:T,name:'QA',is_suspended:true,suspension_kind:'financial',suspension_threshold:2})));
  const update=jest.spyOn(Student,'findOneAndUpdate').mockReturnValue(chain(new Student({_id:S,teacher_id:T,name:'QA',is_suspended:false})));
  const res=response(); await paySubscriptions(request(),res);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({teacher_id:expect.anything(),suspension_kind:'financial'}),expect.anything(),{new:true});
  expect(res.json.mock.calls[0][0].student.is_suspended).toBe(false);
});
test('automatic payment rejects newly discovered arrears before writing',async()=>{
  jest.spyOn(MonthlySubscription,'exists').mockReturnValue(chain({_id:ID}));
  const req=request(); req.body.autoPeriod={month:10,year:2026};
  const res=response(); await paySubscriptions(req,res);
  expect(res.statusCode).toBe(409); expect(MonthlySubscription.updateMany).not.toHaveBeenCalled();
});
test('automatic payment accepts only the requested current subscription',async()=>{
  jest.spyOn(MonthlySubscription,'exists').mockReturnValue(chain(null));
  const req=request(); req.body.autoPeriod={month:10,year:2026};
  const res=response(); await paySubscriptions(req,res);
  expect(res.statusCode).toBe(200); expect(MonthlySubscription.updateMany).toHaveBeenCalledTimes(1);
});
test('automatic payment rejects a different selected period',async()=>{
  jest.spyOn(MonthlySubscription,'exists').mockReturnValue(chain(null));
  const req=request(); req.body.autoPeriod={month:11,year:2026};
  const res=response(); await paySubscriptions(req,res);
  expect(res.statusCode).toBe(409); expect(MonthlySubscription.updateMany).not.toHaveBeenCalled();
});
