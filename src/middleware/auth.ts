// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt';
import User, { IUser } from '../model/user';

export interface AuthRequest extends Request {
  user?: IUser;
  jwtPayload?: JwtPayload;
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.',
      });
      return;
    }

    const payload = verifyAccessToken(token);

    const user = await User.findOne({
      _id: payload.userId,
      isDeleted: false,
    }).populate('role');

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, message: 'Account is deactivated' });
      return;
    }

    if (user.status !== 'active' && !user.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please wait for admin approval.`,
      });
      return;
    }

    req.user = user;
    req.jwtPayload = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

export function requireMainAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.isMainAdmin) {
    res.status(403).json({
      success: false,
      message: 'Main admin access required',
    });
    return;
  }
  next();
}