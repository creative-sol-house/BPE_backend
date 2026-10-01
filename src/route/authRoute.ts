// route/authRoute.ts
import { Router } from 'express';
import * as authController from '../controller/authController';
import { authenticate } from '../middleware/auth';
import {
  authLimiter,
  authReadLimiter,
  otpResendLimiter,
  forgotPasswordLimiter,
} from '../middleware/rateLimit';

const router = Router();

// ─── Sensitive (strict limit) ─────────────────────────────────────────────
router.post('/register',        authLimiter, authController.register);
router.post('/verify-otp',      authLimiter, authController.verifyEmailOTP);
router.post('/login',           authLimiter, authController.login);
router.post('/reset-password',  authLimiter, authController.resetPassword);

// ─── Extra-strict (anti-spam) ─────────────────────────────────────────────
router.post('/resend-otp',       otpResendLimiter,     authController.resendOTP);
router.post('/forgot-password',  forgotPasswordLimiter, authController.forgotPassword);

// ─── Normal (looser) ──────────────────────────────────────────────────────
router.post('/refresh',  authReadLimiter, authController.refreshToken);
router.post('/logout', authReadLimiter, authenticate, authController.logout);
router.get('/me',        authReadLimiter, authenticate, authController.me);

export default router;