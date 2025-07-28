# Cloud Sync Structure Migration

## Overview

We've simplified the Firebase data structure by removing the unnecessary user layer. Since each Firebase project belongs to one person, there's no need for user isolation within the project.

## Changes Made

### 1. Data Structure Simplification

**Old Structure:**
```
users/
  {userId}/
    devices/
      {deviceName}/
        usage/
          {date}/
    sync_checkpoints/
      {deviceId}/
    deduplication/
      {hash}/
```

**New Structure:**
```
devices/
  {deviceName}/
    usage/
      {date}/
sync_checkpoints/
  {deviceId}/
deduplication/
  {hash}/
```

### 2. Code Changes

1. **sync-engine.ts**:
   - Updated all paths to remove `users/${userId}` prefix
   - Device path: `devices/${this.deviceName}`
   - Usage path: `devices/${this.deviceName}/usage/${date}`
   - Checkpoint path: `sync_checkpoints/${this.deviceId}`
   - Deduplication path: `deduplication`

2. **sync.ts**:
   - Updated device registration path: `devices/${name}`
   - Updated device listing path: `devices`
   - Removed user ID from log messages

3. **Security Rules**:
   - Created new `firestore-simplified.rules` template
   - All authenticated users can read/write (since each project has one user)
   - Removed user-based access control

### 3. Migration Process

To migrate to the new structure:

1. **Update Firebase Security Rules**:
   - Copy the contents of `templates/firestore-simplified.rules`
   - Go to Firebase Console > Firestore > Rules
   - Replace existing rules and publish

2. **Clear Old Data** (optional):
   - The old data under `users/shared-ccusage-user/` can be deleted
   - New syncs will populate the simplified structure

3. **Re-sync Data**:
   - Run `ccusage sync-now` to populate the new structure
   - Data will now be stored directly under `devices/`

### 4. Benefits

1. **Simpler Structure**: No unnecessary user layer
2. **Easier Navigation**: Direct access to devices and data
3. **Cleaner URLs**: Shorter paths in Firebase Console
4. **Better Performance**: One less collection level to traverse

### 5. Viewing Data

**Firebase Console URLs:**
- Devices: `https://console.firebase.google.com/project/{projectId}/firestore/data/~2Fdevices`
- Specific device: `https://console.firebase.google.com/project/{projectId}/firestore/data/~2Fdevices~2F{deviceName}`
- Usage data: `https://console.firebase.google.com/project/{projectId}/firestore/data/~2Fdevices~2F{deviceName}~2Fusage`

Replace `{projectId}` with your Firebase project ID and `{deviceName}` with your device name.