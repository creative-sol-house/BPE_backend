// model/User.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { deleteImage } from '../middleware/uploads';

export type Gender = 'male' | 'female';
export type PermissionAction = 'view' | 'add' | 'edit' | 'delete';
export type UserStatus = 'pending' | 'active' | 'blocked' | 'rejected';

// ─── Sub-documents ────────────────────────────────────────────────────────
export interface IProfileImage {
  url: string;
  publicId: string;
}

export interface IEmergencyContact {
  name: string;
  phoneNo: string;
  relation?: string;
}

export interface IUserPermission {
  module: string;
  actions: PermissionAction[];
}

// ─── User Document ────────────────────────────────────────────────────────
export interface IUser extends Document {
  _id: Types.ObjectId;

  name: string;
  username: string;
  email: string;
  password: string;

  role: Types.ObjectId | null;
  department: string;
  isMainAdmin: boolean;
  isActive: boolean;
  status: UserStatus;
  isEmailVerified: boolean;
  createdBy: Types.ObjectId | null;

  permissions: IUserPermission[];
  permissionMode: 'extend' | 'override' | 'replace';

  dob: Date;
  gender: Gender;
  cnic: string;
  phoneNo: string;
  profileImage?: IProfileImage | null;

  designation: string;
  dateOfJoining: Date;
  employeeId?: string;
  isEmployee: boolean;               // 👈 NEW

  address?: string;
  emergencyContact?: IEmergencyContact;
  lastLoginAt?: Date;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidate: string): Promise<boolean>;
  getEffectivePermissions(): Promise<IUserPermission[]>;
  can(module: string, action: PermissionAction): Promise<boolean>;
}

// ─── User Model (statics) ─────────────────────────────────────────────────
export interface IUserModel extends Model<IUser> {
  findByCredentials(identifier: string): Promise<IUser | null>;
}

// ─── Sub-Schemas ──────────────────────────────────────────────────────────
const profileImageSchema = new Schema<IProfileImage>(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const emergencyContactSchema = new Schema<IEmergencyContact>(
  {
    name: { type: String, trim: true },
    phoneNo: { type: String, trim: true },
    relation: { type: String, trim: true },
  },
  { _id: false }
);

const userPermissionSchema = new Schema<IUserPermission>(
  {
    module: {
      type: String,
      required: [true, 'Module name is required'],
      trim: true,
      lowercase: true,
    },
    actions: {
      type: [String],
      enum: ['view', 'add', 'edit', 'delete'],
      default: [],
      validate: {
        validator: (arr: string[]) => new Set(arr).size === arr.length,
        message: 'Duplicate actions are not allowed in a permission entry',
      },
    },
  },
  { _id: false }
);

// ─── User Schema ──────────────────────────────────────────────────────────
const userSchema = new Schema<IUser, IUserModel>(
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
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-z0-9._]+$/, 'Invalid username format'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
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

    role: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
    department: { type: String, trim: true, default: '' },
isMainAdmin: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'blocked', 'rejected'],
      default: 'pending',
    },
    isEmailVerified: { type: Boolean, default: false },

    permissions: { type: [userPermissionSchema], default: [] },
    permissionMode: {
      type: String,
      enum: ['extend', 'override', 'replace'],
      default: 'override',
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
    profileImage: { type: profileImageSchema, default: null },

    designation: { type: String, required: true, trim: true, maxlength: 100 },
    dateOfJoining: {
      type: Date,
      required: true,
      validate: {
        validator: (v: Date) => v <= new Date(),
        message: 'DOJ cannot be future',
      },
    },
    employeeId: { type: String, trim: true, sparse: true, unique: true },

    // 👇 NEW: defaults to true — every user is an employee unless told otherwise
    isEmployee: { type: Boolean, default: true },

    address: { type: String, trim: true, maxlength: 250 },
    emergencyContact: { type: emergencyContactSchema, default: undefined },
    lastLoginAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete (ret as any).password;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete (ret as any).password;
        return ret;
      },
    },
  }
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ department: 1, isActive: 1 });
userSchema.index({ isDeleted: 1 });
userSchema.index({ status: 1 });
userSchema.index({ 'permissions.module': 1 });

// ─── Hooks ────────────────────────────────────────────────────────────────
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  // Skip re-hashing if the password is already a bcrypt hash
  // (needed when transferring from PendingUser where it was already hashed)
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.pre('validate', function () {
  if (this.employeeId === '' || this.employeeId === null) this.employeeId = undefined;
});

userSchema.pre('save', async function () {
  if (!this.isModified('role') && !this.isModified('department')) return;
  if (!this.role) return;

  const Role = mongoose.model('Role');
  const roleDoc: any = await Role.findOne({
    _id: this.role,
    isDeleted: false,
    isActive: true,
  });
  if (!roleDoc) throw new Error('Referenced role does not exist or is inactive');

  const hasDept = roleDoc.departments.some(
    (d: any) => d.name.trim().toLowerCase() === this.department.trim().toLowerCase()
  );
  if (!hasDept) {
    throw new Error(
      `Department "${this.department}" is not defined inside role "${roleDoc.name}"`
    );
  }
});

userSchema.pre('save', async function () {
  if (!this.isModified('profileImage')) return;
  const oldImage = (this as any)._originalProfileImage as IProfileImage | null | undefined;
  const newPublicId = this.profileImage?.publicId;
  if (oldImage?.publicId && oldImage.publicId !== newPublicId) {
    try {
      await deleteImage(oldImage.publicId);
    } catch (err) {
      console.warn(`Failed to delete old image ${oldImage.publicId}:`, err);
    }
  }
});

