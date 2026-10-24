/** Inspect first. --apply changes only indexes, never historical attendance. */
import "dotenv/config";
import mongoose from "mongoose";
import {AttendanceRecord} from "../src/models/AttendanceRecord";
import {AttendanceSubstitution} from "../src/models/AttendanceSubstitution";
async function main(){
 if(!process.env.MONGODB_URI)throw new Error("MONGODB_URI مطلوب");
 await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
 const collection=AttendanceRecord.collection,indexes=await collection.indexes();
 const duplicate=await collection.aggregate([{$group:{_id:{student:"$student_id",group:"$group_id",date:"$session_date"},count:{$sum:1}}},{$match:{count:{$gt:1}}},{$count:"count"}]).toArray();
 const legacyAlternative=await collection.countDocuments({scanner_group_id:{$ne:null},$expr:{$ne:["$group_id","$scanner_group_id"]}});
 const orphaned=await collection.countDocuments({group_id:null});
 console.log(JSON.stringify({apply:process.argv.includes("--apply"),duplicateLessonKeys:duplicate[0]?.count||0,legacyAlternativeRecordsForManualReview:legacyAlternative,recordsWithoutGroup:orphaned},null,2));
 if(!process.argv.includes("--apply"))return;
 if(duplicate.length)throw new Error("توجد سجلات مكررة؛ لم يتم تغيير الفهارس");
 await collection.createIndex({student_id:1,group_id:1,session_date:1},{unique:true});
 await AttendanceSubstitution.createIndexes();
 // Keep the existing constraint until the replacement has been built successfully.
 for(const index of indexes)if(index.name&&Object.keys(index.key).length===2&&index.key.student_id===1&&index.key.session_date===1)await collection.dropIndex(index.name);
 console.log("تم تحديث فهارس الحضور. لم تُعدّل السجلات القديمة أو أوقاتها أو تُنشأ تعويضات رجعية.");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
