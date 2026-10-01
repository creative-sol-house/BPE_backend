// model/holiday.ts
import mongoose, { Document, Schema, Model } from 'mongoose';

export type HolidayPattern =
  | 'once'         // one specific date
  | 'weekly'       // same weekday every week
  | 'biweekly'     // same weekday every 2 weeks (from a start date)
  | 'monthly'      // same day-of-month every month
  | 'yearly';      // same month+day every year

export const HOLIDAY_PATTERNS: HolidayPattern[] = [
  'once',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
];

export interface IHoliday extends Document {
  _id: mongoose.Types.ObjectId;

  name: string;
  description?: string;

  pattern: HolidayPattern;

  /** For 'once' — the exact date (midnight UTC). */
  date?: Date;

  /** For weekly / biweekly — weekday 0-6 (0=Sun). */
  weekday?: number;

  /** For biweekly — anchor date so we can compute the 2-week cycle. */
  anchorDate?: Date;

  /** For monthly — day of month (1-31). */
  dayOfMonth?: number;

  /** For yearly — month (1-12) and day (1-31). */
  month?: number;
  day?: number;

  isActive: boolean;
  isDeleted: boolean;

  createdBy: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export interface IHolidayModel extends Model<IHoliday> {
  /** Does this holiday apply on the given date? */
  matchesDate(holiday: IHoliday, date: Date): boolean;
  /** All holidays matching a date. */
  forDate(date: Date): Promise<IHoliday[]>;
}

const holidaySchema = new Schema<IHoliday, IHolidayModel>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },

    pattern: {
      type: String,
      enum: HOLIDAY_PATTERNS,
      required: true,
    },

    date: { type: Date },
    weekday: { type: Number, min: 0, max: 6 },
    anchorDate: { type: Date },
    dayOfMonth: { type: Number, min: 1, max: 31 },
    month: { type: Number, min: 1, max: 12 },
    day: { type: Number, min: 1, max: 31 },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

holidaySchema.index({ isDeleted: 1, isActive: 1 });
holidaySchema.index({ pattern: 1 });

holidaySchema.statics.matchesDate = function (
  holiday: IHoliday,
  date: Date
): boolean {
  if (!holiday.isActive || holiday.isDeleted) return false;

  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  const day = d.getUTCDate();
  const dow = d.getUTCDay(); // 0-6

  switch (holiday.pattern) {
    case 'once': {
      if (!holiday.date) return false;
      const hd = new Date(holiday.date);
      return (
        hd.getUTCFullYear() === y &&
        hd.getUTCMonth() + 1 === m &&
        hd.getUTCDate() === day
      );
    }
    case 'weekly':
      return holiday.weekday === dow;

    case 'biweekly': {
      if (holiday.weekday !== dow) return false;
      if (!holiday.anchorDate) return false;
      const anchor = new Date(holiday.anchorDate);
      // align both to midnight UTC
      anchor.setUTCHours(0, 0, 0, 0);
      const target = new Date(d);
      target.setUTCHours(0, 0, 0, 0);
      const diffDays = Math.round(
        (target.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays < 0) return false;
      return diffDays % 14 === 0;
    }

    case 'monthly':
      return holiday.dayOfMonth === day;

    case 'yearly':
      return holiday.month === m && holiday.day === day;

    default:
      return false;
  }
};

holidaySchema.statics.forDate = async function (
  date: Date
): Promise<IHoliday[]> {
  const all = await this.find({ isDeleted: false, isActive: true });
  return all.filter((h) => (this as IHolidayModel).matchesDate(h, date));
};

const Holiday =
  (mongoose.models.Holiday as IHolidayModel) ||
  mongoose.model<IHoliday, IHolidayModel>('Holiday', holidaySchema);

export default Holiday;