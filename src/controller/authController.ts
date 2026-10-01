// controllers/authController.ts
import { Response } from 'express';
import User from '../model/user';
import PendingUser from '../model/pendingUser';
import OTP from '../model/OTP';

import { AuthRequest } from '../middleware/auth';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { generateOTP, getOTPExpiry } from '../utils/otp';
import { sendOTPEmail, sendPasswordResetOTPEmail } from '../services/emailService';

// ─── Registration ─────────────────────────────────────────────────────────


// ─── Forgot Password ──────────────────────────────────────────────────────
export async function forgotPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required' });
      return;
    }

    const normalized = String(email).trim().toLowerCase();

    // ── 1. Check if user is still pending (awaiting admin approval) ───────
    const pending = await PendingUser.findOne({ email: normalized });

    if (pending) {
      // If they haven't even verified their email yet, they can't reset a password
      if (!pending.isEmailVerified) {
        res.status(403).json({
          success: false,
          message: 'Please verify your email first. Check your inbox for the OTP.',
          code: 'EMAIL_NOT_VERIFIED',
          email: pending.email,
        });
        return;
      }

      // Email verified but admin hasn't approved yet
      res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. You cannot reset your password yet.',
        code: 'PENDING_APPROVAL',
        email: pending.email,
      });
      return;
    }

    // ── 2. Check if user exists in the active User collection ─────────────
    const user = await User.findOne({
      email: normalized,
      isDeleted: false,
    });

    if (!user) {
      // Not in pending, not in users → truly no account
      res.status(404).json({
        success: false,
        message: 'No account found with this email address.',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    // ── 3. Block / inactive checks ────────────────────────────────────────
    if (user.status === 'blocked' || !user.isActive) {
      res.status(403).json({
        success: false,
        message: 'Your account is blocked. Contact administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
      return;
    }

    if (user.status === 'rejected') {
      res.status(403).json({
        success: false,
        message: 'Your registration was rejected. Contact administrator.',
        code: 'ACCOUNT_REJECTED',
      });
      return;
    }

    if (user.status === 'pending') {
      // Rare: record exists in User but still pending
      res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval.',
        code: 'PENDING_APPROVAL',
        email: user.email,
      });
      return;
    }

    // ── 4. Generate & send reset OTP ──────────────────────────────────────
    const otp = generateOTP();
    await OTP.deleteMany({
      email: normalized,
      purpose: 'password_reset',
    });
    await OTP.create({
      email: normalized,
      otp,
      purpose: 'password_reset',
      expiresAt: getOTPExpiry(10),
    });

    await sendPasswordResetOTPEmail(normalized, otp, user.name);

    res.json({
      success: true,
      message: 'Reset code sent to your email.',
      data: {
        email: user.email,
        next: 'reset-password',
      },
    });
  } catch (err: any) {
    console.error('forgotPassword error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to process request',
    });
  }
}


// ─── Reset Password ───────────────────────────────────────────────────────
export async function resetPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Email, OTP, and newPassword are required',
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
      return;
    }

    const otpDoc = await OTP.findOne({
      email: email.toLowerCase(),
      purpose: 'password_reset',
      isUsed: false,
    });

    if (!otpDoc) {
      res.status(400).json({
        success: false,
        message: 'Reset code not found or already used',
      });
      return;
    }

    if (otpDoc.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpDoc._id });
      res.status(400).json({
        success: false,
        message: 'Reset code has expired. Please request a new one.',
      });
      return;
    }

    if (otpDoc.attempts >= 5) {
      await OTP.deleteOne({ _id: otpDoc._id });
      res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
      });
      return;
    }

    if (otpDoc.otp !== otp) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      res.status(400).json({
        success: false,
        message: `Invalid code. ${5 - otpDoc.attempts} attempts remaining.`,
      });
      return;
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      isDeleted: false,
    }).select('+password');

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // Assign plaintext — the User schema's pre-save hook will bcrypt it
    user.password = newPassword;
    await user.save();

    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();

    res.json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (err: any) {
    console.error('resetPassword error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Password reset failed',
    });
  }
}


export async function register(req: AuthRequest, res: Response) {  console.log('🚀 [register] START');
  try {
    console.log('🚀 [register] inside try');
    const {
      name,
      username,
      email,
      password,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      address,
      profileImage,
    } = req.body;

    // Check if email/username already exists in User or PendingUser
    const [existingUser, existingPending] = await Promise.all([
      User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] }),
      PendingUser.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] }),
    ]);

    if (existingUser || existingPending) {
      return res.status(409).json({
        success: false,
        message: 'Email or username already registered',
      });
    }

    // Create pending user
    const pending = await PendingUser.create({
      name,
      username,
      email,
      password,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      address,
      profileImage: profileImage || null,
    });

    // Generate OTP
    const otp = generateOTP();
    await OTP.deleteMany({ email: email.toLowerCase(), purpose: 'email_verification' });
    await OTP.create({
      email: email.toLowerCase(),
      otp,
      purpose: 'email_verification',
      expiresAt: getOTPExpiry(10),
    });

    // Send OTP email
    await sendOTPEmail(email, otp, name);

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for OTP verification.',
      data: {
        userId: pending._id,
        email: pending.email,
      },
    });
  } catch (err: any) {
console.error('🚨 [register] CATCH HIT');
  console.error('   message:', err.message);
  console.error('   stack:', err.stack);
 return res.status(500).json({
      success: false,
      message: err.message || 'Registration failed',
    });
  }
}

