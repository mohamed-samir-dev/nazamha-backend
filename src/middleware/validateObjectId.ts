import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";

/**
 * يتحقق من صحة MongoDB ObjectId في req.params
 * الاستخدام: router.get("/:id", validateObjectId("id"), handler)
 */
export function validateObjectId(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const param of paramNames) {
      const val = req.params[param];
      if (val && !mongoose.Types.ObjectId.isValid(val)) {
        res.status(400).json({ message: `معرف غير صالح: ${param}` });
        return;
      }
    }
    next();
  };
}

/**
 * يتحقق من صحة ObjectId في أي string
 */
export function isValidObjectId(id: string | undefined | null): boolean {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id);
}
