# WinWidget Frontends

Монорепозиторий `winwidget.ru_frontends` на базе существующего
`winwidget.ru_client`: четыре независимых Next.js приложения, единая установка
pnpm и общие build-time пакеты. Это не единый frontend runtime.

| Приложение         | Назначение и production URL                                                       | Локальный порт |
| ------------------ | --------------------------------------------------------------------------------- | -------------- |
| `apps/landing`     | Лендинг WinWidget: `winwidget.ru`                                                 | 3000           |
| `apps/widgets`     | Рабочее приложение WinWidget: прежние `/cabinet`, auth, payment, заявки и preview | 3002           |
| `apps/admin-panel` | Общая админка WinWidget и WinCRM: `/admin`                                        | 3003           |
| `apps/crm`         | WinCRM: `crm.winwidget.ru`                                                        | 3001           |

Первые три приложения сохраняют Next.js 14 / React 18. CRM сохраняет собственные
Next.js 16 / React 19 и FSD-границы; объединение репозиториев не обновляет
платформенные зависимости существующего продукта. Детали CRM — в
[apps/crm/README.md](apps/crm/README.md).

## Технологический стек

### Основные технологии

- `Next.js 14` и App Router;
- `React 18`;
- `TypeScript`;
- `TanStack React Query`;
- `Axios`;
- `Zustand`;
- `React Hook Form`;
- `libphonenumber-js`.

### UI и стилизация

- `Tailwind CSS 3`;
- `SCSS Modules` и `Sass`;
- `PostCSS` и `Autoprefixer`;
- `clsx`;
- `TipTap`;
- `Chart.js` и `react-chartjs-2`;
- `react-loading-skeleton`;
- `react-hot-toast`.

### Авторизация и вспомогательные библиотеки

- `jose`;
- `js-cookie`;
- `qrcode`;
- `sharp`.

### Качество кода и инфраструктура

- `ESLint` с `next/core-web-vitals` и `jsx-a11y/recommended`;
- `Prettier`;
- `Husky` и `lint-staged`;
- `Node.js 20`;
- `pnpm 9`;
- `Docker` и Next.js standalone output.

---

## Архитектура проекта

Проект построен по Feature-Sliced Design с адаптацией под Next.js App Router.

