import { ShopNote, NoteColor } from '../models/ShopNote';

const COLORS: NoteColor[] = ['yellow', 'mint', 'peach', 'sky', 'lavender'];

function pickColor(seed?: number): NoteColor {
  const i = typeof seed === 'number' ? seed : Date.now();
  return COLORS[Math.abs(i) % COLORS.length];
}

function serialize(n: InstanceType<typeof ShopNote>) {
  return {
    id: n._id.toString(),
    text: n.text,
    done: !!n.done,
    color: n.color || 'yellow',
    sortOrder: n.sortOrder || 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export async function listShopNotes(opts?: { includeDone?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (!opts?.includeDone) filter.done = false;
  const rows = await ShopNote.find(filter).sort({ done: 1, sortOrder: 1, createdAt: -1 }).limit(40);
  return rows.map(serialize);
}

export async function createShopNote(data: {
  text: string;
  color?: NoteColor;
  createdBy?: string;
}) {
  const text = String(data.text || '').trim();
  if (!text) throw new Error('متن یادداشت الزامی است');
  if (text.length > 500) throw new Error('یادداشت خیلی بلند است');
  const openCount = await ShopNote.countDocuments({ done: false });
  const note = await ShopNote.create({
    text,
    done: false,
    color: data.color && COLORS.includes(data.color) ? data.color : pickColor(openCount),
    sortOrder: openCount,
    createdBy: data.createdBy || undefined,
  });
  return serialize(note);
}

export async function updateShopNote(
  id: string,
  data: { text?: string; done?: boolean; color?: NoteColor }
) {
  const note = await ShopNote.findById(id);
  if (!note) throw new Error('یادداشت یافت نشد');
  if (data.text !== undefined) {
    const text = String(data.text).trim();
    if (!text) throw new Error('متن یادداشت الزامی است');
    note.text = text;
  }
  if (data.done !== undefined) note.done = !!data.done;
  if (data.color && COLORS.includes(data.color)) note.color = data.color;
  await note.save();
  return serialize(note);
}

export async function toggleShopNote(id: string) {
  const note = await ShopNote.findById(id);
  if (!note) throw new Error('یادداشت یافت نشد');
  note.done = !note.done;
  await note.save();
  return serialize(note);
}

export async function deleteShopNote(id: string) {
  const note = await ShopNote.findByIdAndDelete(id);
  if (!note) throw new Error('یادداشت یافت نشد');
  return { ok: true, id };
}
