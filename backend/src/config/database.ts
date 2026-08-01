import mongoose from 'mongoose';

export async function connectDatabase(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('✅ MongoDB connected');
}

export function getShopOpeningDate(): Date {
  const raw = process.env.SHOP_OPENING_DATE || '2025-05-27';
  return new Date(raw);
}
