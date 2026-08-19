import mongoose from 'mongoose';

export async function connectDatabase(uri: string) {
  await mongoose.connect(uri);
  console.log('MongoDB connected:', uri.replace(/\/\/.*@/, '//***@'));
}
