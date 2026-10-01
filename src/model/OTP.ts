// models/OTP.ts
import mongoose, { Document, Schema, Types } from 'mongoose';

export type OTPPurpose = 'email_verification' | 'password_reset';

export interface IOTP extends Document {
  _id: Types.ObjectId;
  email: string;
  otp: string;
  purpose: OTPPurpose;
  expiresAt: Date;
  attempts: number;
  isUsed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const otpSchema = new Schema<IOTP>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['email_verification', 'password_reset'],
      default: 'email_verification',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index - auto delete when expired
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

otpSchema.index({ email: 1, purpose: 1 });

export default mongoose.model<IOTP>('OTP', otpSchema);