# Phase 1 Cloud Sync - Manual Test Plan

## Test Environment Setup

### Prerequisites
- Node.js v20.19.4 or higher
- Access to Firebase Console
- ccusage repository cloned locally

### Firebase Project Setup
1. Create a new Firebase project at https://console.firebase.google.com
2. Enable Anonymous Authentication
3. Create a Firestore database (in production mode)
4. Note down the Firebase configuration values

## Test Cases

### 1. Configuration Management Tests

#### 1.1 Firebase Config Save/Load
```bash
# Test saving Firebase configuration
mkdir -p ~/.ccusage
echo '{"projectId":"test-project","apiKey":"test-key","authDomain":"test.firebaseapp.com"}' > ~/.ccusage/firebase.json

# Verify file created
cat ~/.ccusage/firebase.json
```

**Expected Result**: Configuration file should be created with proper JSON formatting

#### 1.2 Sync Settings Default Values
```bash
# Remove existing sync settings
rm -f ~/.ccusage/sync.json

# Run a command that loads sync settings
# (This would be done through the actual ccusage CLI once integrated)
```

**Expected Result**: Default settings should be created with:
- `enabled: false`
- `retentionDays: 365`

### 2. Device Management Tests

#### 2.1 Device Name Validation
Test the following device names:
- ✅ Valid: "MacBook Pro", "Work Linux", "Gaming PC 2024"
- ❌ Invalid: "" (empty), "a".repeat(51) (too long), "Device<Name>" (invalid chars)

#### 2.2 Device Name Suggestions
When a device name is taken, verify suggestions are generated:
- Base name + " (2)"
- Base name + " - Home"
- Base name + " - Work"
- Platform-specific suggestions

### 3. Firebase Client Tests

#### 3.1 Firebase Initialization
1. With valid config file:
   - Should initialize successfully
   - Should authenticate anonymously
   - Should return valid user ID

2. Without config file:
   - Should return error "Firebase config not found"

#### 3.2 Connection Status
Test sync status in different states:
- Not initialized → `enabled: false, connected: false`
- Initialized → `enabled: true, connected: true`
- Network error → `enabled: true, connected: false, error: <message>`

### 4. Sync Engine Tests

#### 4.1 Device Isolation
1. Set up two different device names
2. Sync data from each device
3. Verify data is written to separate paths:
   - Device 1: `/users/{userId}/devices/MacBook-Pro/usage/{date}`
   - Device 2: `/users/{userId}/devices/Work-Linux/usage/{date}`

#### 4.2 Data Aggregation
1. Create test usage data for multiple dates
2. Run sync operation
3. Verify in Firestore:
   - Daily summaries are created
   - Model breakdowns are aggregated correctly
   - Token counts match source data

#### 4.3 Sync Checkpoint
After syncing, verify checkpoint document contains:
- `deviceId`: Current device UUID
- `lastSyncTimestamp`: Recent ISO timestamp
- `syncVersion`: 1

### 5. Firebase Setup Script Tests

#### 5.1 Script Execution
```bash
node scripts/firebase-setup.js
```

**Expected Output**:
- Display project ID from config
- Show security rules
- List required indexes
- Provide Firebase Console URLs

#### 5.2 Missing Config Handling
```bash
# Remove config file
rm ~/.ccusage/firebase.json
node scripts/firebase-setup.js
```

**Expected Result**: Error message "Firebase config not found. Run 'ccusage sync init' first."

### 6. Integration Tests

#### 6.1 Full Sync Flow
1. Configure Firebase settings
2. Enable sync with device name
3. Create local usage data
4. Run sync operation
5. Verify in Firebase Console:
   - User document created
   - Device document created
   - Usage documents created with correct structure

#### 6.2 Multi-Device Aggregation
1. Set up sync on two devices
2. Create different usage data on each
3. Fetch aggregated data for a date
4. Verify totals = sum of both devices

### 7. Error Handling Tests

#### 7.1 Network Failures
- Disconnect network during sync
- Verify graceful error handling
- Verify partial data isn't corrupted

#### 7.2 Invalid Data
- Test with malformed usage data
- Verify sync skips invalid entries
- Verify valid entries still sync

### 8. Performance Tests

#### 8.1 Large Data Sync
- Create 365 days of usage data
- Measure sync time
- Verify batch operations work correctly
- Check Firebase usage stays within limits

#### 8.2 Concurrent Device Sync
- Run sync from two devices simultaneously
- Verify no data corruption
- Verify both devices complete successfully

## Test Execution Checklist

- [ ] Configuration management (save/load/update)
- [ ] Device registration and validation
- [ ] Firebase client initialization
- [ ] Basic sync operation
- [ ] Multi-device isolation
- [ ] Data aggregation accuracy
- [ ] Setup script functionality
- [ ] Error handling scenarios
- [ ] Performance under load

## Known Limitations to Test

1. Currently no CLI commands integrated (phase 1 is infrastructure only)
2. No offline queue implementation yet
3. Session and blocks aggregation not implemented
4. Real-time sync not implemented

## Success Criteria

Phase 1 is considered successful if:
1. All configuration files can be created and loaded
2. Firebase client connects and authenticates
3. Device registration works with name validation
4. Data syncs to device-isolated paths
5. Basic aggregation produces correct totals
6. Setup script provides clear instructions