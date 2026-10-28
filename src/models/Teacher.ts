import mongoose, { Schema, Document, Types, Query } from "mongoose";
import bcrypt from "bcryptjs";
import slugify from "slugify";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SubscriptionStatus {
  Trial = "trial",
  Active = "active",
  Expired = "expired",
  Cancelled = "cancelled",
}

export enum Gender {
  Male = "male",
  Female = "female",
}

// ─── Sub-interfaces ───────────────────────────────────────────────────────────

export interface ISubscription {
  plan?: Types.ObjectId;
  status: SubscriptionStatus;
  started_at?: Date;
  expires_at?: Date;
  students_limit: number;
  storage_limit: number;
}

export interface IFeatures {
  attendance: boolean;
  bills: boolean;
  library: boolean;
  exams: boolean;
  assignments: boolean;
  live: boolean;
  notifications: boolean;
  centers: boolean;
}

export interface ISettings {
  language: string;
  timezone: string;
  currency: string;
  allow_online_payment: boolean;
  payment_grace_period_days?: number;
}

export interface IStats {
  students_count: number;
  groups_count: number;
  books_count: number;
  attendance_count: number;
  exams_count: number;
}

export interface ICenter {
  name?: string;
  address?: string;
  phone?: string;
  location?: string;
  logo?: string;
}

export interface ISocial {
  facebook?: string;
  telegram?: string;
  whatsapp?: string;
  youtube?: string;
}

export interface IPayment {
  vodafone_cash?: string;
  instapay?: string;
  bank_account?: string;
}

export interface ITheme {
  primary_color?: string;
  secondary_color?: string;
  logo?: string;
  cover?: string;
}

export interface IBanner {
  enabled: boolean;
  message: string;
  type: "info" | "warning" | "success" | "danger";
}

export interface IAcademicYear {
  active_months: number[]; // 1-12
  active_month_years: { month: number; year: number }[];
}

// ─── Main Interface ───────────────────────────────────────────────────────────

export interface ITeacher extends Document {
  name: string;
  email: string;
  password: string;
  session_version?: number;
  phone?: string;
  avatar?: string;
  bio?: string;
  subject?: string;
  experience_years?: number;
  gender?: Gender;
  slug: string;
  center_id?: Types.ObjectId | null;

  books: Types.ObjectId[];
  groups: Types.ObjectId[];
  grades: Types.ObjectId[];

  subscription: ISubscription;
  features: IFeatures;
  settings: ISettings;
  stats: IStats;
  center: ICenter;
  social: ISocial;
  payment: IPayment;
  theme: ITheme;
  banner: IBanner;
  academic_year: IAcademicYear;

  is_active: boolean;
  /** @deprecated Not used in authorization logic. Authorization is handled by the Admin model. */
  is_super_admin: boolean;
  hidden_from_admin: boolean;
  is_email_verified: boolean;
  email_verification_token?: string;
  failed_login_attempts: number;
  last_login_at?: Date;
  last_login_ip?: string;
  last_seen_at?: Date;
  password_changed_at?: Date;
  refresh_token?: string;

  deleted_at?: Date | null;
  subscription_price?: number;
  monthly_price?: number;
  has_bills_feature?: boolean;
  has_attendance_feature?: boolean;
  is_center_mode?: boolean;
  plan_id?: Types.ObjectId | null;
  subscription_started_at?: Date;
  subscription_expires_at?: Date;

  comparePassword(candidate: string): Promise<boolean>;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const SubscriptionSchema = new Schema<ISubscription>(
  {
    plan: { type: Schema.Types.ObjectId, ref: "Plan" },
    status: { type: String, enum: Object.values(SubscriptionStatus), default: SubscriptionStatus.Trial },
    started_at: { type: Date },
    expires_at: { type: Date },
    students_limit: { type: Number, default: 0 },
    storage_limit: { type: Number, default: 0 },
  },
  { _id: false }
);

const FeaturesSchema = new Schema<IFeatures>(
  {
    attendance: { type: Boolean, default: true },
    bills: { type: Boolean, default: false },
    library: { type: Boolean, default: false },
    exams: { type: Boolean, default: false },
    assignments: { type: Boolean, default: false },
    live: { type: Boolean, default: false },
    notifications: { type: Boolean, default: true },
    centers: { type: Boolean, default: false },
  },
  { _id: false }
);

const SettingsSchema = new Schema<ISettings>(
  {
    language: { type: String, default: "ar" },
    timezone: { type: String, default: "Africa/Cairo" },
    currency: { type: String, default: "EGP" },
    allow_online_payment: { type: Boolean, default: false },
    payment_grace_period_days: { type: Number, min: 0, max: 31 },
  },
  { _id: false }
);

const StatsSchema = new Schema<IStats>(
  {
    students_count: { type: Number, default: 0 },
    groups_count: { type: Number, default: 0 },
    books_count: { type: Number, default: 0 },
    attendance_count: { type: Number, default: 0 },
    exams_count: { type: Number, default: 0 },
  },
  { _id: false }
);

const CenterSchema = new Schema<ICenter>(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    location: { type: String },
    logo: { type: String },
  },
  { _id: false }
);

