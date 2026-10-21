/* Scoped maintenance: preview by default; apply the student's stored policy only. */
require('dotenv/config');
const mongoose=require('mongoose');
const {studentSubscriptionDiscount}=require('../dist/utils/studentSubscriptionDiscount');
(async()=>{
  const studentId=process.env.REPAIR_STUDENT_ID,code=process.env.REPAIR_STUDENT_CODE;
  if(!/^[a-f\d]{24}$/i.test(studentId||'')||!code)throw Error('Exact student ID and code are required');
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,serverSelectionTimeoutMS:15000,socketTimeoutMS:20000});
  const db=mongoose.connection.db,apply=process.argv.includes('--apply');
  await mongoose.connection.transaction(async session=>{
    const student=await db.collection('students').findOne({_id:new mongoose.Types.ObjectId(studentId),code},{session});
    if(!student)throw Error('Student ID and code did not match');
    for(const value of [student.family_discount_percent,student.discount_value])if(value!=null&&(!Number.isFinite(value)||value<0||value>100))throw Error('Invalid stored discount');
    const filter={student_id:student._id,teacher_id:student.teacher_id,status:{$in:['due','not_due']}};
    const subs=await db.collection('monthlysubscriptions').find(filter,{session}).toArray();
    const changes=subs.map(sub=>({sub,discount:studentSubscriptionDiscount(sub.amount,student)})).filter(({sub,discount})=>sub.discount!==discount);
    if(changes.some(({sub})=>!Number.isFinite(sub.amount)||sub.amount<0))throw Error('Invalid stored amount');
    if(apply&&changes.length){
      const result=await db.collection('monthlysubscriptions').bulkWrite(changes.map(({sub,discount})=>({updateOne:{filter:{...filter,_id:sub._id,amount:sub.amount,discount:sub.discount},update:{$set:{discount,updated_at:new Date()}}}})),{session,ordered:true});
      if(result.modifiedCount!==changes.length)throw Error('Subscription data changed during reconciliation');
      await db.collection('auditlogs').insertOne({teacher_id:student.teacher_id,action:'discount.apply',resource_type:'student.subscription.discount.reconciliation',resource_id:String(student._id),outcome:'success',created_at:new Date(),new_data:{source:'Local maintenance authorized by the user in chat',policy:{family_discount_percent:student.family_discount_percent,discount_value:student.discount_value},changes:changes.map(({sub,discount})=>({id:String(sub._id),month:sub.month,year:sub.year,amount:sub.amount,old_discount:sub.discount,discount}))}},{session});
    }
    console.log(JSON.stringify({applied:apply,code:student.code,changes:changes.map(({sub,discount})=>({month:sub.month,year:sub.year,amount:sub.amount,old_discount:sub.discount,discount,net:sub.amount-discount}))}));
  });
  await mongoose.disconnect();
})().catch(async error=>{console.error(error.message.replace(/mongodb[^\s]*/gi,'[redacted]'));await mongoose.disconnect();process.exitCode=1;});
