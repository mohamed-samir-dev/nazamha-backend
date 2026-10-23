import mongoose, {Schema} from "mongoose";
const schema = new Schema({teacher_id:{type:Schema.Types.ObjectId,required:true},group_id:{type:Schema.Types.ObjectId,required:true},session_date:{type:String,required:true},time:{type:String,required:true},cancelled:{type:Boolean,default:false}});
schema.index({group_id:1,session_date:1},{unique:true});
schema.index({teacher_id:1,session_date:1});
export const AttendanceSession = mongoose.model("AttendanceSession",schema);