// ─── Verify Email OTP ─────────────────────────────────────────────────────
export async function verifyEmailOTP(req: AuthRequest, res: Response) {
  try {
    const { email, otp } = req.body;

    const otpDoc = await OTP.findOne({
      email: email.toLowerCase(),
      purpose: 'email_verification',
      isUsed: false,
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or already used',
      });
    }

    if (otpDoc.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.',
      });
    }

    if (otpDoc.attempts >= 5) {
      await OTP.deleteOne({ _id: otpDoc._id });
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.',
      });
    }

    if (otpDoc.otp !== otp) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${5 - otpDoc.attempts} attempts remaining.`,
      });
    }

    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();

    // Update pending user
    const pending = await PendingUser.findOneAndUpdate(
      { email: email.toLowerCase() },
      { isEmailVerified: true },
      { new: true }
    );

    if (!pending) {
      return res.status(404).json({
        success: false,
        message: 'Pending registration not found',
      });
    }

    return res.json({
      success: true,
      message: 'Email verified successfully. Please wait for admin approval.',
      data: {
        email: pending.email,
        status: 'pending_approval',
      },
    });
  } catch (err: any) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Verification failed',
    });
  }
}

// ─── Resend OTP ───────────────────────────────────────────────────────────
export async function resendOTP(req: AuthRequest, res: Response) {
  try {
    const { email } = req.body;

    const pending = await PendingUser.findOne({ email: email.toLowerCase() });
    if (!pending) {
      return res.status(404).json({
        success: false,
        message: 'No pending registration found for this email',
      });
    }

    if (pending.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified. Please wait for admin approval.',
      });
    }

    const otp = generateOTP();
    await OTP.deleteMany({ email: email.toLowerCase(), purpose: 'email_verification' });
    await OTP.create({
      email: email.toLowerCase(),
      otp,
      purpose: 'email_verification',
      expiresAt: getOTPExpiry(10),
    });

    await sendOTPEmail(email, otp, pending.name);

    return res.json({
      success: true,
      message: 'OTP resent successfully',
    });
  } catch (err: any) {
    console.error('Resend OTP error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to resend OTP',
    });
  }
}

// ─── Login ────────────────────────────────────────────────────────────────
export async function login(req: AuthRequest, res: Response) {
  try {
    const { identifier, password } = req.body; // identifier = email or username

    const normalized = String(identifier || '').trim().toLowerCase();

    // ── 1. First check pending registrations ─────────────────────────────
    const pending = await PendingUser.findOne({
      $or: [{ email: normalized }, { username: normalized }],
    }).select('+password');

    if (pending) {
      // If they're in pending but NOT verified yet → tell them to verify email
      if (!pending.isEmailVerified) {
        return res.status(403).json({
          success: false,
          message: 'Please verify your email first. Check your inbox for the OTP.',
          code: 'EMAIL_NOT_VERIFIED',
          email: pending.email, // frontend uses this to redirect to /verify-otp
        });
      }

      // Email verified but admin hasn't approved yet
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval.',
        code: 'PENDING_APPROVAL',
      });
    }

    // ── 2. Otherwise check the real User collection ──────────────────────
    const user = await User.findByCredentials(identifier);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // ── 3. Status checks for real users ──────────────────────────────────
    if (user.status === 'blocked') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Contact administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your registration was rejected.',
        code: 'ACCOUNT_REJECTED',
      });
    }

    if (user.status === 'pending') {
      // Rare: user record exists but still pending
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval.',
        code: 'PENDING_APPROVAL',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // ── 4. Success ───────────────────────────────────────────────────────
    user.lastLoginAt = new Date();
    await user.save();

    // ── 5. Auto-mark today's arrival ─────────────────────────────────────
    // Never throws — if the employee isn't linked or something fails, the
    // service logs the error and returns silently so login still succeeds.
    try {
      const { markArrival } = await import('../services/attendanceAutoService');
      await markArrival(user);
    } catch (attErr) {
      console.error('login markArrival failed (non-fatal):', attErr);
    }

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      isMainAdmin: user.isMainAdmin,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        accessToken,
        refreshToken,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Login failed',
    });
  }
}

// ─── Refresh Token ────────────────────────────────────────────────────────
export async function refreshToken(req: AuthRequest, res: Response) {
  try {
    let token = req.cookies?.refreshToken;
    if (!token && req.body?.refreshToken) {
      token = req.body.refreshToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.userId);

    if (!user || !user.isActive || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    const newPayload = {
      userId: user._id.toString(),
      email: user.email,
      isMainAdmin: user.isMainAdmin,
    };

    const accessToken = signAccessToken(newPayload);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });

    return res.json({
      success: true,
      data: { accessToken },
    });
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token',
    });
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────
export async function logout(req: AuthRequest, res: Response) {
  // ── Auto-mark today's departure ───────────────────────────────────────
  // Only runs if req.user is populated (requires `authenticate`
  // middleware on the /logout route).
  try {
    if (req.user) {
      const { markDeparture } = await import('../services/attendanceAutoService');
      await markDeparture(req.user);
    }
  } catch (err) {
    console.error('logout markDeparture failed (non-fatal):', err);
  }

  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  return res.json({ success: true, message: 'Logged out successfully' });
}

// ─── Get Current User ─────────────────────────────────────────────────────
export async function me(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const effectivePerms = await req.user.getEffectivePermissions();

    return res.json({
      success: true,
      data: {
        user: req.user.toJSON(),
        effectivePermissions: effectivePerms,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch user',
    });
  }
}