userSchema.post('init', function (doc: any) {
  doc._originalProfileImage = doc.profileImage
    ? { url: doc.profileImage.url, publicId: doc.profileImage.publicId }
    : null;
});

userSchema.pre('findOneAndDelete', async function () {
  const doc = await this.model
    .findOne(this.getFilter())
    .select('profileImage _id');

  if (doc?.profileImage?.publicId) {
    try {
      await deleteImage(doc.profileImage.publicId);
    } catch (err) {
      console.warn('Failed to delete profile image:', err);
    }
  }

  // 👇 Remove linked employee record
  if (doc?._id) {
    try {
      const Employee = mongoose.model('Employee');
      await Employee.deleteOne({ user: doc._id });
    } catch (err) {
      console.warn('Failed to delete employee record:', err);
    }
  }
});

// ─── Keep Employee record in sync with User ───────────────────────────
userSchema.post('save', async function (doc) {
  try {
    const Employee = mongoose.model('Employee');

    // Not an employee → mark the record deleted (don't hard-delete, keeps history)
    if (doc.isDeleted || !doc.isEmployee) {
      await Employee.updateOne(
        { user: doc._id },
        { $set: { isDeleted: true, isActive: false } }
      );
      return;
    }

    const payload = {
      name: doc.name,
      email: doc.email,                           // 👈 MUST BE HERE
      phoneNo: doc.phoneNo,
      cnic: doc.cnic,
      designation: doc.designation,
      department: doc.department,
      dateOfJoining: doc.dateOfJoining,
      gender: doc.gender,
      dob: doc.dob,
      address: doc.address,
      profileImage: doc.profileImage ?? null,
      isActive: doc.isActive && doc.status === 'active',
      isDeleted: false,
    };

    const existing = await Employee.findOne({ user: doc._id });

    if (existing) {
      await Employee.updateOne({ _id: existing._id }, { $set: payload });
      return;
    }

    await new Employee({
      user: doc._id,
      ...payload,
    }).save();

  } catch (err) {
    console.error(`Employee sync failed for user ${doc._id}:`, err);
  }
});

// ─── Methods ──────────────────────────────────────────────────────────────
userSchema.methods.comparePassword = function (candidate: string) {
  if (!this.password) throw new Error('Use .select("+password") first.');
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.getEffectivePermissions = async function (): Promise<IUserPermission[]> {
  if (this.isMainAdmin) {
    return [{ module: '*', actions: ['view', 'add', 'edit', 'delete'] }];
  }

  let rolePerms: IUserPermission[] = [];

  // ── Handle both populated (object) and unpopulated (ObjectId) role ──
  if (this.role && this.department) {
    let roleDoc: any = this.role;

    // If role is just an ObjectId (not populated), fetch it
    if (!roleDoc.departments) {
      const Role = mongoose.model('Role');
      roleDoc = await Role.findById(roleDoc).lean();
    }

    if (roleDoc?.departments) {
      const dept = roleDoc.departments.find(
        (d: any) =>
          d.name.trim().toLowerCase() === this.department.trim().toLowerCase()
      );
      if (dept?.modules) {
        rolePerms = dept.modules.map((p: any) => ({
          module: String(p.module).toLowerCase(),
          actions: [...p.actions] as PermissionAction[],
        }));
      }
    }
  }

  const userPerms: IUserPermission[] = (this.permissions || []).map(
    (p: { module: string; actions: any }) => ({
      module: p.module.toLowerCase(),
      actions: [...p.actions] as PermissionAction[],
    })
  );

  const merge = (
    base: IUserPermission[],
    overlay: IUserPermission[],
    mode: 'union' | 'replace'
  ): IUserPermission[] => {
    const map = new Map<string, Set<PermissionAction>>();
    for (const p of base) map.set(p.module, new Set(p.actions));
    for (const p of overlay) {
      if (mode === 'replace') {
        map.set(p.module, new Set(p.actions));
      } else {
        const existing = map.get(p.module) ?? new Set<PermissionAction>();
        for (const a of p.actions) existing.add(a);
        map.set(p.module, existing);
      }
    }
    return [...map.entries()].map(([module, set]) => ({
      module,
      actions: [...set] as PermissionAction[],
    }));
  };

  switch (this.permissionMode) {
    case 'replace':
      return userPerms;
    case 'extend':
      return merge(rolePerms, userPerms, 'union');
    case 'override':
    default:
      return merge(rolePerms, userPerms, 'replace');
  }
};

userSchema.methods.can = async function (
  moduleName: string,
  action: PermissionAction
): Promise<boolean> {
  if (this.isMainAdmin) return true;
  if (!this.isActive) return false;
  if (this.status !== 'active') return false;

  const module = moduleName.toLowerCase();
  const perms = await this.getEffectivePermissions();

  const wild = perms.find((p: { module: string }) => p.module === '*');
  if (wild?.actions.includes(action)) return true;

  const entry = perms.find((p: { module: string }) => p.module === module);
  return !!entry && entry.actions.includes(action);
};

// ─── Statics ──────────────────────────────────────────────────────────────
userSchema.statics.findByCredentials = function (identifier: string) {
  return this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier.toLowerCase() },
    ],
    isDeleted: false,
  })
    .select('+password')
    .populate('role');
};

const User =
  (mongoose.models.User as IUserModel) ||
  mongoose.model<IUser, IUserModel>('User', userSchema);

export default User;