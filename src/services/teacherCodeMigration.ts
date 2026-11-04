import mongoose from "mongoose";
import { generateUniqueTeacherCode } from "../utils/teacherCode";
import { Teacher } from "../models/Teacher";

export interface BackfillReport {
  total: number;
  alreadyHadCode: number;
  updated: number;
  errors: number;
  details: {
    teacherId: string;
    email: string;
    teacherCode: string;
    status: "assigned" | "already_had_code" | "error";
    error?: string;
  }[];
}

/**
 * Safely backfills missing teacherCode fields for existing teachers.
 * - Idempotent: safe to run multiple times.
 * - Non-destructive: preserves all existing codes and teacher data.
 * - Covers all teachers in the collection (including soft-deleted).
 */
export async function backfillTeacherCodes(options?: {
  model?: mongoose.Model<any>;
  log?: boolean;
}): Promise<BackfillReport> {
  const targetModel = options?.model || Teacher;
  const shouldLog = options?.log ?? false;

  // Query directly from collection to avoid soft-delete filter
  const allTeachers = await targetModel.collection.find({}).toArray();

  const report: BackfillReport = {
    total: allTeachers.length,
    alreadyHadCode: 0,
    updated: 0,
    errors: 0,
    details: [],
  };

  if (shouldLog) {
    console.log(`🔍 Found ${allTeachers.length} teachers in total.`);
  }

  for (const doc of allTeachers) {
    const teacherId = doc._id.toString();
    const email = doc.email || "";

    if (doc.teacherCode && typeof doc.teacherCode === "string" && doc.teacherCode.trim().length > 0) {
      report.alreadyHadCode++;
      report.details.push({
        teacherId,
        email,
        teacherCode: doc.teacherCode,
        status: "already_had_code",
      });
      continue;
    }

    // Missing or empty teacherCode: generate and assign atomically
    let assigned = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!assigned && attempts < maxAttempts) {
      attempts++;
      try {
        const newCode = await generateUniqueTeacherCode(targetModel);

        // Atomic update only if teacherCode is still not set
        const updateResult = await targetModel.collection.updateOne(
          {
            _id: doc._id,
            $or: [
              { teacherCode: { $exists: false } },
              { teacherCode: null },
              { teacherCode: "" },
            ],
          },
          { $set: { teacherCode: newCode } }
        );

        if (updateResult.modifiedCount > 0) {
          report.updated++;
          report.details.push({
            teacherId,
            email,
            teacherCode: newCode,
            status: "assigned",
          });
          assigned = true;
          if (shouldLog) {
            console.log(`✅ Assigned code ${newCode} to teacher ${email} (${teacherId})`);
          }
        } else {
          // Document was already updated concurrently or has code
          const rechecked = await targetModel.collection.findOne({ _id: doc._id });
          if (rechecked?.teacherCode) {
            report.alreadyHadCode++;
            report.details.push({
              teacherId,
              email,
              teacherCode: rechecked.teacherCode,
              status: "already_had_code",
            });
            assigned = true;
          }
        }
      } catch (err: any) {
        if (err.code === 11000) {
          // Collision on concurrent generation, retry with new code
          continue;
        }
        report.errors++;
        report.details.push({
          teacherId,
          email,
          teacherCode: "",
          status: "error",
          error: err.message,
        });
        if (shouldLog) {
          console.error(`❌ Error updating teacher ${teacherId}:`, err.message);
        }
        break;
      }
    }
  }

  if (shouldLog) {
    console.log("═══════════════════════════════════════════");
    console.log("📊 Teacher Code Migration Summary:");
    console.log(`   Total Teachers Checked : ${report.total}`);
    console.log(`   Already Had Valid Code : ${report.alreadyHadCode}`);
    console.log(`   Newly Updated With Code: ${report.updated}`);
    console.log(`   Errors                 : ${report.errors}`);
    console.log("═══════════════════════════════════════════");
  }

  return report;
}
