import mongoose, {Schema} from "mongoose";

export type SubstitutionAction = "guest" | "compensate" | "exempt";
const schema=new Schema({
  teacher_id:{type:Schema.Types.ObjectId,required:true},
  student_id:{type:Schema.Types.ObjectId,required:true},
  original_group_id:{type:Schema.Types.ObjectId,required:true},
  actual_group_id:{type:Schema.Types.ObjectId,required:true},
  actual_date:{type:String,required:true},
  actual_session_id:{type:Schema.Types.ObjectId,ref:"AttendanceSession",required:true},
  attendance_id:{type:Schema.Types.ObjectId,ref:"AttendanceRecord",required:true},
  target_group_id:{type:Schema.Types.ObjectId,required:true},
  target_date:{type:String,required:true},
  target_session_id:{type:Schema.Types.ObjectId,ref:"AttendanceSession",required:true},
  kind:{type:String,enum:["compensate","exempt"],required:true},
  state:{type:String,enum:["approved","revoked","review"],default:"approved"},
  active:{type:Boolean,default:true},
  approved_by:{type:Schema.Types.ObjectId,required:true},
  history:[{_id:false,at:{type:Date,required:true},actor_id:{type:Schema.Types.ObjectId,required:true},actor_type:String,action:String,reason:String,previous_state:String,resulting_state:String}],
},{timestamps:{createdAt:"created_at",updatedAt:"updated_at"},toJSON:{virtuals:true}});
schema.index({student_id:1,target_group_id:1,target_date:1},{unique:true,partialFilterExpression:{active:true}});
schema.index({attendance_id:1},{unique:true,partialFilterExpression:{active:true}});
schema.index({teacher_id:1,created_at:-1});
schema.index({teacher_id:1,student_id:1,target_date:1,active:1});
schema.index({teacher_id:1,target_date:1,active:1});
schema.index({teacher_id:1,actual_group_id:1,actual_date:1,active:1});
export const AttendanceSubstitution=mongoose.model("AttendanceSubstitution",schema);
