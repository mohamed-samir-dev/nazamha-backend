import mongoose,{Schema} from "mongoose";
const schema=new Schema({student_id:{type:Schema.Types.ObjectId,ref:"Student",required:true},teacher_id:{type:Schema.Types.ObjectId,ref:"Teacher",required:true},group_id:{type:Schema.Types.ObjectId,ref:"Group",default:null},grade_id:{type:Schema.Types.ObjectId,ref:"Grade",default:null},starts_on:{type:String,required:true},ends_on:{type:String,default:null},actor_id:String,reason:String},{timestamps:{createdAt:"created_at",updatedAt:"updated_at"}});
schema.index({student_id:1,starts_on:-1});schema.index({student_id:1},{unique:true,partialFilterExpression:{ends_on:{$type:"null"}}});
export const StudentMembership=mongoose.model("StudentMembership",schema);
