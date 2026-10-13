import mongoose from "mongoose";
import { createHash } from "crypto";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { WriteReceipt } from "../models/WriteReceipt";

// All model calls in the handler inherit this transaction unless they explicitly
// supply a session. Sequential queries are required inside a Mongo transaction.
mongoose.set("transactionAsyncLocalStorage", true);

export function atomicController(handler: (req: AuthRequest, res: Response) => Promise<void>) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    let code = 200;
    let body: unknown;
    let ended = false;
    const key = req.headers?.["idempotency-key"];
    if (key && (typeof key !== "string" || key.length > 128)) {
      res.status(400).json({ message: "مفتاح العملية غير صالح" });
      return;
    }
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const receiptId = key ? hash([req.user?.actor_id || req.user?.id, req.user?.id, req.method, req.originalUrl, key].join(":")) : null;
    const bodyHash = hash(JSON.stringify(req.body || {}));
    // Do not send a success response until MongoDB has committed every write.
    const pending = {
      status(value: number) { code = value; return this; },
      json(value: unknown) { body = value; return this; },
      end() { ended = true; return this; },
      get headersSent() { return false; },
    } as unknown as Response;
    const rollback = new Error("rollback response");
    const replay = async () => {
      if (!receiptId) return false;
      const old = await WriteReceipt.findById(receiptId).lean();
      if (!old) return false;
      if (old.body_hash !== bodyHash) {
        code = 409;
        body = { message: "مفتاح العملية مستخدم لبيانات مختلفة" };
      } else {
        code = old.status!;
        body = old.response;
        ended = code === 204;
      }
      return true;
    };
    const respond = () => { if (ended) res.status(code).end(); else res.status(code).json(body); };
    if (await replay()) { respond(); return; }
    try {
      await mongoose.connection.transaction(async () => {
        code = 200; body = undefined; ended = false;
        if (receiptId) await WriteReceipt.create({ _id: receiptId, body_hash: bodyHash, expires_at: new Date(Date.now() + 86_400_000) });
        await handler(req, pending);
        if (code >= 400) throw rollback;
        if (receiptId) await WriteReceipt.updateOne({ _id: receiptId }, { $set: { status: code, response: body } });
      });
    } catch (error: any) {
      if (error !== rollback && !(error.code === 11000 && await replay())) throw error;
    }
    respond();
  };
}

export async function series(queries: PromiseLike<any>[]): Promise<any[]> {
  const values: any[] = [];
  for (const query of queries) values.push(await query);
  return values;
}
