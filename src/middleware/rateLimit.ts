// middleware/rateLimit.ts
import rateLimit from 'express-rate-limit';

/**
 * Strict limiter for sensitive endpoints:
 * login, register, verify-otp, resend-otp, forgot-password, reset-password
 *
 * 10 requests per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,     // send RateLimit-* headers
  legacyHeaders: false,      // disable X-RateLimit-* headers
  message: {
    success: false,
    message: 'Too many requests. Please try again in 15 minutes.',
  },
  // Skip successful requests (only count failures)
  // Uncomment the line below if you want "10 failed attempts per 15 min"
  // skipSuccessfulRequests: true,
});

/**
 * Looser limiter for endpoints that get hit repeatedly during normal use:
 * refresh, me, logout.
 *
 * 60 requests per 15 minutes per IP.
 */
export const authReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

/**
 * Very strict limiter for the OTP re-send endpoint.
 * Prevents users from hammering "resend OTP" to spam their inbox.
 *
 * 3 requests per 15 minutes per IP.
 */
export const otpResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many OTP requests. Please wait 15 minutes before requesting again.',
  },
});

/**
 * Very strict limiter for forgot-password.
 * Prevents attackers from flooding a user's inbox.
 *
 * 3 requests per 15 minutes per IP.
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset requests. Please wait 15 minutes.',
  },
});