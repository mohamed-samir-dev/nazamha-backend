/** Dry run by default. Run with --apply during a maintenance window after backup. */
import "dotenv/config";
import mongoose from "mongoose";
import {AttendanceRecord} from "../src/models/AttendanceRecord";
import {AttendanceLesson} from "../src/models/AttendanceLesson";
async function main() {
  if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI required");
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
  const collection=AttendanceRecord.collection;
  const missing=await collection.countDocuments({session_slot:{$exists:false}});
  const duplicates=await collection.aggregate([{$group:{_id:{student:"$student_id",date:"$session_date",slot:{$ifNull:["$session_slot","regular"]}},count:{$sum:1}}},{$match:{count:{$gt:1}}},{$count:"count"}]).toArray();
  const indexes=await collection.indexes();
  console.log(JSON.stringify({apply:process.argv.includes("--apply"),legacyRecords:missing,duplicateKeys:duplicates[0]?.count||0,oldIndex:indexes.find(i=>Object.keys(i.key).length===2&&i.key.student_id===1&&i.key.session_date===1)?.name}));
  if(!process.argv.includes("--apply"))return;
  if(duplicates.length)throw new Error("Resolve duplicate attendance keys before migration; no records changed");
  await collection.updateMany({session_slot:{$exists:false}},{$set:{session_slot:"regular"}});
  await collection.updateMany({voided_at:{$exists:false}},{$set:{voided_at:null}});
  // Build the replacement before removing the old constraint; safe to rerun.
  await collection.createIndex({student_id:1,session_date:1,session_slot:1},{unique:true});
  for(const i of indexes)if(Object.keys(i.key).length===2&&i.key.student_id===1&&i.key.session_date===1&&i.name)await collection.dropIndex(i.name);
  await AttendanceLesson.createIndexes();
  console.log("Attendance migration complete. Original timestamps and unknown historic arrivals were preserved.");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
