# AED Hospital — Finance, Accounting & Operational Analytics

Income, expenditure, daily closing, reconciliation, historical Excel import and analytics for **AED Hospital, KPHB, Hyderabad**. It is a responsive web app/PWA for desktop, tablet, Android and iPhone.

## Quick start (development)
```bash
cp .env.example .env            # set DATABASE_URL and SEED_ADMIN_PASSWORD
npm install
npm run db:migrate
SEED_DEMO_DATA=true npm run db:seed    # demo data is fictional and clearly marked DEMO
npm run dev                            # http://localhost:3000  (user: admin)
```
Demo users (demo seed only, password `Demo#12345`): `accounts`, `reception`, `ipd`, `lab`, `pharmacy`, `management`.

## Tests
```bash
npm test                                         # 110 unit + integration tests (needs PostgreSQL test DB)
BASE_URL=http://localhost:3000 npm run test:e2e  # Playwright, against a disposable demo DB
```

## Documentation
[PROJECT_SPEC](PROJECT_SPEC.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE_SCHEMA](DATABASE_SCHEMA.md) · [ACCOUNTING_RULES](ACCOUNTING_RULES.md) · [EXCEL_IMPORT_SPEC](EXCEL_IMPORT_SPEC.md) · [TESTING_PLAN](TESTING_PLAN.md) · [DEPLOYMENT](DEPLOYMENT.md) · [BACKUP_RECOVERY](BACKUP_RECOVERY.md) · [CHANGELOG](CHANGELOG.md)
