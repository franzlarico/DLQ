export {};

declare global {
  namespace Express {
    interface Request {
      tenantConfig?: Record<string, string>;
    }
  }
}