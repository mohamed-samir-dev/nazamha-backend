import {studentSubscriptionDiscount} from '../utils/studentSubscriptionDiscount';
import {generateSubscriptionsForStudent} from '../services/subscriptionLifecycle';
import {MonthlySubscription} from '../models/MonthlySubscription';
const S='222222222222222222222222',T='111111111111111111111111';
const student={custom_monthly_price:800,family_discount_percent:50,discount_value:15};
const chain=(value:unknown):any=>({setOptions(){return this;},lean(){return this;},select(){return this;},then(resolve:any,reject:any){return Promise.resolve(value).then(resolve,reject);}});
afterEach(()=>jest.restoreAllMocks());
test('the current family discount corrects old unpaid months and also prices new months',async()=>{
  jest.spyOn(MonthlySubscription,'find').mockReturnValue(chain([
    {month:11,year:2026,status:'due',amount:800,discount:120},
    {month:12,year:2026,status:'paid',amount:800,discount:120},
  ]));
  jest.spyOn(MonthlySubscription,'bulkWrite').mockResolvedValue({} as any);
  await generateSubscriptionsForStudent(S,T,11,2026,undefined,[{month:11,year:2026},{month:12,year:2026},{month:1,year:2027}],undefined,student);
  const ops=(MonthlySubscription.bulkWrite as jest.Mock).mock.calls[0][0];
  const november=ops.find((op:any)=>op.updateOne.filter.month===11).updateOne;
  expect(november.update.$set.discount).toBe(400);expect(november.update.$set.amount).toBeUndefined();
  expect(november.filter.status).toEqual({$in:['due','not_due']});
  const january=ops.find((op:any)=>op.updateOne.filter.month===1).updateOne;
  expect(january.update.$setOnInsert).toEqual(expect.objectContaining({amount:800,discount:400,status:'due'}));
  expect(ops.some((op:any)=>op.updateOne.filter.month===12)).toBe(false);
});
test('unpaid months keep their base prices but share the same discount percentage',()=>{
  expect(studentSubscriptionDiscount(800,student)).toBe(400);
  expect(studentSubscriptionDiscount(600,student)).toBe(300);
  expect(studentSubscriptionDiscount(800,{discount_value:15})).toBe(120);
  expect(studentSubscriptionDiscount(800,{family_discount_percent:0,discount_value:15})).toBe(120);
  expect(studentSubscriptionDiscount(800,{family_discount_percent:50,discount_value:0})).toBe(400);
});
test('an explicit discount update is reflected the next time unpaid months are synchronized',async()=>{
  jest.spyOn(MonthlySubscription,'find').mockReturnValue(chain([{month:11,year:2026,status:'due',amount:800,discount:400}]));
  jest.spyOn(MonthlySubscription,'bulkWrite').mockResolvedValue({} as any);
  await generateSubscriptionsForStudent(S,T,11,2026,undefined,[{month:11,year:2026}],undefined,{...student,family_discount_percent:null});
  expect((MonthlySubscription.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update.$set.discount).toBe(120);
});