Документация:
[Документация Feature-Sliced Design](https://feature-sliced.design/ru/docs/get-started/overview)

## Структура слоёв

```text
apps/
├── landing/src/{app,screens}
├── widgets/src/{app,screens,middleware.ts}
├── admin-panel/src/{app,screens,middleware.ts}
└── crm/src/{app,screens,widgets,features,entities,shared}
packages/
└── winwidget-web/src/{app,screens,features,entities,shared}
public/                 # исходные общие public assets первых трёх приложений
scripts/                # проверки, синхронизация assets, упаковка и deploy
pnpm-workspace.yaml
pnpm-lock.yaml          # единственный lockfile
```

Направление зависимостей:

```text
app -> screens -> features -> entities -> shared
```

Стандартный FSD-слой `pages` заменён на `screens`, потому что маршрутизация
принадлежит Next.js App Router в `src/app`.

В первых трёх приложениях FSD-слой `widgets` намеренно не используется. Здесь слово «виджет»
уже обозначает продуктовую сущность Winwidget и отдельные исполняемые скрипты,
поэтому архитектурный слой с тем же именем создавал бы двусмысленные пути и
нейминг. Крупные экранные композиции находятся в `screens`, бизнес-сущность —
в `entities/site-widget`, а пользовательские сценарии — в `features`. Набор
слоёв FSD может быть неполным; важны их границы и направление зависимостей.

## Основные срезы

### Экраны (`screens`)

- `admin`;
- `auth`;
- `cabinet`;
- `home`;
- `legal-documentation`;
- `payment`;
- `widget-leads`;
- `widget-preview`.

### Сущности (`entities`)

- `affiliate`;
- `home-page-content`;
- `legal-page`;
- `site-settings`;
- `site-widget`;
- `subscription`;
- `user`.

### Пользовательские сценарии (`features`)

- `admin-monitoring`;
- `auth`;
- `bind-profile-identity`;
- `campaigns`;
- `cookie-consent`;
- `create-widget`;
- `edit-profile`;
- `edit-widget-settings`;
- `manage-payments`;
- `manage-subscriptions`;
- `manage-telegram-bot`;
- `manage-users`;
- `manage-widgets`;
- `mobile-navigation`;
- `network-status`;
- `run-admin-task`;
- `upload-file`;
- `view-event-log`.

## Правила архитектуры

- Нижний слой не импортирует верхний.
- Срезы одного слоя не зависят друг от друга напрямую.
- Внешний код импортирует срез через его публичный API.
- Связи между entities оформляются через явный cross-import API в `@x`.
- `shared` не зависит от бизнес-логики.
- Доменные типы находятся в соответствующей сущности или пользовательском
  сценарии.
- Базовая HTTP-инфраструктура находится в `shared/api`.
- Доменные запросы находятся в `api` соответствующего среза.
- Серверные модули не импортируются в клиентские компоненты.
- Ключи запросов, запросы и мутации размещаются рядом с владельцем данных.
- Циклические зависимости запрещены.

Серверные точки входа и серверные действия экспортируются отдельно от
клиентского `index.ts`, например через `server.ts` и `actions.ts`. Это не
позволяет случайно включить серверный код в клиентскую сборку.

## Независимость приложений и маршруты

В `apps/*` находятся собственные routes, layouts и экраны. Общий
`packages/winwidget-web` используется при сборке первых трёх приложений:
UI, auth/API primitives и редактор виджета с прежними owner/admin adapters.
Он не запускает сервер, не владеет маршрутами и не импортирует `apps/*`.
Приложения не импортируют друг друга; у CRM отдельные зависимости и FSD.

У каждого приложения собственные `public`, `.next`, standalone image и
readiness `/__frontend/health`. Админка не загружает редактируемые marketing
HTML, affiliate tracker, cookie banner или landing footer.

Общая админка сохраняет прежние URL и backend-права, но разделяет навигацию
на шесть групп: «Обзор», «Клиенты и продукты», «Финансы», «Контент и связь»,
«Эксплуатация», «Управление». Второй уровень показывает страницы выбранного
раздела. Ограничения DEV применяются к изменяющим действиям, не ко всей
доступной ADMIN справочной части.

Административный Backlog, его UI и клиентский Notes API удалены. Удаление
данных выполняет отдельная миграция Operations, а не frontend deployment;
технический `winwidget.ru_services/docs/backlog.md` остаётся. Пока
`CRM_RELEASE.apiEnabled=false`, `/admin/crm` показывает справку и состояние
«Скоро», не обращаясь к ещё не выпущенным CRM/Billing contracts.

Для первых трёх зон используются уникальные asset prefixes
`/_frontends/{landing,widgets,admin-panel}`. Между зонами `ZoneLink` и
`useZoneRouter` выполняют полную навигацию документа; внутри зоны сохраняют
Next navigation. Пути и query/hash старого кабинета, auth, admin и оплаты
остаются прежними. CRM работает на собственном домене без asset prefix.

`apps/<app>/src/app` отвечает за URL, макеты, метаданные и инициализацию приложения.
Файлы маршрутов остаются тонкими и подключают экраны из `src/screens`.

Публичные маршруты предпросмотра:

- `/page-wheel/[key]`;
- `/page-quiz/[key]`;
- `/page-callback/[key]`;
- `/page-timer/[key]`;
- `/page-stop-offer/[key]`;
- `/page-ai-consultant/[key]`;
- `/page-calculator/[key]`.

Виджеты, которые собирают контакты, используют единую композицию страницы
заявок в `screens/widget-leads`. AI-консультант заявки не создаёт.

---

## Установка и запуск

## Требования

- Node.js 20;
- pnpm 9;
- запущенный API Gateway на `http://localhost:4100` и сервисы из его локального
  манифеста маршрутов; API и статические файлы Widgets по умолчанию доступны на
  `http://localhost:4700`.

## Установка зависимостей

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
```

## Настройка окружения

```bash
cp .env.example apps/landing/.env.local
cp .env.example apps/widgets/.env.local
cp .env.example apps/admin-panel/.env.local
cp apps/crm/.env.example apps/crm/.env.local
```

Для авторизованных маршрутов настройте серверную проверку токена доступа:

```env
NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
JWT_JWKS_URL=http://localhost:4100/api/v1/auth/.well-known/jwks.json
JWT_ISSUER=http://localhost:4100/auth
JWT_AUDIENCE=http://localhost:4100
JWT_CLOCK_TOLERANCE_SECONDS=5
JWT_MAX_TOKEN_LIFETIME_SECONDS=900
```

Значения издателя (`issuer`) и аудитории (`audience`) должны совпадать с
бэкендом. Эти переменные используются только промежуточным ПО Next.js, поэтому
не добавляйте к ним префикс
`NEXT_PUBLIC_`.

Gateway разрешает CORS с передачей учетных данных только для точных адресов
разработки
`http://localhost:3000` и `http://127.0.0.1:3000`. Поэтому весь локальный
версионированный API идёт через `:4100`, а исполняемые файлы виджетов и
предпросмотр без версии — через `NEXT_PUBLIC_WIDGETS_HOST=:4700`. Общего
catch-all маршрута и резервного backend upstream нет.

## Запуск сервера разработки

```bash
pnpm dev:landing
pnpm dev:widgets
pnpm dev:admin-panel
pnpm dev:crm
```

Запускайте приложения в отдельных терминалах. Порты указаны в таблице выше.
`pnpm dev` запускает лендинг. Прямые порты позволяют проверять отдельное
приложение; для сквозного auth и межзонных переходов нужен локальный proxy
с той же маршрутизацией, что в tracked Nginx. Не проверяйте эти переходы
между произвольными портами без proxy и согласованного CORS Gateway.

## Сборка для production

```bash
pnpm build
pnpm --filter @winwidget/widgets start --port 3002
```

## Переменные окружения

| Переменная                       | Назначение                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MODE`               | Режим выбора адресов: `development` или `production`                                     |
| `NEXT_PUBLIC_SITE_URL`           | Публичный адрес фронтенда                                                                |
| `NEXT_PUBLIC_PRODUCTION_HOST`    | Публичный адрес бэкенда рабочей среды                                                    |
| `NEXT_PUBLIC_WIDGETS_HOST`       | Адрес сервиса Widgets; по умолчанию `:4700` локально и бэкенд рабочей среды в production |
| `NEXT_PUBLIC_API_URL`            | Полный базовый URL API с `/api/v1`                                                       |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Публичный ключ reCAPTCHA v3                                                              |
| `NEXT_PUBLIC_RECAPTCHA_HOST`     | Хост загрузки reCAPTCHA                                                                  |
| `JWT_JWKS_URL`                   | Серверный URL набора публичных RS256-ключей бэкенда                                      |
| `JWT_ISSUER`                     | Ожидаемый на сервере издатель токена доступа; должен совпадать с бэкендом                |
| `JWT_AUDIENCE`                   | Ожидаемая на сервере аудитория токена доступа; должна совпадать с бэкендом               |
| `JWT_CLOCK_TOLERANCE_SECONDS`    | Допустимое на сервере расхождение часов, целое число секунд от `0` до `60`               |
| `JWT_MAX_TOKEN_LIFETIME_SECONDS` | Максимальное на сервере время жизни токена доступа, от `60` до `1800` секунд             |

Не коммитьте реальные секреты. Переменные `NEXT_PUBLIC_*` встраиваются во
фронтенд во время сборки, поэтому после их изменения рабочий образ нужно
пересобрать. JWT-переменные без этого префикса остаются на сервере и передаются
в рабочее окружение контейнера фронтенда.

## Команды

| Команда          | Назначение                                          |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Запуск лендинга; остальные приложения — `dev:<app>` |
| `pnpm build`     | Независимые сборки всех четырёх приложений          |
| `pnpm start`     | Запуск предварительно собранного лендинга           |
| `pnpm lint`      | Проверка ESLint                                     |
| `pnpm typecheck` | Проверка TypeScript приложений и общего пакета      |
| `pnpm test`      | Общие контрактные проверки и тесты CRM              |
| `pnpm format`    | Форматирование файлов через Prettier                |

`pnpm format` изменяет файлы.

---

## Работа с API и данными

- `shared/api` создаёт публичный и авторизованный клиенты Axios.
- Токен доступа хранится в cookie `accessToken`.
- Промежуточное ПО Next.js проверяет токен доступа только по RS256 через
  публичные ключи из JWKS. Приватный ключ подписи фронтенд не получает.
- Обновление выполняется через `/api/v1/auth/refresh` с защитой от параллельных
  дублирующих запросов. Бэкенд при каждом успешном обновлении ротирует
  непрозрачный токен обновления и возвращает новую cookie через `Set-Cookie`.
- Cookie обновления имеет флаг `HttpOnly`: браузерный JavaScript не может её
  прочитать. Axios отправляет cookie автоматически с `withCredentials`, а
  серверное промежуточное ПО переносит полученный `Set-Cookie` в итоговый ответ.
- API конкретной бизнес-области находится внутри её сущности или
  пользовательского сценария.
- Серверные запросы Next.js отделены от браузерных API-модулей.
- Запросы из интерфейса выполняются через хуки React Query или API
  соответствующего среза.
- Не выполняйте необёрнутые HTTP-запросы непосредственно в компонентах
  интерфейса.

---

## Формы и уведомления

- Для форм используется React Hook Form.
- Типы, валидация и преобразование данных размещаются рядом с пользовательским
  сценарием.
- Для телефонных полей используется `libphonenumber-js` и общий телефонный хук.
- Результаты пользовательских действий отображаются через `react-hot-toast`.
- Ошибки фронтенда и бэкенда должны отображаться понятным пользователю
  текстом.

---

## Стили и изображения

## Стили

- Компонентные стили размещаются в SCSS Modules.
- Tailwind-директивы в SCSS оформляются через `@apply`.
- Tailwind каждого приложения сканирует собственный `src` и, где нужен,
  общий `packages/winwidget-web/src`; CRM не сканирует соседние приложения.
- Глобальные стили добавляются только при необходимости.
- После рефакторинга удаляйте неиспользуемые и остаточные стили.
- При кастомной стрелке `select` отключайте системную через
  `@apply appearance-none` и оставляйте достаточный правый отступ.

## SVG

Для оптимизации SVG использовать:

[SVGOMG](https://svgomg.net/privacy)

Рекомендуется удалять лишние метаданные, уменьшать точность и включать очистку
идентификаторов.

## PNG

Для оптимизации PNG использовать:

[SVGOMG PNG Optimization](https://svgomg.net/privacy)

Перед добавлением изображений уменьшайте размер файлов, избегайте чрезмерно
крупных ресурсов и по возможности используйте WebP или AVIF.

---

## Стиль кода

- Используйте псевдоним `@/*` для импортов из `src`.
- Следуйте существующим настройкам ESLint и Prettier.
- Не добавляйте `any` без обоснованной необходимости.
- Сохраняйте существующие именование и стиль кода затрагиваемого среза.
- Не смешивайте UI, сетевые запросы, преобразование DTO и бизнес-правила в
  одном модуле без необходимости.
- Не создавайте глобальные вспомогательные функции и новые абстракции без
  практической пользы.

Перед коммитом Husky и lint-staged форматируют затронутые файлы и запускают
ESLint для TypeScript-кода.

В CRM React types привязаны к собственным `node_modules/@types` через
`.d.ts` aliases: TypeScript не подхватывает React 18 из соседних зависимостей,
а webpack пропускает declaration aliases и использует настоящий React 19.
Корневой Husky единственный; ближайшая настройка lint-staged CRM сохраняет
собственный ESLint 9. Вложенные workflow, Dockerfile и lockfile CRM не нужны.

Общие public assets синхронизирует `scripts/sync-public.mjs` перед dev/build/start.
Источник и SHA-256 перечислены в `scripts/public-assets.manifest.json`;
неизвестные файлы, symlinks и изменение ранее сгенерированного файла блокируют
перезапись. После изменения исходного public выполните
`node scripts/sync-public.mjs --generate-manifest` и проверьте diff манифеста.

---

## Проверки и тестирование

Минимальный набор проверок:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Перед релизом выполните ручное дымовое тестирование:

- главной и публичных страниц;
- регистрации, входа, обновления сессии и выхода;
- личного кабинета;
- создания, редактирования, включения и удаления каждого типа виджета;
- публичных страниц предпросмотра;
- единой страницы заявок;
- критических разделов административной панели;
- оплаты и изменения подписки.

---

## Рекомендуемый формат веток

```bash
dev_3.0.0/feature/frontend-monorepo
```

## Соглашение о сообщениях коммитов

```bash
feat: add transfer form
fix: resolve currency formatting issue
refactor: split card widget
```

## CI/CD и production-развертывание

`.github/workflows/ci.yml` проверяет точный SHA без production-доступов:
контракты и общий пакет, затем четыре независимые app jobs с typecheck/lint,
CRM tests/format и отдельной Docker standalone сборкой.

Этап проверки выполняет:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Dockerfile требует `FRONTEND_APP=landing|widgets|admin-panel|crm` и exact
`APP_REVISION`. После установки зависимостей сборка выполняется без сети;
runtime содержит только выбранное приложение и работает не от root.
Robots/sitemap используют актуальный редактируемый контент во время запроса,
а не запекают fallback при недоступном API на этапе сборки.

Production deployment — отдельный gated workflow и controller. Все четыре
контейнера размещаются на текущем frontend VPS; это не запускает backend
deploy. До переключения обязательны green exact-SHA CI, сохранение прежних
контейнеров/hashed assets, четыре readiness проверки и согласованный
immutable Nginx artifact. CRM DNS/TLS должны быть готовы. Платежи CRM остаются
выключенными; публикация frontend не означает выпуск CRM backend/MVP.

Последовательность production-релиза:

```text
локальные проверки
-> коммит и отправка изменений
-> проверка в GitHub Actions
-> развертывание через GitHub Actions
-> дымовое тестирование рабочей среды
```

Связанные файлы и каталоги:

- [`.env.example`](.env.example);
- [`Dockerfile`](Dockerfile);
- [`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml);
- [`scripts/deploy-production.sh`](scripts/deploy-production.sh);
- `../winwidget.ru_infra` — Nginx и общий production-контур;
- защищённый локальный `../deploy/frontend/.env.production` — единственный
  нетрековый env-файл фронтенда;
- [документация сервисов и технический backlog](https://github.com/nda17/winwidget.ru_services/tree/prod/docs);
- [production/deploy runbook](https://github.com/nda17/winwidget.ru_infra/blob/master/docs/runbook.md).
