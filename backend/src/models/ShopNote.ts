import mongoose, { Schema, Document, Types } from 'mongoose';

export type NoteColor = 'yellow' | 'mint' | 'peach' | 'sky' | 'lavender';

export interface IShopNote extends Document {
  text: string;
  done: boolean;
  color: NoteColor;
  sortOrder: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ShopNoteSchema = new Schema<IShopNote>(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    done: { type: Boolean, default: false, index: true },
    color: {
      type: String,
      enum: ['yellow', 'mint', 'peach', 'sky', 'lavender'],
      default: 'yellow',
    },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ShopNoteSchema.index({ done: 1, sortOrder: 1, createdAt: -1 });

export const ShopNote = mongoose.model<IShopNote>('ShopNote', ShopNoteSchema);
