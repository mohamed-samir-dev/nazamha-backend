import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  teacher_id: { type: Schema.Types.ObjectId, required: true },
  group_id: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  session_date: { type: String, required: true },
  time: { type: String, required: true },
  kind: { type: String, enum: ["regular", "extra"], required: true },
  state: { type: String, enum: ["scheduled", "open", "closed", "cancelled"], default: "scheduled" },
  opens_at: { type: Date, required: true },
  closes_at: { type: Date, required: true },
  grace_minutes: { type: Number, default: 10 },
  roster: [{ type: Schema.Types.ObjectId, ref: "Student" }],
  version: { type: Number, default: 0 },
  events: [{ _id: false, actor_id: String, actor_type: String, at: Date, action: String, reason: String }],
}, { timestamps: true, toJSON: { virtuals: true } });
schema.index({ group_id: 1, session_date: 1 }, { unique: true, partialFilterExpression: { kind: "regular" } });
schema.index({ teacher_id: 1, session_date: -1 });
export const AttendanceLesson = mongoose.model("AttendanceLesson", schema);