const SocialSchema = new Schema<ISocial>(
  { facebook: String, telegram: String, whatsapp: String, youtube: String },
  { _id: false }
);

const PaymentSchema = new Schema<IPayment>(
  { vodafone_cash: String, instapay: String, bank_account: String },
  { _id: false }
);

const ThemeSchema = new Schema<ITheme>(
  {
    primary_color: { type: String, default: "#14b8a6" },
    secondary_color: { type: String, default: "#0f172a" },
    logo: String,
    cover: String,
  },
  { _id: false }
);

const BannerSchema = new Schema<IBanner>(
  {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: "" },
    type: { type: String, enum: ["info", "warning", "success", "danger"], default: "info" },
  },
  { _id: false }
);

const AcademicYearSchema = new Schema<IAcademicYear>(
  {
    active_months: { type: [Number], default: [9, 10, 11, 12, 1, 2, 3, 4, 5] },
    active_month_years: { type: [{ month: Number, year: Number, _id: false }], default: [] },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const TeacherSchema = new Schema<ITeacher>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    session_version: { type: Number, default: 0 },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, trim: true },
    avatar: { type: String },
    bio: { type: String, maxlength: 500 },
    subject: { type: String, trim: true },
    experience_years: { type: Number, min: 0, max: 60 },
    gender: { type: String, enum: Object.values(Gender) },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    books: [{ type: Schema.Types.ObjectId, ref: "Book" }],
    groups: [{ type: Schema.Types.ObjectId, ref: "Group" }],
    grades: [{ type: Schema.Types.ObjectId, ref: "Grade" }],

    subscription: { type: SubscriptionSchema, default: () => ({}) },
    features: { type: FeaturesSchema, default: () => ({}) },
    settings: { type: SettingsSchema, default: () => ({}) },
    stats: { type: StatsSchema, default: () => ({}) },
    center: { type: CenterSchema, default: () => ({}) },
    social: { type: SocialSchema, default: () => ({}) },
    payment: { type: PaymentSchema, default: () => ({}) },
    theme: { type: ThemeSchema, default: () => ({}) },
    banner: { type: BannerSchema, default: () => ({}) },
    academic_year: { type: AcademicYearSchema, default: () => ({}) },

    is_active: { type: Boolean, default: false },
    /** @deprecated Not used in authorization. See Admin.is_super_admin instead. */
    is_super_admin: { type: Boolean, default: false },
    hidden_from_admin: { type: Boolean, default: false },
    is_email_verified: { type: Boolean, default: false },
    email_verification_token: { type: String, select: false },
    failed_login_attempts: { type: Number, default: 0 },
    last_login_at: { type: Date },
    last_login_ip: { type: String },
    last_seen_at: { type: Date },
    password_changed_at: { type: Date },
    refresh_token: { type: String, select: false },

    deleted_at: { type: Date, default: null },
    subscription_price: { type: Number, default: 0 },
    monthly_price: { type: Number, default: 0 },
    has_bills_feature: { type: Boolean, default: false },
    has_attendance_feature: { type: Boolean, default: true },
    is_center_mode: { type: Boolean, default: false },
    plan_id: { type: Schema.Types.ObjectId, ref: "Plan", default: null },
    subscription_started_at: { type: Date },
    subscription_expires_at: { type: Date },
    center_id: { type: Schema.Types.ObjectId, ref: "Center", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret["password"];
        delete ret["__v"];
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

TeacherSchema.virtual("books_count").get(function () {
  return this.books?.length ?? 0;
});

TeacherSchema.virtual("groups_count").get(function () {
  return this.groups?.length ?? 0;
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

TeacherSchema.index({ "subscription.status": 1 });
TeacherSchema.index({ is_active: 1 });
TeacherSchema.index({ deleted_at: 1 });
TeacherSchema.index({ center_id: 1 });
TeacherSchema.index({ center_id: 1, is_active: 1 });
TeacherSchema.index({ center_id: 1, deleted_at: 1, created_at: -1 });

// ─── Soft Delete Middleware ───────────────────────────────────────────────────

TeacherSchema.pre(/^find/, function (this: Query<unknown, ITeacher>, next) {
  const conditions = this.getFilter();
  if (!("deleted_at" in conditions)) {
    this.where({ deleted_at: null });
  }
  next();
});

// ─── Slug Generation ─────────────────────────────────────────────────────────

async function generateUniqueSlug(base: string, excludeId?: Types.ObjectId): Promise<string> {
  const baseSlug = slugify(base, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const query: Record<string, unknown> = { slug, deleted_at: null };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Teacher.findOne(query).select("_id").lean();
    if (!existing) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

TeacherSchema.pre("validate", async function (next) {
  if (!this.slug) {
    this.slug = await generateUniqueSlug(this.name, this._id as Types.ObjectId);
  }
  next();
});

// ─── Password Hook ────────────────────────────────────────────────────────────

TeacherSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.session_version = (this.session_version || 0) + 1;
  if (!this.isNew) this.password_changed_at = new Date();
  next();
});

// ─── Methods ──────────────────────────────────────────────────────────────────

TeacherSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const Teacher = mongoose.model<ITeacher>("Teacher", TeacherSchema);
