# دیپلوی آریو (Docker + Nginx + SSL)

## ساده‌ترین روش: کپی فایل (پیشنهادی — بدون Git)

روی لپ‌تاپ:

```bash
chmod +x deploy/*.sh
./deploy/pack.sh
scp ario-deploy.tgz root@IP_SERVER:/root/
```

روی سرور:

```bash
cd /root && mkdir -p application && tar -xzf ario-deploy.tgz -C application
cd /root/application
# اگر docker-compose.yml اینجا نبود، برو داخل پوشه‌ای که آن فایل را دارد

chmod +x deploy/*.sh
./deploy/install-server.sh
```

باز کن: `https://IP/` → Proceed → ورود `admin` / `admin123`

---

## معماری

```
اینترنت ──► Nginx (:80/:443)
               ├── SPA (Ionic build)
               ├── /api  /uploads  /health  → backend:3001
               └── /ws (WebSocket)          → backend:3001
backend ──► MongoDB
```

## پیش‌نیاز

- Docker + Docker Compose v2
- روی سرور: پورت‌های `80` و `443` باز
- برای Let's Encrypt: دامنه که به IP سرور اشاره کند

## دیپلوی روی IP (بدون دامنه)

Let's Encrypt روی IP کار نمی‌کند. از گواهی خودامضا استفاده کن:

```bash
# در .env.prod:
DOMAIN=203.0.113.10          # IP سرور
SSL_MODE=selfsigned

chmod +x deploy/*.sh
./deploy/up.sh
```

بعد برو به: `https://IP/` — یک‌بار هشدار گواهی مرورگر را تأیید کن.  
(برای GPS موبایل HTTPS لازم است.)

اگر HTTPS نمی‌خواهی: `SSL_MODE=off` و آدرس `http://IP/`

> **CPU بدون AVX:** به‌جای `mongo:7` رسمی از `ghcr.io/fenio/mongodb-no-avx:7.0.28` استفاده می‌شود (MongoDB 7 بدون نیاز به AVX).
> اگر از نسخهٔ دیگر ارتقا می‌دهی، یک‌بار volume را پاک کن:
> ```bash
> docker compose --env-file .env.prod down
> docker volume rm $(docker volume ls -q | grep mongo)
> ./deploy/up.sh
> ```

## راه‌اندازی سریع (گواهی خودامضا)

```bash
cp .env.prod.example .env.prod
# در صورت نیاز DOMAIN و SSL_MODE را ویرایش کن

chmod +x deploy/*.sh
./deploy/up.sh
```

اپ روی `https://DOMAIN/` بالا می‌آید.  
ورود پیش‌فرض بعد از seed: `admin` / `admin123`

## SSL واقعی (Let's Encrypt)

```bash
# در .env.prod:
# DOMAIN=shop.example.com
# CERTBOT_EMAIL=you@example.com

./deploy/init-ssl.sh
```

تمدید گواهی (مثلاً cron روزانه):

```bash
0 3 * * * cd /path/to/project && docker compose -f docker-compose.prod.yml --env-file .env.prod --profile ssl run --rm certbot renew \
  && docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx nginx -s reload
```

## حالت‌های SSL_MODE

| مقدار | کاربرد |
|--------|--------|
| `selfsigned` | تست / IP / بدون دامنه |
| `letsencrypt` | پروداکشن با دامنه |
| `off` | فقط HTTP (بدون HTTPS) |

## دستورات مفید

```bash
# بالا / پایین
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# لاگ
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f nginx backend

# seed دوباره
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/seed.js

# وضعیت
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

## توسعه لوکال (فقط Mongo)

```bash
docker compose up -d   # mongodb روی 27017
npm run backend
npm run ionic
```

## نکات

- فرانت و API روی یک origin هستند؛ WebSocket از `wss://دامنه/ws` می‌رود.
- حجم‌ها: دیتابیس، آپلود عکس، گواهی‌ها persistent هستند.
- فایل `.env.prod` را commit نکن.
