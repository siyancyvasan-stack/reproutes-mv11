-- Reproutes MySQL 8 migration: persistent WebAuthn credentials, one-time
-- challenges, and the existing EmailVerification table for password resets.
-- Run this once against the same MySQL database used by backend/src/lib/db.js.

CREATE TABLE IF NOT EXISTS BiometricCredential (
  id CHAR(36) NOT NULL PRIMARY KEY,
  userId CHAR(36) NOT NULL,
  credentialId VARCHAR(1024) NOT NULL,
  publicKey BLOB NOT NULL,
  signCount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  deviceName VARCHAR(100) NOT NULL,
  credentialType VARCHAR(32) NOT NULL,
  transports JSON NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastUsedAt DATETIME NULL,
  revokedAt DATETIME NULL,
  UNIQUE KEY uq_biometric_credential_id (credentialId(255)),
  KEY idx_biometric_user_active (userId, revokedAt),
  CONSTRAINT fk_biometric_credential_user FOREIGN KEY (userId) REFERENCES User(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS PasskeyChallenge (
  id CHAR(36) NOT NULL PRIMARY KEY,
  userId CHAR(36) NULL,
  challenge VARCHAR(512) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  expiresAt DATETIME NOT NULL,
  consumedAt DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_passkey_challenge_lookup (id, purpose, consumedAt, expiresAt),
  KEY idx_passkey_challenge_user (userId),
  CONSTRAINT fk_passkey_challenge_user FOREIGN KEY (userId) REFERENCES User(id)
) ENGINE=InnoDB;

-- Passkey-created refresh sessions are revoked when their credential is removed.
-- Requires MySQL 8.0.29+ for IF NOT EXISTS; omit this statement only if the
-- column and index are already present on an older supported MySQL server.
ALTER TABLE RefreshToken
  ADD COLUMN IF NOT EXISTS passkeyCredentialId CHAR(36) NULL,
  ADD INDEX IF NOT EXISTS idx_refresh_passkey_credential (passkeyCredentialId);

-- EmailVerification already backs registration OTPs. Password reset records
-- use purpose='PASSWORD_RESET', SHA-256 token hashes in codeHash, a 15-minute
-- expiresAt, and consumedAt for single use; no additional table is required.
