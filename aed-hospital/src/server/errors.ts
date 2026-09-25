/** Errors that map cleanly onto HTTP responses. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, "BAD_REQUEST", details);
export const unauthorized = (msg = "Please sign in") => new AppError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "You do not have permission to do this") => new AppError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new AppError(404, msg, "NOT_FOUND");
export const conflict = (msg: string, details?: unknown) => new AppError(409, msg, "CONFLICT", details);
export const dayLocked = (date: string) =>
  new AppError(423, `${date} is closed. Ask an Admin to reopen the day, or raise a correction request.`, "DAY_CLOSED", { date });
export const tooMany = (msg: string) => new AppError(429, msg, "RATE_LIMITED");
