// middleware/authorize.ts
import {RequestHandler } from 'express';
import { AuthRequest } from './auth';
import type { PermissionAction } from '../model/user';

export function authorize(module: string, action: PermissionAction): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ success: false, message: 'Authentication required' });
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

export function authorizeAny(module: string, actions: PermissionAction[]): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ success: false, message: 'Authentication required' });
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