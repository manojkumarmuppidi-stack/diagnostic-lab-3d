# Backup & Recovery

Financial data must never depend on one disk. Minimum policy: **nightly full backup + point-in-time recovery + an off-site copy + a quarterly restore test.**

## 1. Database backup
**Managed PostgreSQL** (RDS, Cloud SQL, Supabase…): enable automated backups with ≥ 30 days retention and point-in-time recovery (PITR). Also keep a monthly logical dump off-site.

**Self-hosted**, nightly logical dump (cron, as the migration owner):
```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F_%H%M)
pg_dump --format=custom --no-owner "$DATABASE_URL" > /backups/aed_$STAMP.dump
sha256sum /backups/aed_$STAMP.dump > /backups/aed_$STAMP.dump.sha256
# off-site copy (encrypted), e.g.:
# rclone copy /backups remote:aed-backups --include "aed_$STAMP.*"
find /backups -name 'aed_*.dump' -mtime +35 -delete
```
For PITR on a self-hosted server, enable WAL archiving (`archive_mode=on`) with pgBackRest or WAL-G.

## 2. Database restore
```bash
createdb aed_restore
pg_restore --no-owner --dbname=aed_restore /backups/aed_2026-09-25_0200.dump
# verify, then point DATABASE_URL at aed_restore (or rename databases during a maintenance window)
npx prisma migrate status
```
Checks after restore: the `v_income_line` view exists, guard triggers are present (`\dS "Consultation"`), the last closed day's totals match its `DailyAccount.closingSnapshot`, and the audit log count is plausible.

## 3. File (attachment) backup
Bills live in `UPLOAD_DIR` (or object storage). Back them up with the same schedule: `rsync -a --delete` to a second disk plus an off-site encrypted copy, or enable versioning and cross-region replication on the bucket. Each `Attachment` row stores the file's SHA-256, so restores can be verified.

## 4. Disaster recovery
| Scenario | Action | Target |
|---|---|---|
| App server lost | Redeploy from git, set env vars, point at the DB | RTO < 2 h |
| DB corrupted / dropped | PITR to just before the incident, or the latest dump | RPO ≤ 24 h (dump) / minutes (PITR) |
| Bad import | **Reverse the import batch** in the app (no restore needed) | minutes |
| Wrong entries | Correction / void workflow (full audit trail) | minutes |
| Ransomware / site loss | Restore the off-site DB and file copies to new infrastructure | RTO < 1 day |

Keep a printed or offline copy of this runbook, the DB credentials location and the backup-provider contacts.

## 5. Restore drill (quarterly)
Restore the latest backup into a scratch database, run `npm test` integration checks against a copy if desired, open Reports → Monthly for the last closed month and compare with the saved PDF. Record the drill date and result.
