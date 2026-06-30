# План: Профиль пользователя

## Обзор архитектуры

```
┌─────────────────────────────────────────────────────────────┐
│  React Frontend (packages/frontend)                          │
│  - ProfileButton (правый верхний угол)                       │
│  - ProfileDropdown (меню по клику)                           │
│  - RegisterModal / LoginModal                                │
│  - useAuth hook (JWT в localStorage)                         │
└───────────┬──────────────────┬──────────────────────────────┘
            │ REST + JWT       │ Socket.IO
            ▼                  ▼
┌───────────────────┐  ┌──────────────────────────────────────┐
│  packages/api     │  │  packages/backend (game server)       │
│  Fastify + Zod    │  │  Socket.IO — только игровые действия  │
│  PostgreSQL/Prisma│  │  JWT верификация опциональна           │
│  JWT (30 дней)    │  │  (гости играют без токена)            │
│  Nodemailer       │  └──────────────────────────────────────┘
└───────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                  │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │  users (db1)         │  │  user_profiles (db2)       │   │
│  │  id (PK, uuid)       │◄─│  userId (FK → users.id)    │   │
│  │  login (unique)      │  │  avatarUrl                 │   │
│  │  email (unique)      │  │  rating                    │   │
│  │  passwordHash        │  │  gamesPlayed               │   │
│  │  createdAt           │  │  wins                      │   │
│  │  emailVerified       │  │  ... (будущее)             │   │
│  │  verifiedAt          │  └────────────────────────────┘   │
│  └──────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

**Принцип разделения таблиц:**
- `users` — учётные данные, меняются редко / никогда. Источник истины для аутентификации.
- `user_profiles` — всё изменяемое: аватар, рейтинг, статистика. JOIN по `userId`.

---

## 1. Новый пакет `packages/api`

### Технологии
- **Fastify** — HTTP-фреймворк
- **@fastify/swagger** + **@fastify/swagger-ui** — OpenAPI-спека автоматически
- **Zod** + **fastify-type-provider-zod** — типизированная валидация
- **Prisma** — ORM + миграции
- **bcrypt** — хеширование паролей
- **jsonwebtoken** — JWT (HS256, 30 дней)
- **Nodemailer** — отправка кода подтверждения

### Структура файлов
```
packages/api/
├── src/
│   ├── index.ts                  # Fastify app, регистрация плагинов
│   ├── prisma/
│   │   └── schema.prisma         # Схема БД (две модели)
│   ├── routes/
│   │   ├── auth.ts               # /auth/register, /auth/verify-email, /auth/login
│   │   └── users.ts              # GET /users/me
│   ├── plugins/
│   │   ├── jwt.ts                # Декоратор fastify.authenticate
│   │   └── cors.ts               # CORS
│   └── services/
│       ├── authService.ts        # Регистрация, логин, верификация
│       └── mailService.ts        # Отправка email
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 2. Схема базы данных (Prisma)

```prisma
// Таблица 1: учётные данные — только то что не меняется (или меняется крайне редко)
model User {
  id            String    @id @default(uuid())
  login         String    @unique
  email         String    @unique
  passwordHash  String
  createdAt     DateTime  @default(now())
  emailVerified Boolean   @default(false)
  verifiedAt    DateTime?

  profile       UserProfile?
  verifications EmailVerification[]
}

// Таблица 2: профильные данные — изменяемые, JOIN по userId
model UserProfile {
  id          String  @id @default(uuid())
  userId      String  @unique
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  avatarUrl   String?
  rating      Int     @default(1000)  // ELO, задел на будущее
  gamesPlayed Int     @default(0)
  wins        Int     @default(0)
  updatedAt   DateTime @updatedAt
}

// Временные коды верификации email
model EmailVerification {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  code      String   // 6-значный цифровой код
  expiresAt DateTime // createdAt + 15 минут
  used      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

---

## 3. API эндпоинты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/auth/register` | — | email + login + password → создать User + UserProfile, отправить код |
| `POST` | `/auth/verify-email` | — | email + code → emailVerified=true, вернуть JWT |
| `POST` | `/auth/login` | — | email/login + password → JWT |
| `GET` | `/users/me` | JWT | Вернуть User + UserProfile |

**JWT payload:**
```json
{
  "sub": "uuid",
  "login": "player123",
  "email": "user@example.com",
  "iat": 1751234567,
  "exp": 1753826567   // +30 дней
}
```

---

## 4. Изменения в `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: minesweeper-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: minesweeper
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - minesweeper-net

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    container_name: minesweeper-api
    restart: unless-stopped
    expose:
      - "3002"
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/minesweeper
      - JWT_SECRET=${JWT_SECRET}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASS=${SMTP_PASS}
      - SMTP_FROM=${SMTP_FROM}
    depends_on:
      - postgres
    networks:
      - minesweeper-net

  backend:
    # без изменений кроме опционального JWT_SECRET для будущей верификации
    ...

