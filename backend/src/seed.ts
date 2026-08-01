import 'dotenv/config';
import { connectDatabase, getShopOpeningDate } from './config/database';
import {
  Category,
  ShopSettings,
  User,
  Product,
  hashPassword,
} from './models';
import { Session } from './models/Session';

const DEMO_USERS = [
  {
    username: 'admin',
    password: 'admin123',
    name: 'مدیر',
    role: 'admin' as const,
  },
  {
    username: 'marketer',
    password: 'marketer123',
    name: 'بازاریاب نمونه',
    role: 'marketer' as const,
  },
  {
    username: 'driver',
    password: 'driver123',
    name: 'راننده نمونه',
    role: 'driver' as const,
  },
];

async function upsertDemoUser(user: (typeof DEMO_USERS)[number]) {
  const username = user.username.toLowerCase();
  const passwordHash = hashPassword(user.password);

  await User.findOneAndUpdate(
    { username },
    {
      username,
      passwordHash,
      name: user.name,
      role: user.role,
      active: true,
      approvalStatus: 'approved',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Invalidate old sessions so a fresh login is required after seed
  await Session.deleteMany({ username });
}

async function seed() {
  await connectDatabase(process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop');

  const categories = [
    {
      name: 'قند',
      profitPercent: 12,
      profitRetail: 12,
      profitSupermarket: 8,
      profitWholesale: 5,
      description: 'قند فله و بسته‌بندی',
    },
    {
      name: 'قند ۳ کیلویی',
      profitPercent: 14,
      profitRetail: 14,
      profitSupermarket: 10,
      profitWholesale: 6,
      description: 'بسته ۳ کیلویی',
    },
    {
      name: 'قند ۵ کیلویی',
      profitPercent: 12,
      profitRetail: 12,
      profitSupermarket: 9,
      profitWholesale: 5,
      description: 'بسته ۵ کیلویی',
    },
    {
      name: 'قند ۱۰ کیلویی',
      profitPercent: 10,
      profitRetail: 10,
      profitSupermarket: 7,
      profitWholesale: 4,
      description: 'بسته ۱۰ کیلویی',
    },
    {
      name: 'سایر',
      profitPercent: 15,
      profitRetail: 15,
      profitSupermarket: 10,
      profitWholesale: 6,
      description: 'سایر کالاها',
    },
  ];

  for (const cat of categories) {
    await Category.findOneAndUpdate({ name: cat.name }, cat, { upsert: true, new: true });
  }

  const sugarCat = await Category.findOne({ name: 'قند' });
  const cat3 = await Category.findOne({ name: 'قند ۳ کیلویی' });
  const cat5 = await Category.findOne({ name: 'قند ۵ کیلویی' });
  const cat10 = await Category.findOne({ name: 'قند ۱۰ کیلویی' });

  const samples = [
    { name: 'قند ۳ کیلویی', kgPerPackage: 3, categoryId: cat3?._id || sugarCat?._id, avg: 45000 },
    { name: 'قند ۵ کیلویی', kgPerPackage: 5, categoryId: cat5?._id || sugarCat?._id, avg: 44000 },
    { name: 'قند ۱۰ کیلویی', kgPerPackage: 10, categoryId: cat10?._id || sugarCat?._id, avg: 43000 },
  ];

  for (const s of samples) {
    if (!s.categoryId) continue;
    const normalizedName = s.name.replace(/\s+/g, ' ').trim().toLowerCase();
    await Product.findOneAndUpdate(
      { normalizedName },
      {
        name: s.name,
        normalizedName,
        categoryId: s.categoryId,
        kgPerPackage: s.kgPerPackage,
        avgCostPerKg: s.avg,
        purchasePrice: s.avg,
        stockKg: 0,
        stock: 0,
      },
      { upsert: true }
    );
  }

  const existing = await ShopSettings.findOne();
  if (!existing) {
    await ShopSettings.create({
      shopName: 'مغازه آریو — قند',
      openingDate: getShopOpeningDate(),
      cashBalance: 0,
      cardBalance: 0,
    });
  } else {
    existing.shopName = existing.shopName || 'مغازه آریو — قند';
    await existing.save();
  }

  for (const user of DEMO_USERS) {
    await upsertDemoUser(user);
  }

  console.log('✅ Seed completed — demo users reset');
  console.log('   admin / admin123');
  console.log('   marketer / marketer123');
  console.log('   driver / driver123');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
