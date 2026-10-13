/**
 * asyncHandler — wraps async Express route handlers so that any
 * unhandled Promise rejection is forwarded to the centralized
 * errorHandler instead of becoming an unhandledRejection that
 * can crash the Node.js process.
 *
 * Usage in routes:
 *   router.get("/", asyncHandler(myController));
 *
 * Or wrap the entire router at once using wrapRouter().
 */

import { Request, Response, NextFunction, RequestHandler, Router } from "express";

type AsyncHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction
) => Promise<void> | void;

export function asyncHandler<Req extends Request = Request>(
  fn: AsyncHandler<Req>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
