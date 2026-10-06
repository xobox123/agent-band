export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string): AppError => new AppError('not_found', 404, `${what} not found`);
export const forbidden = (reason: string): AppError => new AppError('forbidden', 403, reason);
export const conflict = (code: string, msg: string): AppError => new AppError(code, 409, msg);
export const invalid = (issues: unknown): AppError =>
  new AppError('validation_failed', 400, 'Request validation failed', issues);
