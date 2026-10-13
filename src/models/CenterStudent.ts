import mongoose, { Schema, Document } from "mongoose";

export interface ICenterStudent extends Document {
  center_id: mongoose.Types.ObjectId;
  center_student_code: string; // format: ABC-0001
  center_prefix: string;       // 3 uppercase letters derived from center name
  seq: number;                 // auto-increment per center
  name: string;                // normalized (trimmed + collapsed whitespace)
  parent_phone: string;        // normalized (digits only)
  created_at: Date;
  updated_at: Date;
}

const CenterStudentSchema = new Schema<ICenterStudent>(
  {
    center_id:           { type: Schema.Types.ObjectId, ref: "Center", required: true },
    center_student_code: { type: String, required: true },
    center_prefix:       { type: String, required: true, maxlength: 3 },
    seq:                 { type: Number, required: true },
    name:                { type: String, required: true, trim: true },
    parent_phone:        { type: String, default: "" },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Matching index: البحث عن طالب موجود بنفس البيانات داخل السنتر
CenterStudentSchema.index({ center_id: 1, name: 1, parent_phone: 1 });

// Unique: كود واحد فقط لكل طالب داخل نفس السنتر — يمنع duplicates على مستوى DB
CenterStudentSchema.index({ center_id: 1, center_student_code: 1 }, { unique: true });

// Lookup by code (public report endpoint)
CenterStudentSchema.index({ center_student_code: 1 });

CenterStudentSchema.index({center_id:1,seq:-1});
export const CenterStudent = mongoose.model<ICenterStudent>("CenterStudent", CenterStudentSchema);
