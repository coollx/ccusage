# Architecture Documentation

> 🏗️ Technical deep dive into the ccusage architecture

## Overview

ccusage is built with a modular, layered architecture that separates concerns between data loading, processing, presentation, and external integrations. The system is designed to be extensible, testable, and performant.

## Core Architecture Principles

### 1. **Separation of Concerns**
- **Data Layer**: Handles JSONL parsing and data loading
- **Business Logic**: Cost calculations and data aggregation
- **Presentation Layer**: CLI commands and output formatting
- **Integration Layer**: MCP server and external services

### 2. **Functional Programming**
- Uses `@praha/byethrow` Result types for error handling
- Immutable data transformations
- Pure functions where possible

### 3. **Type Safety**
- Strict TypeScript with comprehensive type definitions
- Runtime validation with schemas
- Type guards for narrowing

## System Components

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Data Directories                  │
│  (~/.claude/projects/ and ~/.config/claude/projects/)       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Loading Layer                        │
│                   (data-loader.ts)                          │
│  • JSONL parsing with error resilience                      │
│  • Multi-directory support                                  │
│  • Schema validation                                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Processing Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ calculate-   │  │ _daily-      │  │ _session-       │  │
│  │ cost.ts      │  │ grouping.ts  │  │ blocks.ts       │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│  • Token aggregation  • Date grouping  • Block analysis    │
│  • Cost calculation   • Summaries      • Active detection  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Command Layer                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │
│  │ daily   │  │ monthly │  │ session │  │ blocks       │  │
│  │ .ts     │  │ .ts     │  │ .ts     │  │ .ts          │  │
│  └─────────┘  └─────────┘  └─────────┘  └──────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Presentation Layer                          │
│  ┌──────────────┐            ┌─────────────────────────┐   │
│  │ Table Output │            │ JSON Output             │   │
│  │ (cli-table3) │            │ (_json-output-types.ts) │   │
│  └──────────────┘            └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. **Data Loader** (`data-loader.ts`)
- **Purpose**: Load and parse usage data from JSONL files
- **Features**:
  - Multi-directory support (handles both old and new Claude paths)
  - Error-resilient parsing (skips malformed lines)
  - Schema validation for data integrity
  - Pre-calculated cost extraction

#### 2. **Cost Calculator** (`calculate-cost.ts`)
- **Purpose**: Aggregate tokens and calculate costs
- **Integration**: LiteLLM pricing database
- **Modes**:
  - `auto`: Use pre-calculated costs when available
  - `calculate`: Always calculate from tokens
  - `display`: Only use pre-calculated values

#### 3. **Command Handlers** (`commands/`)
- **Daily** (`daily.ts`): Group by date, show daily totals
- **Monthly** (`monthly.ts`): Aggregate by month
- **Session** (`session.ts`): Group by project/session
- **Blocks** (`blocks.ts`): 5-hour billing cycle analysis
- **MCP** (`mcp.ts`): Model Context Protocol server

#### 4. **Utility Modules**
- **`_types.ts`**: Core type definitions
- **`_utils.ts`**: Common utility functions
- **`_consts.ts`**: Application constants
- **`_token-utils.ts`**: Token count calculations
- **`_terminal-utils.ts`**: Terminal output helpers

### External Integrations

#### LiteLLM Integration
- **Purpose**: Model pricing data
- **Implementation**: Dynamic pricing lookup
- **Fallback**: Zero cost if model not found

#### MCP Server
- **Transport**: stdio (default) or HTTP
- **Tools Exposed**:
  - `daily`: Daily usage reports
  - `monthly`: Monthly summaries
  - `session`: Session breakdowns
  - `blocks`: Billing block analysis

## Data Structures

### Core Types

```typescript
// Raw usage data from JSONL
interface UsageData {
  model: string;
  costUSD?: number;
  provider: string;
  inputCachedTokens: number;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
  origin: string;
}

// Aggregated model breakdown
interface ModelBreakdown {
  model: string;
  provider: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  callCount: number;
}

// Session information
interface SessionInfo {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  callCount: number;
  project: string;
  session: string;
  models: ModelBreakdown[];
}
```

## Performance Considerations

### 1. **Streaming Data Processing**
- Files are read line-by-line to handle large datasets
- Malformed lines are skipped without stopping processing

### 2. **Efficient Aggregation**
- Data is aggregated in a single pass
- Uses Map/Set for O(1) lookups

### 3. **Lazy Loading**
- Commands only load data when executed
- No upfront processing overhead

## Error Handling Strategy

### 1. **Result Type Pattern**
```typescript
const result = Result.try(() => JSON.parse(line));
if (Result.isFailure(result)) {
  continue; // Skip malformed line
}
```

### 2. **Graceful Degradation**
- Missing directories are silently ignored
- Malformed data doesn't crash the application
- Unknown models default to zero cost

### 3. **User-Friendly Errors**
- Clear error messages for common issues
- Helpful suggestions for resolution

## Security Considerations

### 1. **Local Data Only**
- No network requests for usage data
- All data stays on user's machine

### 2. **Read-Only Operations**
- Never modifies Claude's data files
- No write operations to system directories

### 3. **Path Validation**
- Uses Node.js path utilities for safety
- Prevents directory traversal attacks

## Testing Architecture

### In-Source Testing
- Tests live alongside implementation
- Uses `import.meta.vitest` for test blocks
- Mock data with `fs-fixture`

### Test Coverage Areas
- Data parsing edge cases
- Cost calculation accuracy
- Command output formatting
- Multi-directory handling

## Future Architecture Considerations

### Extensibility Points
1. **New Report Types**: Add commands to `commands/`
2. **Output Formats**: Extend presentation layer
3. **Data Sources**: Modify data loader
4. **External Services**: Add to integration layer

### Planned Enhancements
- See @[docs/roadmap.md] for upcoming features
- Plugin system for custom reports
- Real-time usage monitoring
- Team usage aggregation

## Related Documentation

- @[CLAUDE.md] - Main project documentation
- @[docs/design.md] - Design philosophy
- @[docs/guide/] - User guides
- @[docs/AD_HOC_TASKS.md] - Current development tasks