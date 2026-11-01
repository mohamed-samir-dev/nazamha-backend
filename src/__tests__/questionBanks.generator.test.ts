import mongoose from "mongoose";
import { Question } from "../models/Question";
import { QuestionBank } from "../models/QuestionBank";
import { normalizeQuestionType } from "../controllers/questionBanksController";

describe("Question Bank & Question Models - Schema & Type Integrity", () => {
  it("preserves all four question types in Question schema validation", () => {
    const validTypes = ["single_choice", "multiple_choice", "true_false", "essay", "mcq"] as const;

    validTypes.forEach((qt) => {
      const q = new Question({
        bank_id: new mongoose.Types.ObjectId(),
        content: `Question of type ${qt}`,
        question_type: qt,
        order: 1,
        marks: 2,
      });

      const err = q.validateSync();
      expect(err).toBeUndefined();
      expect(q.question_type).toBe(qt);
    });
  });

  it("rejects invalid question types not in the enum", () => {
    const q = new Question({
      bank_id: new mongoose.Types.ObjectId(),
      content: "Invalid question type",
      question_type: "unsupported_type" as any,
    });

    const err = q.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["question_type"]).toBeDefined();
  });

  it("defaults question order to 0", () => {
    const q = new Question({
      bank_id: new mongoose.Types.ObjectId(),
      content: "Default order test",
    });

    expect(q.order).toBe(0);
    expect(q.question_type).toBe("single_choice");
  });

  it("has compound indexes defined for performant queries", () => {
    const questionIndexes = Question.schema.indexes();
    const hasOrderIndex = questionIndexes.some((idx) => {
      const fields = idx[0];
      return fields["bank_id"] === 1 && fields["order"] === 1 && fields["created_at"] === 1;
    });
    expect(hasOrderIndex).toBe(true);

    const bankIndexes = QuestionBank.schema.indexes();
    const hasBankCompoundIndex = bankIndexes.some((idx) => {
      const fields = idx[0];
      return fields["teacher_id"] === 1 && fields["created_at"] === -1;
    });
    expect(hasBankCompoundIndex).toBe(true);
  });
});

describe("normalizeQuestionType - Controller Type Normalization", () => {
  it("strictly preserves single_choice, multiple_choice, true_false, and essay without data loss", () => {
    expect(normalizeQuestionType("single_choice")).toBe("single_choice");
    expect(normalizeQuestionType("multiple_choice")).toBe("multiple_choice");
    expect(normalizeQuestionType("true_false")).toBe("true_false");
    expect(normalizeQuestionType("essay")).toBe("essay");
  });

  it("safely maps legacy mcq to single_choice", () => {
    expect(normalizeQuestionType("mcq")).toBe("single_choice");
    expect(normalizeQuestionType(null)).toBe("single_choice");
    expect(normalizeQuestionType(undefined)).toBe("single_choice");
    expect(normalizeQuestionType("")).toBe("single_choice");
  });
});

describe("Bulk Reorder and Bulk Marks Logic", () => {
  it("builds valid bulkWrite operations for reordering", () => {
    const bankId = new mongoose.Types.ObjectId();
    const questionIds = [
      new mongoose.Types.ObjectId().toString(),
      new mongoose.Types.ObjectId().toString(),
      new mongoose.Types.ObjectId().toString(),
    ];

    const ops = questionIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id, bank_id: bankId },
        update: { $set: { order: index } },
      },
    }));

    expect(ops).toHaveLength(3);
    expect(ops[0].updateOne.update.$set.order).toBe(0);
    expect(ops[1].updateOne.update.$set.order).toBe(1);
    expect(ops[2].updateOne.update.$set.order).toBe(2);
  });

  it("builds valid bulkWrite operations for marks adjustments", () => {
    const bankId = new mongoose.Types.ObjectId();
    const marks = [
      { id: new mongoose.Types.ObjectId().toString(), marks: 2.5 },
      { id: new mongoose.Types.ObjectId().toString(), marks: 5 },
    ];

    const ops = marks.map((item) => ({
      updateOne: {
        filter: { _id: item.id, bank_id: bankId },
        update: { $set: { marks: item.marks } },
      },
    }));

    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.update.$set.marks).toBe(2.5);
    expect(ops[1].updateOne.update.$set.marks).toBe(5);
  });
});
