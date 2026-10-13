import mongoose, { Schema } from "mongoose";
const schema = new Schema({ _id: String, owner: String, expires_at: Date });
export const JobLease = mongoose.model("JobLease", schema);
