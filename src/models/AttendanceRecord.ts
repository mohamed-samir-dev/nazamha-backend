import mongoose, { Schema, Document } from "mongoose";

export interface IAttendanceRecord extends Document {
  attendance_kind?: "regular" | "guest" | "substitute";
  original_group_id?: mongoose.Types.ObjectId;
  session_id?: mongoose.Types.ObjectId;
  attendance_revision?: number;
  scanner_group_id?: mongoose.Types.ObjectId | null;
  scanner_session_date?: string;
  student_id: mongoose.Types.ObjectId;
  session_date: string;
  month: number;
  year: number;
  status: "present" | "absent";
  group_id?: mongoose.Types.ObjectId | null;
  teacher_id: mongoose.Types.ObjectId;
  created_at: Date;
}

const AttendanceRecordSchema = new Schema<IAttendanceRecord>(
  {
    attendance_kind:{type:String,enum:["regular","guest","substitute"],default:"regular"},
    original_group_id:{type:Schema.Types.ObjectId,ref:"Group"},
    session_id:{type:Schema.Types.ObjectId,ref:"AttendanceSession"},
    attendance_revision:{type:Number,default:0},
    scanner_group_id: {type: Schema.Types.ObjectId, ref:"Group", default:null},
    scanner_session_date: {type:String},
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    session_date: { type: String, required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    status: { type: String, enum: ["present", "absent"], required: true },
    group_id: { type: Schema.Types.ObjectId, ref: "Group", default: null },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

// unique constraint: one record per student per session date
AttendanceRecordSchema.index({ student_id: 1, group_id:1, session_date: 1 }, { unique: true });
AttendanceRecordSchema.index({ teacher_id: 1, month: 1, year: 1 });
// all-time-stats aggregation + last-session-absentees: teacher + student + status
AttendanceRecordSchema.index({ teacher_id: 1, student_id: 1, status: 1 });
// auto-absent query: group + session_date
AttendanceRecordSchema.index({ group_id: 1, session_date: 1 });
// student monthly absences query
AttendanceRecordSchema.index({ student_id: 1, month: 1, year: 1, status: 1 });
// last-session-absentees: teacher + group + session_date
AttendanceRecordSchema.index({ teacher_id: 1, group_id: 1, session_date: 1 });

// ── Performance indexes (P3) ──────────────────────────────────────────────────
AttendanceRecordSchema.index({ teacher_id: 1, session_date: 1 }); // dashboard date-range counts
AttendanceRecordSchema.index({teacher_id:1,scanner_group_id:1,scanner_session_date:1});

export const AttendanceRecord = mongoose.model<IAttendanceRecord>("AttendanceRecord", AttendanceRecordSchema);
