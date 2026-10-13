import mongoose,{Schema} from "mongoose";
const schema=new Schema({_id:String,body_hash:String,status:Number,response:Schema.Types.Mixed,expires_at:Date});
schema.index({expires_at:1},{expireAfterSeconds:0});
export const WriteReceipt=mongoose.model("WriteReceipt",schema);
