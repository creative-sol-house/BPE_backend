// middleware/authorize.ts
import { RequestHandler } from 'express';
import { AuthRequest } from './auth';
import type { PermissionAction } from '../model/user';

/**
 * ─── Rule of thumb ────────────────────────────────────────────────────
 * `authorize()` answers ONE question only:
 *   "Is this user allowed to touch the <module> module at all?"
 *
 * It deliberately does NOT try to answer "which rows?" — that's a
 * data-scope concern handled by the controller via a resolver.
 *
 * This means: a user with `attendance:*` can call the attendance routes
 * even without `employees:read`, because the route's job is attendance —
 * not listing employees. The controller decides what employee data it
 * needs to return based on what the caller's permissions allow.
 * ──────────────────────────────────────────────────────────────────────
 */
export function authorize(
  module: string,
  action: PermissionAction
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res
          .status(401)
          .json({ success: false, message: 'Authentication required' });
        return;
      }

      // Main admin bypasses per-module checks entirely
      if (authReq.user.isMainAdmin) {
        next();
        return;
      }

      const allowed = await authReq.user.can(module, action);
      if (!allowed) {
        res.status(403).json({
          success: false,
          message: `Permission denied: cannot ${action} on ${module}`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Same idea, but grants access if ANY of the listed actions is allowed.
 * Use for "read OR write" style routes.
 */
export function authorizeAny(
  module: string,
  actions: PermissionAction[]
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res
          .status(401)
          .json({ success: false, message: 'Authentication required' });
        return;
      }

      if (authReq.user.isMainAdmin) {
        next();
        return;
      }

      for (const action of actions) {
        if (await authReq.user.can(module, action)) {
          next();
          return;
        }
      }

      res.status(403).json({
        success: false,
        message: `Permission denied on ${module}`,
      });
    } catch (err) {
      next(err);
    }
  };
}