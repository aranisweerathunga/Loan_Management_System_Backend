# Loan_Management_System_Backend

REST API for the Loan Management & Valuation System.

## Prerequisites

- Node.js 22.12+ (this repository is pinned to `22.23.3` via `.nvmrc`)
- npm
- PostgreSQL, with a local database named `loan_management_db`

Use a dedicated PostgreSQL role such as `loan_app` for the application. Do not keep using the `postgres` superuser for day-to-day development.

## Local development

```bash
nvm use
npm install
```

Copy `.env.example` to `.env` and set a real connection string. Do not commit `.env`.

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/loan_management_db
CORS_ORIGIN=http://localhost:5173
```

```bash
npm run prisma:generate
npm run dev
```

Health check:

```text
GET http://localhost:3000/api/health
```

Readiness / database check:

```text
GET http://localhost:3000/api/ready
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with reload |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production compile |
| `npm start` | Run the compiled server |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm install` | Installs dependencies and runs `prisma generate` via `postinstall` |
| `npm run prisma:migrate` | Create/apply migrations |
| `npm run prisma:studio` | Open Prisma Studio |

## Money

Persist financial values as Prisma `Decimal` / PostgreSQL `NUMERIC`. Calculate with `decimal.js`. Never use JavaScript `number` arithmetic for money or interest.
