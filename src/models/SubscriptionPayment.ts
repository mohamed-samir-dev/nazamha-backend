import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  teacher_id: { type: Schema.Types.ObjectId, required: true },
  student_id: { type: Schema.Types.ObjectId, required: true },
  operation_key: { type: String, required: true },
  request_hash: { type: String, required: true },
  name: { type: String, required: true },
  code: String,
  amount: { type: Number, required: true },
  months: [{ _id: false, month: Number, year: Number }],
  response: { type: Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });
schema.index({ teacher_id: 1, operation_key: 1 }, { unique: true });
schema.index({ teacher_id: 1, created_at: -1 });
export const SubscriptionPayment = mongoose.model("SubscriptionPayment", schema);
