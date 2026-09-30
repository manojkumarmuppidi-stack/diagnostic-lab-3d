-- Own migration: a new enum value cannot be used in the same transaction that adds it.
ALTER TYPE "RecordStatus" ADD VALUE IF NOT EXISTS 'PENDING';
