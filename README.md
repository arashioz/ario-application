# آریو — سیستم مدیریت مغازه

اپلیکیشن موبایل برای مدیریت خرید، فروش، هزینه‌ها، بدهکاران و داشبورد سود روزانه.
نسخه اصلی وب/موبایل با **Ionic React** و نسخه جایگزین با **Expo React Native**.

## معماری

```
Ionic React (Vite) / Expo RN  ──REST/WS──►  Node.js Backend  ──►  MongoDB
       │                                          │
       ├── چت‌بات LLM محلی + سرور               ├── Rule-based NLP / LLM
       ├── فرم‌های خرید/فروش/هزینه/نسیه         ├── SMS Parser
       └── واریز کارت‌خوان + گزارش دوره‌ای       └── Dashboard API
```

## قابلیت‌ها

- **فاکتور خرید** — محصولات تکراری خودکار ادغام می‌شوند
- **دسته‌بندی + درصد سود** — قیمت فروش خودکار محاسبه می‌شود
- **فاکتور فروش** — نقد / کارت / نسیه / ترکیبی
- **صندوق** — موجودی نقد و کارت
- **هزینه‌ها** — ارسال، حقوق، برداشت، قرض، ...
- **بدهکاران** — یادآوری سررسید و دریافت نسیه
- **داشبورد** — سود روزانه، فروش، واریز کارت‌خوان
- **چت‌بات** — فارسی، الگوریتم LLM محلی (scoring + entity extraction + حافظه) با fallback سرور
- **SMS** — پارس SMS بانکی + paste از کلیپبورد
- **داده تاریخی** — ثبت تراکنش از تاریخ باز شدن مغازه

## پیش‌نیازها

- Node.js 18+
- Docker (برای MongoDB)
- مرورگر / Capacitor یا Expo Go برای موبایل

## راه‌اندازی

### ۱. MongoDB

```bash
docker compose up -d
```

### ۲. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run seed    # دسته‌بندی‌های پیش‌فرض
npm run dev     # http://localhost:3001
```

### ۳. اپ Ionic (پیشنهادی)

```bash
cd mobile_ionic
npm install
npm run dev     # http://localhost:5173 — با --host برای گوشی
```

از ریشه پروژه:

```bash
npm run ionic
```

> **نکته:** IP سرور را در `mobile_ionic/src/api/client.ts` تنظیم کنید (یا `VITE_API_HOST`):
> ```ts
> const HOST = '192.168.x.x';
> ```

### ۴. اپ Expo (جایگزین)

```bash
cd mobile
npm install
npm start
```

> IP را در `mobile/src/api/client.ts` تنظیم کنید.
## API اصلی

| Method | Path | توضیح |
|--------|------|-------|
| GET | `/api/dashboard` | داشبورد امروز |
| POST | `/api/purchases` | فاکتور خرید |
| POST | `/api/sales` | فاکتور فروش |
| POST | `/api/expenses` | ثبت هزینه |
| POST | `/api/card-deposit` | واریز کارت‌خوان |
| GET | `/api/debtors` | لیست بدهکاران |
| POST | `/api/chat` | چت‌بات |
| POST | `/api/sms/parse` | پارس SMS |

## WebSocket

اتصال: `ws://localhost:3001/ws`

```json
{ "type": "dashboard" }
{ "type": "chat", "payload": { "message": "سود امروز" } }
```

## چت‌بات — نمونه دستورات

```
آیفون ۱۵ رو به علی ۴۰ میلیون نسیه فروختم
خرید ۱۰ تا کاور سامسونگ هر کدوم ۵۰ هزار
هزینه ارسال بار ۲۰۰ هزار
واریز کارتخوان ۵ میلیون
سود امروز چقدره؟
بدهکارام رو نشون بده
help
```

## دیپلوی (Docker + Nginx + SSL)

جزئیات کامل: [DEPLOY.md](./DEPLOY.md)

```bash
cp .env.prod.example .env.prod
chmod +x deploy/*.sh
./deploy/up.sh                 # self-signed SSL
# ./deploy/init-ssl.sh         # Let's Encrypt (دامنه واقعی)
```

سرویس‌ها: `mongodb` + `backend` + `nginx` (فرانت + پروکسی API/WS + SSL)

## ورود داده تاریخی

1. برو به **تاریخچه** → تاریخ باز شدن مغازه را تنظیم کن
2. در فرم‌های **خرید / فروش / هزینه** فیلد تاریخ را پر کن (مثلاً `2025-05-27`)
3. گزارش دوره‌ای را از همان تاریخ تا امروز ببین

## SMS اندروید

- فعلاً: paste SMS در چت‌بات (دکمه 📋)
- برای خواندن خودکار SMS: نیاز به `expo prebuild` + ماژول native دارد (در `smsParser.ts` آماده شده)

## ساختار پروژه

```
├── backend/                 # Node.js + Express + WS + MongoDB
├── mobile_ionic/            # Ionic React (Vite)
├── deploy/                  # Nginx templates + SSL scripts
├── docker-compose.yml       # Mongo لوکال
├── docker-compose.prod.yml  # دیپلوی کامل
└── DEPLOY.md
```

## متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `PORT` | 3001 | پورت سرور |
| `MONGODB_URI` | mongodb://localhost:27017/ario-shop | آدرس MongoDB |
| `SHOP_OPENING_DATE` | 2025-05-27 | تاریخ باز شدن مغازه |
