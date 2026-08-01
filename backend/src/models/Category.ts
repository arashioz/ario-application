import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  /** سازگاری — همان تکی */
  profitPercent: number;
  /** درصد سود فروش تکی */
  profitRetail: number;
  /** درصد سود سوپرمارکت */
  profitSupermarket: number;
  /** درصد سود عمده */
  profitWholesale: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    profitPercent: { type: Number, required: true, default: 15, min: 0, max: 1000 },
    profitRetail: { type: Number, required: true, default: 15, min: 0, max: 1000 },
    profitSupermarket: { type: Number, required: true, default: 10, min: 0, max: 1000 },
    profitWholesale: { type: Number, required: true, default: 6, min: 0, max: 1000 },
    description: { type: String },
  },
  { timestamps: true }
);

export const Category = mongoose.model<ICategory>('Category', CategorySchema);
