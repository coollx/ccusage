# Firebase Setup Guide

![Firebase Setup](https://firebase.google.com/images/social.png)

This guide walks you through setting up your own Firebase project for ccusage cloud sync. Your data remains completely private in your own Firebase project.

## Prerequisites

Before starting, ensure you have:

- A Google account (for Firebase Console access)
- Node.js installed (for running setup scripts)
- ccusage installed globally: `npm install -g ccusage`
- Basic familiarity with command line tools

## Step 1: Create Your Firebase Project

### 1.1 Access Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Sign in with your Google account
3. Click "Create a project" or "Add project"

### 1.2 Configure Project

1. **Project Name**: Enter a unique name (e.g., `my-ccusage-sync`)
   - This will be your project ID
   - Must be globally unique across all Firebase projects
   - Suggestion: Use format `yourname-ccusage-sync`

2. **Google Analytics**: You can disable this (not needed for ccusage)
   - Uncheck "Enable Google Analytics for this project"
   - Click "Create project"

3. Wait for project creation (usually takes 30-60 seconds)

## Step 2: Enable Required Services

### 2.1 Enable Firestore Database

1. In Firebase Console, click "Firestore Database" in the left sidebar
2. Click "Create database"
3. **Security Rules**: Select "Start in production mode"
   - We'll deploy proper rules later
4. **Location**: Choose the region closest to you
   - Examples: `us-central1`, `europe-west1`, `asia-northeast1`
   - ⚠️ **Important**: Location cannot be changed later
5. Click "Enable"

### 2.2 Enable Authentication

1. Click "Authentication" in the left sidebar
2. Click "Get started"
3. Go to "Sign-in method" tab
4. Enable "Anonymous" authentication:
   - Click on "Anonymous"
   - Toggle "Enable"
   - Click "Save"

### 2.3 Enable Realtime Database (Optional)

1. Click "Realtime Database" in the left sidebar
2. Click "Create Database"
3. **Security Rules**: Select "Start in locked mode"
4. **Location**: Will use same region as Firestore
5. Click "Enable"

## Step 3: Get Your Configuration

### 3.1 Find Project Settings

1. Click the gear icon (⚙️) next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click "</> Web" icon to add a web app

### 3.2 Register Web App

1. **App nickname**: Enter "ccusage-sync"
2. **Firebase Hosting**: Leave unchecked
3. Click "Register app"
4. You'll see your Firebase configuration

### 3.3 Copy Configuration Values

You'll see a code block with your configuration. Copy these values:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",              // Your API Key
  authDomain: "my-ccusage-sync.firebaseapp.com",
  projectId: "my-ccusage-sync",     // Your Project ID
  storageBucket: "my-ccusage-sync.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## Step 4: Configure ccusage

### 4.1 Initialize Cloud Sync

Run the ccusage sync initialization:

```bash
ccusage sync init
```

When prompted, enter your Firebase configuration:

```
🔥 Firebase Setup for ccusage
Please enter your Firebase configuration:
> Project ID: my-ccusage-sync
> API Key: AIzaSy...
> Auth Domain: my-ccusage-sync.firebaseapp.com
> Storage Bucket: my-ccusage-sync.appspot.com

✓ Config saved to ~/.ccusage/firebase.json
✓ Testing connection...
✓ Firebase connected successfully!
```

### 4.2 Run Setup Script

Deploy security rules and create database structure:

```bash
ccusage sync setup
```

This will:
- Deploy security rules to protect your data
- Create necessary Firestore indexes
- Set up initial database structure

### 4.3 Enable Sync

Finally, enable sync and name your device:

```bash
ccusage sync enable
```

Example:
```
Please provide a name for this device (e.g., "MacBook Pro", "Work Linux"):
> MacBook Pro

✓ "MacBook Pro" is available!
✓ Device registered
✓ Cloud sync enabled!
```

## Step 5: Verify Setup

### 5.1 Check Sync Status

```bash
ccusage sync status
```

Expected output:
```
🔄 Cloud Sync Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Sync enabled
✓ Connected to Firebase
📱 Device: MacBook Pro
🔐 User: anon-abc123...
📊 Last sync: 2 minutes ago
```

### 5.2 Test Sync

```bash
# Force a sync
ccusage sync now

# View daily usage with cloud data
ccusage daily --cloud
```

## Cost Estimates

### Firebase Free Tier Limits

For a typical single user with 3-5 devices:

| Service | Free Tier | Your Usage | Cost |
|---------|-----------|------------|------|
| Firestore Reads | 50K/day | ~30/day | $0 |
| Firestore Writes | 20K/day | ~90/day | $0 |
| Firestore Storage | 1GB | ~1MB/year | $0 |
| Bandwidth | 10GB/month | ~10MB/month | $0 |
| Authentication | Unlimited | Anonymous | $0 |

**Estimated monthly cost: $0** (stays within free tier)

### When You Might Incur Costs

- **Heavy Usage**: >10 devices syncing frequently
- **Team Usage**: Multiple users sharing data
- **Long Retention**: Keeping >2 years of data
- **Frequent Queries**: Running reports every few minutes

Even with heavy usage, costs typically stay under $1/month.

## Troubleshooting

### Common Issues

#### "Permission Denied" Errors

**Cause**: Security rules not deployed properly

**Fix**:
```bash
# Re-run setup to deploy rules
ccusage sync setup
```

#### "Project Not Found" Error

**Cause**: Incorrect project ID

**Fix**:
1. Verify project ID in Firebase Console
2. Re-run `ccusage sync init` with correct ID

#### "Network Error" During Sync

**Cause**: Firewall or proxy blocking Firebase

**Fix**:
1. Check if you can access `https://firestore.googleapis.com`
2. Configure proxy settings if needed:
   ```bash
   export HTTPS_PROXY=http://your-proxy:port
   ```

#### "Invalid API Key" Error

**Cause**: API key copied incorrectly

**Fix**:
1. Go back to Firebase Console → Project Settings
2. Copy the entire API key (starts with "AIza")
3. Re-run `ccusage sync init`

### Advanced Troubleshooting

#### Check Firebase Logs

1. Go to Firebase Console
2. Click "Functions" → "Logs"
3. Look for any error messages

#### Verify Database Structure

1. Go to Firestore Database in Firebase Console
2. You should see:
   ```
   users/
     └── {your-user-id}/
         └── devices/
             └── {your-device-name}/
                 └── usage/
                     └── 2025-01-15 (example date)
   ```

#### Reset and Start Over

If all else fails:

```bash
# Disable sync
ccusage sync disable

# Remove configuration
rm ~/.ccusage/firebase.json
rm ~/.ccusage/sync.yaml

# Start setup again
ccusage sync init
```

## Security Best Practices

### Protect Your Configuration

1. **Never commit** `~/.ccusage/firebase.json` to version control
2. **Don't share** your API key publicly
3. **Restrict API key** in Google Cloud Console (optional):
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to "APIs & Services" → "Credentials"
   - Click on your API key
   - Add application restrictions

### Monitor Usage

1. Check Firebase Console regularly for unusual activity
2. Set up billing alerts in Google Cloud Console
3. Review Firestore usage metrics monthly

### Data Privacy

- All data stays in your Firebase project
- ccusage never has access to your data
- You can delete all data anytime from Firebase Console
- Enable encryption for extra security (coming soon)

## Next Steps

- [Set up multiple devices](./multi-device-setup.md)
- [Configure team sharing](./team-setup.md) (optional)
- [Export your data](./data-export.md)
- [Manage retention policies](./data-retention.md)

## Additional Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Pricing Calculator](https://cloud.google.com/products/calculator)
- [ccusage Cloud Sync Architecture](../architecture/cloud-sync.md)
- [Privacy and Security Guide](./privacy-security.md)