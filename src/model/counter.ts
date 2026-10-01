// model/Counter.ts
import mongoose, { Schema, Model } from 'mongoose';

export interface ICounter {
  _id: string;
  seq: number;
}

export interface ICounterModel extends Model<ICounter> {
  next(key: string): Promise<number>;
}

const counterSchema = new Schema<ICounter, ICounterModel>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { _id: false }
);

counterSchema.statics.next = async function (
  this: ICounterModel,
  key: string
): Promise<number> {
  const doc = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!doc) throw new Error(`Failed to increment counter "${key}"`);
  return doc.seq;
};

const Counter = mongoose.model<ICounter, ICounterModel>('Counter', counterSchema);

export default Counter;