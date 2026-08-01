import { randomBytes } from 'crypto';
import { User, hashPassword, UserRole } from '../models';
import { Session } from '../models/Session';

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
