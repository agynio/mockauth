-- Add encrypted client secret storage for confidential clients
ALTER TABLE "Client" ADD COLUMN "clientSecretEncrypted" TEXT;