volumes:
  postgres-data:
```

### Nginx: добавить location для `/api/`
```nginx
location /api/ {
  proxy_pass http://api:3002/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

---

## 5. Frontend изменения

### Новые компоненты

**`packages/frontend/src/components/ProfileButton/`**
- Неавторизован: кнопка 👤 «Войти» → открывает LoginModal
- Авторизован: квадратик с инициалами (или аватаром) + логин → открывает ProfileDropdown

**`packages/frontend/src/components/ProfileDropdown/`**
- Авторизован: логин, email, кнопка «Выйти»
- Гость: кнопки «Войти» и «Зарегистрироваться»

**`packages/frontend/src/components/RegisterModal/`**
- Шаг 1: форма email + логин + пароль + пароль ещё раз
- Шаг 2: форма с одним полем «код из письма» (6 цифр)
- После успеха → JWT в localStorage, закрыть модал

**`packages/frontend/src/components/LoginModal/`**
- email/логин + пароль → JWT в localStorage

### Новый хук `packages/frontend/src/hooks/useAuth.ts`
```typescript
interface AuthState {
  user: {
    id: string;
    login: string;
    email: string;
    profile: { avatarUrl: string | null; rating: number; gamesPlayed: number; wins: number }
  } | null;
  isGuest: boolean;
  isLoading: boolean;
  login: (emailOrLogin: string, password: string) => Promise<void>;
  register: (email: string, login: string, password: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => void;
}
```
- JWT хранится в `localStorage` с ключом `auth_token`
- При монтировании: если токен есть → `GET /api/users/me` для проверки
- Если токен истёк (401) → автоматически logout

### Интеграция в `App.tsx`
```tsx
// В renderHeader — добавить ProfileButton в .headerActions
<div className={styles.headerActions}>
  {/* существующие кнопки */}
  <ProfileButton />
</div>
```

---

## 6. Регистрационный поток

```
[1] User вводит email + login + password + password_confirm
       ↓
[2] POST /api/auth/register
    → валидация (email format, login 3-20 chars, password strength)
    → проверка уникальности email и login
    → bcrypt.hash(password, 12)
    → INSERT User (emailVerified=false)
    → INSERT UserProfile (defaults)
    → Создать EmailVerification (code=random6digits, expiresAt=+15min)
    → Отправить письмо с кодом
    → 201 { message: "Код отправлен на email" }
       ↓
[3] User вводит 6-значный код
       ↓
[4] POST /api/auth/verify-email { email, code }
    → Найти незаиспользованный код для этого email с expiresAt > now()
    → Если не найден → 400 "Код неверен или истёк"
    → emailVerified=true, verifiedAt=now()
    → code.used=true
    → Сгенерировать JWT (30 дней)
    → 200 { token, user }
       ↓
[5] Frontend сохраняет JWT, закрывает модал, обновляет ProfileButton
```

---

## 7. Переменные окружения (`.env.example`)

```env
# PostgreSQL
POSTGRES_USER=minesweeper
POSTGRES_PASSWORD=changeme

# JWT
JWT_SECRET=your-very-long-random-secret-at-least-32-chars

# SMTP (например, Yandex.360, Gmail App Password, Mailgun)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=smtp-password
SMTP_FROM="Minesweeper PvP <noreply@example.com>"

# Уже существующие
DOMAIN=example.com
```

---

## 8. Что НЕ входит в этот план

- Страница профиля `/profile` — откладываем
- Смена пароля / сброс через email
- OAuth (Google, GitHub)
- Refresh tokens
- Матчмейкинг и рейтинг
- Передача userId в game server при создании комнаты

---

## Диаграмма потока

```mermaid
graph TD
    A[App.tsx Header] --> B[ProfileButton]
    B -->|гость| C[LoginModal]
    B -->|гость| D[RegisterModal]
    B -->|авторизован| E[ProfileDropdown]
    D --> F[Шаг 1 - форма]
    F -->|POST /auth/register| G[Шаг 2 - код из письма]
    G -->|POST /auth/verify-email| H[JWT получен]
    C -->|POST /auth/login| H
    H --> I[useAuth - сохранить в localStorage]
    I --> J[ProfileButton - показать логин]
    E -->|Выйти| K[useAuth logout - удалить JWT]
```

---

## Порядок реализации

1. **`packages/api`**: Prisma schema + миграции + Fastify setup
2. **docker-compose.yml**: добавить `postgres` + `api` сервисы
3. **Nginx**: добавить `location /api/`
4. **`packages/api` routes**: auth эндпоинты + mail service
5. **`packages/frontend` useAuth**: хук + API-клиент
6. **LoginModal + RegisterModal**: компоненты
7. **ProfileButton + ProfileDropdown**: компоненты
8. **App.tsx**: интеграция ProfileButton в шапку
