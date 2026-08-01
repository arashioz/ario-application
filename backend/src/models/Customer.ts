import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  totalCredit: number;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true, index: true },
    phone: { type: String, trim: true, index: true },
    address: { type: String, trim: true },
    lat: { type: Number },
    lng: { type: Number },
    notes: { type: String },
    totalCredit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CustomerSchema.index({ name: 'text', phone: 'text', address: 'text' });

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);
