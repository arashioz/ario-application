import mongoose, { Schema, Document } from 'mongoose';

export interface IMutationLog extends Document {
  clientMutationId: string;
  type: string;
  userId?: string;
  result: unknown;
  createdAt: Date;
}

const MutationLogSchema = new Schema<IMutationLog>(
  {
    clientMutationId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    userId: { type: String },
    result: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const MutationLog = mongoose.model<IMutationLog>('MutationLog', MutationLogSchema);
