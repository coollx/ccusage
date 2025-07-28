# Firebase Templates

This directory contains template files for setting up Firebase with ccusage cloud sync.

## Files

### firestore.rules

Production-ready security rules for Firestore that:

- Enforce user authentication (anonymous or linked accounts)
- Isolate data between users (users can only access their own data)
- Implement device isolation (each device writes to its own namespace)
- Validate data structure and types
- Prevent unauthorized access

### firestore.indexes.json

Composite indexes for efficient Firestore queries:

- Device-based usage queries (by date and device name)
- Cost analysis queries (sorted by cost)
- Session lookups (by project and session ID)
- Cross-device aggregation queries

## Usage

These templates are automatically deployed when running:

```bash
ccusage sync setup
```

Or manually with the setup script:

```bash
node scripts/firebase-setup.js
```

The setup script will:

1. Copy these templates to a temporary directory
2. Deploy them to your Firebase project
3. Clean up temporary files

## Customization

If you need to customize these rules:

1. Edit the template files in this directory
2. Re-run `ccusage sync setup` to deploy changes
3. Or manually deploy with Firebase CLI:
   ```bash
   firebase deploy --only firestore:rules --project your-project-id
   firebase deploy --only firestore:indexes --project your-project-id
   ```

## Security Notes

- Never remove authentication checks from the rules
- Always test rule changes in Firebase Console's Rules Playground
- Monitor Firebase Console for any security alerts
- The rules enforce strict data validation to prevent malformed data
