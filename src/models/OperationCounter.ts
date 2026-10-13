import mongoose, { Schema } from "mongoose";
export const OperationCounter=mongoose.model("OperationCounter",new Schema({_id:String,value:{type:Number,default:0}}));
