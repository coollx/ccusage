# Design Philosophy

> 🎨 Core design principles and user experience philosophy for ccusage

## Overview

ccusage is designed with a clear philosophy: empower developers to understand and optimize their Claude Code usage through intuitive, fast, and privacy-focused tools. Every design decision reflects our commitment to developer experience and data ownership.

## Core Design Principles

### 1. 🏠 **Local-First Architecture**

**Principle**: Your data never leaves your machine unless you explicitly choose to share it.

**Implementation**:
- All processing happens locally
- No telemetry or analytics collection
- No external API calls for core functionality
- Data directories are read-only operations

**Benefits**:
- Complete privacy and security
- No internet dependency for basic usage
- Instant response times
- Full data ownership

### 2. ⚡ **Performance as a Feature**

**Principle**: Speed is not optional—it's a core feature.

**Design Choices**:
- Stream processing for large datasets
- Single-pass aggregation algorithms
- Minimal dependencies for fast startup
- Efficient data structures (Maps, Sets)

**Target Metrics**:
- < 100ms for daily reports
- < 500ms for monthly aggregations
- < 1s for full session analysis
- Handles 1M+ records gracefully

### 3. 🎯 **Progressive Disclosure**

**Principle**: Show the right information at the right time.

**Information Hierarchy**:
1. **Summary First**: Total cost and token counts
2. **Breakdown Second**: Per-model usage details
3. **Details on Demand**: Session-level granularity
4. **Raw Data Access**: JSON export for power users

**Command Structure**:
```bash
# Simple: Just what I need
ccusage daily

# Detailed: More information
ccusage daily --json

# Specific: Filtered view
ccusage blocks --active
```

### 4. 🔧 **Composable Tools**

**Principle**: Small, focused tools that work well together.

**Unix Philosophy**:
- Each command does one thing well
- Commands can be piped and composed
- Output formats support automation
- Clear, predictable interfaces

**Examples**:
```bash
# Compose with other tools
ccusage daily --json | jq '.totalCost'
ccusage monthly | grep "Opus"
ccusage session --json > usage-report.json
```

### 5. 🎨 **Beautiful by Default**

**Principle**: Terminal output should be clear, colorful, and delightful.

**Visual Design**:
- **Color Coding**: 
  - 🟢 Green for costs under budget
  - 🟡 Yellow for warnings
  - 🔴 Red for high usage
  - 🔵 Blue for informational
- **Table Formatting**: Aligned, readable columns
- **Number Formatting**: Thousands separators, proper decimals
- **Progress Indicators**: Live updates for long operations

### 6. 🤝 **Developer-Centric UX**

**Principle**: Built by developers, for developers.

**Key Features**:
- **Memorable Commands**: Intuitive naming (daily, monthly, session)
- **Helpful Errors**: Clear messages with solutions
- **Smart Defaults**: Sensible out-of-the-box behavior
- **Power User Features**: JSON output, custom modes, filtering

**Error Message Example**:
```
❌ No Claude data found in ~/.config/claude/projects/

💡 Suggestions:
1. Make sure Claude Code is installed
2. Check if you have a different data directory
3. Set CLAUDE_CONFIG_DIR environment variable
```

## User Experience Patterns

### 1. **Immediate Value**

Users should get value within seconds of installation:
```bash
# Install
npm install -g ccusage

# Immediate insight
ccusage daily
```

### 2. **Progressive Learning**

Start simple, discover advanced features naturally:
- Basic: `ccusage daily`
- Intermediate: `ccusage daily --json`
- Advanced: `ccusage blocks --active --token-limit max`

### 3. **Contextual Help**

Help is always one flag away:
- `ccusage --help`: General help
- `ccusage daily --help`: Command-specific help
- Error messages include next steps

## Visual Language

### Color Palette

```
Primary Colors:
- Blue (#0969da): Headers, links
- Green (#1a7f37): Success, low costs
- Yellow (#9a6700): Warnings, medium costs
- Red (#cf222e): Errors, high costs

Accent Colors:
- Purple (#8250df): Special features
- Cyan (#1b7c83): Information
- Gray (#6e7781): Muted text
```

### Typography

- **Headers**: Bold, larger size
- **Numbers**: Monospace for alignment
- **Emphasis**: Color over styling
- **Tables**: Clean borders, proper spacing

### Icons and Symbols

Strategic use of Unicode symbols:
- 📊 Analytics and reports
- 💰 Cost information
- 🔄 Active/ongoing
- ✓ Completed/success
- ⚠️ Warnings
- ❌ Errors

## Interaction Principles

### 1. **Fail Gracefully**

Never crash, always provide useful feedback:
- Missing data → Show empty state
- Malformed data → Skip and continue
- Unknown models → Default to zero cost

### 2. **Respect User Time**

Every interaction should be fast and purposeful:
- No unnecessary prompts
- No loading spinners under 100ms
- Batch operations when possible
- Cache expensive computations

### 3. **Predictable Behavior**

Consistency across all commands:
- Same flags work everywhere (`--json`, `--help`)
- Similar output structures
- Consistent error handling
- Predictable data formats

## Accessibility Considerations

### Terminal Accessibility

- **Color-Blind Friendly**: Never rely on color alone
- **Screen Reader Compatible**: Structured output
- **Keyboard Navigation**: Full keyboard support
- **High Contrast**: Clear text visibility

### Output Formats

- **Plain Text**: Always available
- **Structured Data**: JSON for programmatic access
- **Table Format**: Aligned for readability
- **Markdown Export**: Documentation-ready

## Design Anti-Patterns

What we consciously avoid:

### 1. ❌ **Feature Creep**
- No kitchen sink approach
- Each feature must justify its existence
- Prefer depth over breadth

### 2. ❌ **Configuration Overload**
- Smart defaults over configuration
- Environment variables for advanced users
- No complex config files

### 3. ❌ **Data Lock-In**
- Always provide export options
- Use standard formats (JSON)
- No proprietary data structures

### 4. ❌ **Surprise Behavior**
- No automatic updates
- No background processes
- No hidden network calls

## Future Design Directions

### Enhanced Visualizations
- Terminal-based charts and graphs
- Sparklines for trends
- Heat maps for usage patterns

### Interactive Experiences
- TUI (Terminal UI) mode
- Real-time filtering
- Keyboard-driven navigation

### Adaptive Interfaces
- Detect terminal capabilities
- Responsive table widths
- Smart truncation

## Design Decision Examples

### Why Tables Over Charts?

**Decision**: Use formatted tables instead of ASCII charts

**Rationale**:
- Tables are more accessible
- Exact numbers are often needed
- Better for copy/paste workflows
- Charts can be added as progressive enhancement

### Why JSON as Secondary Format?

**Decision**: Default to pretty tables, offer JSON via flag

**Rationale**:
- Humans read tables better
- Machines prefer JSON
- Supports both use cases
- Follows Unix philosophy

### Why No Configuration File?

**Decision**: Use command flags and environment variables

**Rationale**:
- Zero-config experience
- Easier to understand
- No hidden state
- Portable commands

## Related Documentation

- @[CLAUDE.md] - Main project documentation
- @[docs/architecture.md] - Technical implementation
- @[docs/roadmap.md] - Future vision
- @[docs/AD_HOC_TASKS.md] - Current design tasks