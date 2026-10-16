// model/Provider.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export type ProviderStatus = 'active' | 'inactive' | 'blacklisted';

export const PROVIDER_STATUSES: ProviderStatus[] = [
  'active', 'inactive', 'blacklisted',
];


export const SUGGESTED_PROVIDER_CATEGORIES = [
  'Water Bottles',
  'Tea Packs',
  'Snacks',
  'Network Fee',
  'Internet',
  'Electricity',
  'Gas',
  'Office Rent',
  'Cleaning',
  'Stationery',
  'Courier',
  'Maintenance',
  'Miscellaneous',
] as const;

export interface IBankDetails {
  bankName?: string;
  accountTitle?: string;
  accountNumber?: string;
  iban?: string;
}

export interface IProvider extends Document {
  _id: Types.ObjectId;

  name: string;
  category: string;              // free text
  contactPerson?: string;
  phoneNo?: string;
  email?: string;
  address?: string;
  cnic?: string;
  ntn?: string;

  bankDetails?: IBankDetails;
  paymentTerms?: string;

  status: ProviderStatus;
  notes?: string;

  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProviderModel extends Model<IProvider> {}

const bankDetailsSchema = new Schema<IBankDetails>(
  {
    bankName: { type: String, trim: true, maxlength: 100 },
    accountTitle: { type: String, trim: true, maxlength: 100 },
    accountNumber: { type: String, trim: true, maxlength: 40 },
    iban: { type: String, trim: true, maxlength: 40, uppercase: true },
  },
  { _id: false }
);

const providerSchema = new Schema<IProvider, IProviderModel>(
  {
    name: {
      type: String,
      required: [true, 'Provider name is required'],
      trim: true,
      minlength: 2,
      maxlength: 150,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      required: false,
      default: '',
      index: true,
    },

    contactPerson: { type: String, trim: true, maxlength: 100 },
    phoneNo: {
      type: String,
      trim: true,
      match: [/^\+?\d{10,15}$/, 'Invalid phone number'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email'],
    },
    address: { type: String, trim: true, maxlength: 300 },

    cnic: {
      type: String,
      trim: true,
      match: [/^\d{5}-\d{7}-\d{1}$/, 'CNIC must be 12345-1234567-1'],
    },
    ntn: { type: String, trim: true, maxlength: 30 },

    bankDetails: { type: bankDetailsSchema, default: undefined },
    paymentTerms: { type: String, trim: true, maxlength: 200 },

    status: {
      type: String,
      enum: PROVIDER_STATUSES,
      default: 'active',
      index: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

providerSchema.index({ name: 'text', contactPerson: 'text' });
providerSchema.index({ category: 1, status: 1, isDeleted: 1 });

const Provider =
  (mongoose.models.Provider as IProviderModel) ||
  mongoose.model<IProvider, IProviderModel>('Provider', providerSchema);

export default Provider;