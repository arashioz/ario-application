export type UserRole = 'admin' | 'marketer' | 'driver';

export interface SessionUser {
  userId: string;
  phone: string;
  name: string;
  role: UserRole;
  sessionId: string;
}
