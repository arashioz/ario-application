import { ExpenseCategory } from '../models/ExpenseCategory';

const BUILTINS = [
  { name: 'ارسال بار', key: 'shipping', sortOrder: 1 },
  { name: 'حقوق', key: 'salary', sortOrder: 2 },
  { name: 'برداشت شخصی', key: 'withdrawal', sortOrder: 3 },
  { name: 'قرض دادن', key: 'loan_given', sortOrder: 4 },
  { name: 'قرض گرفتن', key: 'loan_received', sortOrder: 5 },
  { name: 'اجاره', key: 'rent', sortOrder: 6 },
  { name: 'قبوض', key: 'utilities', sortOrder: 7 },
  { name: 'سایر', key: 'other', sortOrder: 99 },
];

export async function ensureBuiltinExpenseCategories() {
  for (const b of BUILTINS) {
    await ExpenseCategory.findOneAndUpdate(
      { name: b.name },
      {
        name: b.name,
        isBuiltin: true,
        active: true,
        sortOrder: b.sortOrder,
        icon: b.key,
      },
      { upsert: true, new: true }
    );
  }
}

export async function listExpenseCategories() {
  await ensureBuiltinExpenseCategories();
  return ExpenseCategory.find({ active: true }).sort({ sortOrder: 1, name: 1 });
}

export async function createExpenseCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('نام دسته الزامی است');
  const existing = await ExpenseCategory.findOne({ name: trimmed });
  if (existing) {
    existing.active = true;
    await existing.save();
    return existing;
  }
  return ExpenseCategory.create({
    name: trimmed,
    active: true,
    isBuiltin: false,
    sortOrder: 50,
  });
}

export async function deleteExpenseCategory(id: string) {
  const cat = await ExpenseCategory.findById(id);
  if (!cat) throw new Error('دسته یافت نشد');
  if (cat.isBuiltin) throw new Error('دسته‌های پیش‌فرض را نمی‌توان حذف کرد');
  cat.active = false;
  await cat.save();
  return { ok: true };
}

/** نگاشت نام/کلید به type ذخیره‌شده در Expense */
export function resolveExpenseTypeKey(input: string): string {
  const hit = BUILTINS.find((b) => b.key === input || b.name === input);
  return hit?.key || input;
}
