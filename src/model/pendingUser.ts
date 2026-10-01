// model/PendingUser.ts
import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import type { Gender } from './user';

export interface IPendingUser extends Document {
  _id: Types.ObjectId;
  name: string;
  username: string;
  email: string; 
  password: string;
  dob: Date;
  gender: Gender;
  cnic: string;
  phoneNo: string;
  designation: string;
  dateOfJoining: Date;
  address?: string;
  profileImage?: { url: string; publicId: string } | null;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidate: string): Promise<boolean>;
}

const pendingUserSchema = new Schema<IPendingUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,               // 👈 only here
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-z0-9._]+$/, 'Invalid username format'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,               // 👈 only here
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    dob: {
      type: Date,
      required: true,
      validate: {
        validator: (v: Date) => v < new Date(),
        message: 'DOB cannot be future',
      },
    },
    gender: { type: String, enum: ['male', 'female'], required: true },
    cnic: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{5}-\d{7}-\d{1}$/, 'Invalid CNIC'],
    },
    phoneNo: {
      type: String,
      required: true,
      match: [/^\+?\d{10,15}$/, 'Invalid phone number'],
    },
    designation: { type: String, required: true, trim: true, maxlength: 100 },
    dateOfJoining: {
      type: Date,
      required: true,
      validate: {
        validator: (v: Date) => v <= new Date(),
        message: 'DOJ cannot be future',
      },
    },
    address: { type: String, trim: true, maxlength: 250 },
    profileImage: {
      type: {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
      default: null,
    },
    isEmailVerified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        delete (ret as any).password;
        return ret;
      },
    },
  }
);

// ❌ REMOVED: pendingUserSchema.index({ email: 1 }, { unique: true });
// ❌ REMOVED: pendingUserSchema.index({ username: 1 }, { unique: true });
// (both duplicated by `unique: true` on the fields)

pendingUserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

pendingUserSchema.methods.comparePassword = function (candidate: string) {
  if (!this.password) throw new Error('Use .select("+password") first.');
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model<IPendingUser>('PendingUser', pendingUserSchema);