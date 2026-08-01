import mongoose, { Schema, Document } from 'mongoose';

export interface ISmsMessage extends Document {
  rawText: string;
  sender?: string;
  parsedType?: string;
  parsedAmount?: number;
  parsedData?: Record<string, unknown>;
  isProcessed: boolean;
  processedAction?: string;
  receivedAt: Date;
  createdAt: Date;
}

const SmsMessageSchema = new Schema<ISmsMessage>(
  {
    rawText: { type: String, required: true },
    sender: { type: String },
    parsedType: { type: String },
    parsedAmount: { type: Number },
    parsedData: { type: Schema.Types.Mixed },
    isProcessed: { type: Boolean, default: false },
    processedAction: { type: String },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

SmsMessageSchema.index({ receivedAt: -1 });

export const SmsMessage = mongoose.model<ISmsMessage>('SmsMessage', SmsMessageSchema);
