import { randomBytes } from 'crypto';
import { User, hashPassword, UserRole } from '../models';
import { Session } from '../models/Session';
import { getOrCreateSettings } from './productService';

const memory = new Map<string, { userId: string; role: UserRole; name: string; username: string; exp: number }>();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionData = { userId: string; role: UserRole; name: string; username: string; exp: number };

export async function login(username: string, password: string) {
  const user = await User.findOne({ username: username.trim().toLowerCase() });
  if (!user || !user.verifyPassword(password)) {
    throw new Error('نام کاربری یا رمز عبور اشتباه است');
  }
  if (user.approvalStatus === 'pending') {
    throw new Error('حساب شما منتظر تأیید مدیر است');
  }
  if (user.approvalStatus === 'rejected') {
    throw new Error('ثبت‌نام شما رد شده — با پشتیبانی تماس بگیرید');
  }
  if (!user.active) {
    throw new Error('حساب غیرفعال است');
  }
  const settings = await getOrCreateSettings();
  if (user.role === 'driver' && settings.driverPanelEnabled === false) {
    throw new Error('پنل راننده فعلاً غیرفعال است');
  }
  if (user.role === 'marketer' && settings.marketerPanelEnabled === false) {
    throw new Error('پنل بازاریاب فعلاً غیرفعال است');
  }
  const token = randomBytes(32).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  const data: SessionData = {
    userId: user._id.toString(),
    role: user.role,
    name: user.name,
    username: user.username,
    exp,
  };
  memory.set(token, data);
  await Session.findOneAndUpdate(
    { token },
    {
      token,
      userId: data.userId,
      role: data.role,
      name: data.name,
      username: data.username,
      exp: new Date(exp),
    },
    { upsert: true, new: true }
  );
  return {
    token,
    user: {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role,
      city: user.city,
      approvalStatus: user.approvalStatus,
    },
  };
}

export async function getSession(token?: string): Promise<SessionData | null> {
  if (!token) return null;
  const cached = memory.get(token);
  if (cached) {
    if (cached.exp < Date.now()) {
      memory.delete(token);
      await Session.deleteOne({ token }).catch(() => undefined);
      return null;
    }
    return cached;
  }
  const row = await Session.findOne({ token });
  if (!row) return null;
  if (row.exp.getTime() < Date.now()) {
    await Session.deleteOne({ token }).catch(() => undefined);
    return null;
  }
  const data: SessionData = {
    userId: row.userId,
    role: row.role,
    name: row.name,
    username: row.username,
    exp: row.exp.getTime(),
  };
  memory.set(token, data);
  return data;
}

export async function logout(token: string) {
  memory.delete(token);
  await Session.deleteOne({ token }).catch(() => undefined);
}

export async function changeOwnCredentials(
  userId: string,
  data: {
    currentPassword: string;
    newPassword?: string;
    newUsername?: string;
    newName?: string;
  }
) {
  const user = await User.findById(userId);
  if (!user) throw new Error('کاربر یافت نشد');
  if (!user.verifyPassword(data.currentPassword)) {
    throw new Error('رمز فعلی اشتباه است');
  }
  if (data.newUsername?.trim()) {
    const u = data.newUsername.trim().toLowerCase();
    const clash = await User.findOne({ username: u, _id: { $ne: userId } }).select('_id');
    if (clash) throw new Error('این نام کاربری قبلاً ثبت شده');
    user.username = u;
  }
  if (data.newName?.trim()) user.name = data.newName.trim();
  if (data.newPassword) {
    if (data.newPassword.length < 4) throw new Error('رمز جدید حداقل ۴ کاراکتر');
    user.passwordHash = hashPassword(data.newPassword);
  }
  await user.save();
  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export async function adminSetUserCredentials(
  adminId: string,
  data: {
    userId: string;
    password?: string;
    username?: string;
    name?: string;
    adminPassword: string;
  }
) {
  const admin = await User.findById(adminId);
  if (!admin || admin.role !== 'admin') throw new Error('فقط مدیر');
  if (!admin.verifyPassword(data.adminPassword)) {
    throw new Error('رمز مدیر اشتباه است');
  }
  const user = await User.findById(data.userId);
  if (!user) throw new Error('کاربر یافت نشد');
  if (data.username?.trim()) {
    const u = data.username.trim().toLowerCase();
    const clash = await User.findOne({ username: u, _id: { $ne: data.userId } }).select('_id');
    if (clash) throw new Error('این نام کاربری قبلاً ثبت شده');
    user.username = u;
  }
  if (data.name?.trim()) user.name = data.name.trim();
  if (data.password) {
    if (data.password.length < 4) throw new Error('رمز حداقل ۴ کاراکتر');
    user.passwordHash = hashPassword(data.password);
  }
  await user.save();
  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export async function createUser(data: {
  username: string;
  password: string;
  name: string;
  role: UserRole;
}) {
  return User.create({
    username: data.username.trim().toLowerCase(),
    passwordHash: hashPassword(data.password),
    name: data.name,
    role: data.role,
    active: true,
    approvalStatus: 'approved',
  });
}

export async function listUsers() {
  return User.find().select('-passwordHash').sort({ name: 1 });
}

export async function listMarketers() {
  return User.find({ role: 'marketer', active: true }).select('-passwordHash').sort({ name: 1 });
}

export async function listDriversAuth() {
  return User.find({ role: 'driver', active: true }).select('-passwordHash').sort({ name: 1 });
}
