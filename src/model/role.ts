// model/Role.ts
import mongoose, { Document, Schema, Types } from 'mongoose';
import type { PermissionAction } from './user';

export interface IRoleModule {
  module: string;
  actions: PermissionAction[];
}

export interface IRoleDepartment {
  name: string;
  modules: IRoleModule[];
}

export interface IRole extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  departments: IRoleDepartment[];
  isActive: boolean;
  isDeleted: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const roleModuleSchema = new Schema<IRoleModule>(
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
        message: 'Duplicate actions are not allowed',
      },
    },
  },
  { _id: false }
);

const roleDepartmentSchema = new Schema<IRoleDepartment>(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      trim: true,
    },
    modules: { type: [roleModuleSchema], default: [] },
  },
  { _id: false }
);

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
      unique: true,               // 👈 only here
      minlength: 2,
      maxlength: 50,
    },
    description: { type: String, trim: true, maxlength: 250 },
    departments: {
      type: [roleDepartmentSchema],
      default: [],
      validate: {
        validator: function (depts: IRoleDepartment[]) {
          const names = depts.map((d) => d.name.trim().toLowerCase());
          return new Set(names).size === names.length;
        },
        message: 'Duplicate department names are not allowed within a role',
      },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ❌ REMOVED: roleSchema.index({ name: 1 }, { unique: true });
// (duplicated by `unique: true` on the field)

roleSchema.index({ isDeleted: 1 });
roleSchema.index({ 'departments.name': 1 });

export default mongoose.model<IRole>('Role', roleSchema);