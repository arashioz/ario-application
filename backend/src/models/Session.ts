import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from './User';

export interface ISession extends Document {
  token: string;
  userId: string;
  role: UserRole;
  name: string;
  username: string;
  exp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, required: true },
    name: { type: String, required: true },
    username: { type: String, required: true },
    exp: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

SessionSchema.index({ exp: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);
