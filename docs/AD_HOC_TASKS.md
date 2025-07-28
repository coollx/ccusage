# AD_HOC_TASKS

> 📝 Lightweight task tracking for ccusage development

This file serves as a simple, version-controlled task list for ongoing development work. Tasks here are informal and can be quickly added/removed as needed.

## Active Tasks

### 🔴 High Priority

- [ ] **Cloud Sync Implementation Phase 4** - Security and Privacy features @[docs/tasks/001-cloud-sync-feature.md]
- [ ] **Fix ESLint type safety warnings** - Many unsafe type assignments in cloud-sync module
- [ ] **Fix token calculation for cached tokens** - Some models show incorrect cached token counts
- [ ] **Add retry logic for file reads** - Handle temporary file access issues gracefully
- [ ] **Optimize large dataset performance** - Reports slow down with >100k records

### 🟡 Medium Priority

- [ ] **Add `--last-n-days` filter** - Allow filtering reports to recent days
- [ ] **Implement progress bar for long operations** - Show progress when processing large datasets
- [ ] **Add model aliasing** - Map similar model names (e.g., claude-3-opus → claude-opus)
- [ ] **Create usage summary email template** - Markdown template for weekly reports

### 🟢 Low Priority

- [ ] **Add fun stats** - "You've written War and Peace 3.2 times in tokens!"
- [ ] **Terminal width detection** - Responsive table sizing
- [ ] **Add `--quiet` mode** - Minimal output for scripting
- [ ] **Easter eggs** - Hidden features for fun

## In Progress

### Currently Working On

- [ ] **@alice**: Refactoring cost calculation engine
- [ ] **@bob**: Adding CSV export format
- [ ] **@carol**: Improving error messages

## Completed This Week

### ✅ Done

- [x] ~~Update CLAUDE.md with navigation~~ - Added cross-references and TOC
- [x] ~~Create architecture documentation~~ - Technical deep dive complete
- [x] ~~Design philosophy document~~ - UX principles documented
- [x] ~~Project roadmap~~ - Future vision outlined
- [x] ~~Revise cloud sync design~~ - No daemon, focus on historical aggregation, clean live UI
- [x] ~~Cloud Sync Phase 3 Implementation~~ - Real-time sync, offline support, unified sync engine complete

## Ideas & Research

### 💡 Under Consideration

- **Real-time usage notifications** - Desktop notifications for milestones
- **Usage patterns ML model** - Predict future usage based on history
- **Team leaderboards** - Gamify efficient token usage
- **Integration with cost management tools** - Export to Quickbooks, etc.

### 🔬 Research Topics

- **WebAssembly for performance** - Could WASM speed up aggregations?
- **Streaming JSON parsing** - Better memory efficiency for huge files
- **Compression for old data** - Automatic archival of old usage data
- **P2P usage sharing** - Share anonymized usage patterns

## Bug Reports

### 🐛 Known Issues

1. **Unicode in project names** - Special characters cause display issues
2. **Timezone edge cases** - Sessions spanning midnight show incorrect dates
3. **Memory usage with --watch** - Continuous monitoring slowly leaks memory

## Quick Wins

### 🎯 Easy Improvements

- [ ] Add more emoji to success messages
- [ ] Improve `--help` descriptions
- [ ] Add common examples to README
- [ ] Create animated demo GIF
- [ ] Add "did you know?" tips

## Tech Debt

### 🏗️ Refactoring Needed

- [ ] Split `data-loader.ts` into smaller modules
- [ ] Add more comprehensive error types
- [ ] Improve test coverage for edge cases
- [ ] Standardize logging approach
- [ ] Clean up type definitions

## Documentation Tasks

### 📚 Docs To Write

- [ ] Migration guide from v14 to v15
- [ ] Troubleshooting guide
- [ ] Performance tuning guide
- [ ] Integration examples
- [ ] Video tutorials

## Community Requests

### 👥 From Users

1. **Docker image** - Official containerized version
2. **GitHub Action** - Usage reporting in CI/CD
3. **Slack integration** - Daily summaries in Slack
4. **Budget alerts** - Notifications when approaching limits
5. **Multi-currency support** - Show costs in EUR, GBP, etc.

## Maintenance Tasks

### 🔧 Regular Upkeep

- [ ] Update dependencies (monthly)
- [ ] Review and close stale issues
- [ ] Update model pricing data
- [ ] Benchmark performance regression
- [ ] Security audit

## Notes

### 📌 Important Reminders

- Always run tests before merging
- Update CHANGELOG.md for user-facing changes
- Consider backward compatibility
- Add docs for new features
- Keep accessibility in mind

### 🔗 Useful Links

- [LiteLLM Pricing](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- [Claude API Docs](https://docs.anthropic.com)
- [Gunshi Framework](https://gunshi.dev)
- [Project Issues](https://github.com/Wordbrahma/ccusage/issues)

## How to Use This File

1. **Add tasks** anywhere they fit
2. **Check off** completed items with [x]
3. **Move** completed tasks to "Completed This Week" section
4. **Clean up** weekly by archiving old completed tasks
5. **Review** in team meetings or async

---

*Last cleanup: 2025-07-26*
*Next cleanup due: 2025-08-02*