export const colors = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#F59E0B',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  border: '#E2E8F0',
};

export const expenseTypes = [
  { value: 'shipping', label: 'ارسال بار', icon: 'airplane-outline' },
  { value: 'salary', label: 'حقوق', icon: 'wallet-outline' },
  { value: 'withdrawal', label: 'برداشت شخصی', icon: 'cash-outline' },
  { value: 'loan_given', label: 'قرض دادن', icon: 'arrow-up-outline' },
  { value: 'loan_received', label: 'قرض گرفتن', icon: 'arrow-down-outline' },
  { value: 'rent', label: 'اجاره', icon: 'home-outline' },
  { value: 'utilities', label: 'قبوض', icon: 'flash-outline' },
  { value: 'other', label: 'سایر', icon: 'ellipsis-horizontal-outline' },
];

export const paymentMethods = [
  { value: 'card', label: 'پوز / کارتخوان', color: 'primary' },
  { value: 'card_to_card', label: 'کارت به کارت', color: 'secondary' },
  { value: 'cash', label: 'نقد', color: 'success' },
  { value: 'credit', label: 'نسیه', color: 'warning' },
  { value: 'mixed', label: 'ترکیبی', color: 'tertiary' },
];
