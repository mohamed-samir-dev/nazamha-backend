import crypto from "crypto";
import mongoose from "mongoose";

/**
 * Character set for Teacher Code generation:
 * 32 unambiguous characters (excludes 0, O, 1, I).
 * Alphabet: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ
 */
export const TEACHER_CODE_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TEACHER_CODE_PREFIX = "NZM-";
export const TEACHER_CODE_LENGTH = 6;
export const TEACHER_CODE_REGEX = /^NZM-[2-9A-HJ-NP-Z]{6}$/;

/**
 * Generates a random raw Teacher Code in format NZM-XXXXXX
 * using cryptographically secure random bytes.
 */
export function generateRawTeacherCode(): string {
  const chars: string[] = [];
  const charsetLen = TEACHER_CODE_CHARSET.length;
  // Generate random bytes and map to charset
  const randomBytes = crypto.randomBytes(TEACHER_CODE_LENGTH);
  for (let i = 0; i < TEACHER_CODE_LENGTH; i++) {
    chars.push(TEACHER_CODE_CHARSET[randomBytes[i] % charsetLen]);
  }
  return `${TEACHER_CODE_PREFIX}${chars.join("")}`;
}

/**
 * Validates whether a given string is a valid Teacher Code format.
 */
export function isValidTeacherCode(code?: string | null): boolean {
  if (!code || typeof code !== "string") return false;
  return TEACHER_CODE_REGEX.test(code.trim().toUpperCase());
}

/**
 * Normalizes input for search / comparison:
 * - Trims whitespace
 * - Converts to uppercase
 * - If user enters only 6 characters without 'NZM-', prepends 'NZM-'
 */
export function normalizeTeacherCode(input?: string | null): string {
  if (!input || typeof input !== "string") return "";
  let cleaned = input.trim().toUpperCase();
  // If user omitted "NZM-" and entered 6 alphanumeric characters:
  if (/^[2-9A-HJ-NP-Z]{6}$/.test(cleaned)) {
    cleaned = `${TEACHER_CODE_PREFIX}${cleaned}`;
  }
  return cleaned;
}

/**
 * Generates a unique Teacher Code not currently present in the database.
 * Checks Teacher collection directly to ensure uniqueness across active and soft-deleted teachers.
 */
export async function generateUniqueTeacherCode(
  model?: mongoose.Model<any>,
  maxAttempts = 15
): Promise<string> {
  const targetModel = model || mongoose.model("Teacher");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = generateRawTeacherCode();
    // Query directly on collection to bypass soft-delete filter
    const existing = await targetModel.collection.findOne(
      { teacherCode: candidate },
      { projection: { _id: 1 } }
    );
    if (!existing) {
      return candidate;
    }
  }

  throw new Error(
    `Failed to generate a unique teacher code after ${maxAttempts} attempts.`
  );
}
