# Security and Privacy Guide

This guide explains the security and privacy features of ccusage's cloud sync functionality. We've designed the system with a **privacy-first, zero-knowledge architecture** to ensure your usage data remains completely under your control.

## Table of Contents

- [Overview](#overview)
- [Zero-Knowledge Architecture](#zero-knowledge-architecture)
- [Client-Side Encryption](#client-side-encryption)
- [Privacy Controls](#privacy-controls)
- [Data Retention](#data-retention)
- [Security Configuration](#security-configuration)
- [Best Practices](#best-practices)

## Overview

ccusage cloud sync implements multiple layers of security:

1. **User-owned Firebase**: You own and control your Firebase project
2. **Client-side encryption**: Data is encrypted before leaving your device
3. **Data anonymization**: Optional anonymization of project/session names
4. **Retention policies**: Automatic cleanup of old data
5. **Access control**: Strict Firebase security rules

## Zero-Knowledge Architecture

We've designed ccusage so that **we never see your data**:

- All data is stored in **your Firebase project**
- Encryption keys are derived from **your Firebase auth UID**
- We have **no access** to your Firebase project or data
- The ccusage team cannot recover your data if you lose access

This architecture ensures complete privacy while enabling powerful cloud sync features.

## Client-Side Encryption

### How It Works

ccusage uses **AES-256-GCM** encryption with **PBKDF2** key derivation:

```typescript
// Encryption happens before any data leaves your device
const encrypted = await encryption.encrypt(sensitiveData, authUid);
// Only encrypted data is sent to Firebase
```

### What Gets Encrypted

By default, the following fields are encrypted:

- **Session Usage**: `projectId`, `sessionId`
- **Device Usage**: No fields encrypted by default
- **Aggregated Usage**: No fields encrypted by default

You can configure which fields to encrypt in your security settings.

### Key Management

- Keys are derived from your Firebase auth UID using PBKDF2
- Keys are stored locally in `~/.ccusage/keys/`
- Automatic key rotation every 90 days (configurable)
- Previous keys are retained for decryption of old data

## Privacy Controls

### Enable Privacy Features

```bash
# Configure privacy settings
ccusage privacy config

# Options:
# - Anonymize project names: Yes/No
# - Anonymize session IDs: Yes/No
# - Data retention days: 30-730
```

### Data Anonymization

When enabled, ccusage anonymizes identifiers using SHA-256 hashing:

- **Project names**: `my-secret-project` → `project-a3f8b2c1`
- **Session IDs**: `session-12345` → `session-d4e9f3a2`

Anonymization is:
- **Deterministic**: Same input always produces same output
- **One-way**: Cannot reverse the anonymization
- **Consistent**: Works across all your devices

### Example with Anonymization

```bash
# With anonymization disabled (default)
┌─────────────┬────────────────────┬──────────┐
│ Project     │ Session            │ Cost     │
├─────────────┼────────────────────┼──────────┤
│ my-app      │ feature-branch     │ $12.34   │
│ secret-proj │ main-session       │ $45.67   │
└─────────────┴────────────────────┴──────────┘

# With anonymization enabled
┌─────────────┬────────────────────┬──────────┐
│ Project     │ Session            │ Cost     │
├─────────────┼────────────────────┼──────────┤
│ project-a3f │ session-d4e        │ $12.34   │
│ project-b2c │ session-f9a        │ $45.67   │
└─────────────┴────────────────────┴──────────┘
```

## Data Retention

### Configure Retention Policy

```bash
# Set retention to 180 days
ccusage privacy retention --days 180

# Valid range: 30-730 days
```

### Automatic Cleanup

ccusage automatically removes data older than your retention period:

- Cleanup runs during sync operations
- Deleted data cannot be recovered
- Affects both local and cloud data

### Manual Data Export

Export your data before it's automatically deleted:

```bash
# Export all data as JSON
ccusage privacy export --format json > my-usage-data.json

# Export as CSV for spreadsheets
ccusage privacy export --format csv > my-usage-data.csv
```

## Security Configuration

### View Current Settings

```bash
ccusage privacy status

# Output:
┌──────────────────────┬─────────────┐
│ Setting              │ Value       │
├──────────────────────┼─────────────┤
│ Encryption Enabled   │ Yes         │
│ Anonymize Projects   │ No          │
│ Anonymize Sessions   │ No          │
│ Retention Days       │ 365         │
│ Last Key Rotation    │ 2025-01-15  │
└──────────────────────┴─────────────┘
```

### Advanced Configuration

For advanced users, you can edit `~/.ccusage/security.json`:

```json
{
  "encryptionEnabled": true,
  "encryptedFields": {
    "deviceUsage": [],
    "sessionUsage": ["projectId", "sessionId"],
    "aggregatedUsage": []
  },
  "keyRotationDays": 90,
  "lastKeyRotation": "2025-01-15T10:00:00Z"
}
```

## Best Practices

### 1. Enable Encryption

Always enable encryption for sensitive projects:

```bash
ccusage sync enable --encrypt
```

### 2. Use Strong Authentication

Link a permanent account for better security:

```bash
# Link with Google account
ccusage sync link --provider google

# Or GitHub
ccusage sync link --provider github
```

### 3. Regular Key Rotation

Keys rotate automatically, but you can force rotation:

```bash
ccusage security rotate-keys
```

### 4. Monitor Access

Regularly check which devices have access:

```bash
ccusage sync devices

# Remove old devices
ccusage sync remove-device "Old Laptop"
```

### 5. Backup Your Keys

Your encryption keys are critical. Back up the `~/.ccusage/keys/` directory to a secure location.

### 6. Set Appropriate Retention

Balance between historical data needs and privacy:

- **30 days**: Maximum privacy, minimal history
- **90 days**: Good balance for most users
- **365 days**: Full year of history (default)
- **730 days**: Maximum allowed retention

## Firebase Security Rules

Your Firebase project uses strict security rules:

```javascript
// Only you can access your data
match /users/{userId}/{document=**} {
  allow read, write: if request.auth.uid == userId;
}

// Rate limiting prevents abuse
function rateLimit(resource) {
  let lastWrite = resource.data.lastUpdated;
  let now = request.time;
  return now > lastWrite + duration.value(1, 's');
}

// Document size limits
allow write: if request.resource.size() < 100 * 1024; // 100KB
```

## Troubleshooting

### Lost Encryption Keys

If you lose your encryption keys:

1. You'll need to reset your cloud data
2. Local data remains accessible
3. Generate new keys with `ccusage security reset`

### Forgotten Anonymization Mapping

Anonymization is one-way. If you need to track mappings:

1. Export data before enabling anonymization
2. Keep a secure record of project/session names
3. Or disable anonymization for critical projects

### Data Not Syncing

Check your security settings:

```bash
# Verify encryption is working
ccusage sync verify --verbose

# Check for sync errors
ccusage sync status
```

## Privacy Commitment

We're committed to your privacy:

- **No telemetry**: ccusage sends no data to us
- **No analytics**: We don't track your usage
- **Open source**: Audit the code yourself
- **User-owned**: Your Firebase, your data, your control

For questions or concerns about security, please open an issue on GitHub.