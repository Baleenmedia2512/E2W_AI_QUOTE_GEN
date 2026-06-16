---
name: Standard PR (Use This Template)
about: Create a pull request with full governance
title: "[CHANGE_TYPE] Brief description of change"
labels: ['review-needed']
---

## 📋 CHANGE DESCRIPTION

### What is the business change?
<!-- Describe what users will experience. How does this improve the product? -->

### What is the technical change?
<!-- Describe the code-level changes. What modules were changed? -->

### Why is this change needed?
<!-- Link to issue, business requirement, or bug report -->
Fixes #[issue_number] or relates to [requirement]

---

## 📊 BUSINESS IMPACT

### Which user workflows are affected?
- [ ] Quote creation / editing
- [ ] PDF upload / viewing
- [ ] Client management
- [ ] PDF export / sharing
- [ ] AI quote generation
- [ ] Authentication / authorization
- [ ] Company information
- [ ] Other: _______________

### Is this a breaking change?
- [ ] YES — Explain impact and migration path
- [ ] NO

**If YES, describe:**
- What breaks?
- How do users migrate?
- Do we provide backward compatibility?

### Backward compatibility
- [ ] MAINTAINED — All existing features work as before
- [ ] COMPROMISED — See migration notes

---

## 🏗️ ARCHITECTURE IMPACT

### Architecture changes?
- [ ] YES — Describe below
- [ ] NO

**If YES, describe:**
- What modules are affected?
- Are module boundaries preserved?
- Any new dependencies between layers?

### Module boundaries
- [ ] All boundaries respected (Services → Store → Components)
- [ ] Business logic in services only
- [ ] Components are dumb (UI only)
- [ ] Store is pure state management

### Database schema changes?
- [ ] YES — Include migration strategy
- [ ] NO

**If YES, provide:**
- Schema before/after
- Migration SQL
- Backward compatibility approach
- Rollback procedure

### New dependencies added?
- [ ] YES — Explain decision below
- [ ] NO

**If YES:**
- Which package(s)?
- Why is it necessary?
- Security scan results? ✅ / ⚠️ / ❌
- NPM download stats? (quality indicator)
- Maintenance status? (Active/Maintained/Abandoned)

---

## 💻 CODE CHANGES

### What files changed?
<!-- List the main files modified -->
```
src/services/quoteService.ts      (+45 lines, -10 lines)
src/components/QuoteForm.tsx      (+30 lines)
tests/quoteService.test.ts        (+50 lines)
```

### Existing code reuse?
- [ ] YES — Leveraged existing functions/patterns
- [ ] NO — Created new implementations
- [ ] PARTIAL — Mix of both

**If NO or PARTIAL, explain why:**

### Duplicate logic detected?
- [ ] NO — No duplicate logic
- [ ] YES — Describe consolidation plan

**If YES, plan to consolidate:**

### Patterns consistent?
- [ ] YES — Followed existing patterns
- [ ] NO — Explain deviation and justification

**If NO:**
- What's different?
- Why the exception?
- Approval from architect?

### Code quality
- [ ] No `any` types (strict TypeScript)
- [ ] No console.log statements
- [ ] No commented-out code blocks
- [ ] Error handling complete
- [ ] Proper error messages
- [ ] No hardcoded values

---

## ✅ TESTING

### Unit tests added?
- [ ] YES — Coverage: ____%
- [ ] NO — Explain why

### Integration tests added?
- [ ] YES
- [ ] NO

### E2E tests added?
- [ ] YES
- [ ] NO

### Manual testing done?
- [ ] YES — Test steps documented below
- [ ] NO

**Test steps (if manual testing):**
1. Step 1...
2. Step 2...
3. Expected result...

### Tests passing locally?
- [ ] YES — All green ✅
- [ ] NO — Failures listed below

**If NO, failures:**

### Coverage requirement met (>80%)?
- [ ] YES — Final coverage: ____%
- [ ] NO — Current coverage: ____%

### Edge cases covered?
- [ ] Empty input (no items, no data)
- [ ] Null/undefined values
- [ ] Boundary conditions (0, max size)
- [ ] Error cases (API fails, invalid data)
- [ ] Concurrent operations (race conditions)
- [ ] Large data sets (performance)

---

## 🚀 PRE-DEPLOYMENT CHECKLIST

- [ ] Code compiles: `npm run build:check` ✅
- [ ] Linting passes: `npm run lint` ✅
- [ ] Type checking passes: `npx tsc --noEmit` ✅
- [ ] All tests pass: `npm test` ✅
- [ ] Coverage >80%: ✅
- [ ] No console.log statements
- [ ] No commented-out code blocks
- [ ] No hardcoded secrets/API keys
- [ ] Error handling complete
- [ ] TypeScript types complete (no `any`)
- [ ] Documentation updated
- [ ] CHANGELOG updated (if user-facing)
- [ ] Migration scripts created (if DB change)
- [ ] Rollback plan documented (if needed)

---

## ⚠️ RISK ASSESSMENT

### Regression risk?
- [ ] LOW — Changes isolated, no cascading effects
- [ ] MEDIUM — Affects related features, comprehensive testing done
- [ ] HIGH — Major changes, extensive testing required

**Justification:**

### Security risk?
- [ ] LOW — No security implications
- [ ] MEDIUM — Changed auth/permissions, security review done
- [ ] HIGH — Security-critical change, escalation needed

**Justification:**

### Performance impact?
- [ ] NONE — No performance changes
- [ ] LOW — <5% impact
- [ ] MEDIUM — 5-20% impact
- [ ] HIGH — >20% impact

**Justification:**

### Data integrity risk?
- [ ] LOW — No data changes
- [ ] MEDIUM — Data modified, migrations tested
- [ ] HIGH — Schema changes, backup required

**Justification:**

---

## 👥 REVIEW CHECKLIST

### Code review approved?
- [ ] 2 reviewers approved (standard changes)
- [ ] 1 reviewer approved (minor changes)
- [ ] Architect review completed (if needed)

### Architecture review approved?
- [ ] Not needed
- [ ] Approved by architect
- [ ] Pending architect review

### Security review approved?
- [ ] Not needed
- [ ] Approved by security team
- [ ] Pending security review

### Product sign-off?
- [ ] Not needed
- [ ] Approved by product
- [ ] Pending product approval

### Checklist for reviewers:
- [ ] No breaking changes to public APIs
- [ ] All TODOs addressed
- [ ] Meaningful test coverage
- [ ] Business logic properly implemented
- [ ] Error cases handled
- [ ] Performance acceptable

---

## 🔄 DEPLOYMENT PLAN

### Environment?
- [ ] Dev/Staging
- [ ] Production

### Deployment strategy?
- [ ] Direct deploy (standard)
- [ ] Blue-green deploy (large changes)
- [ ] Canary deploy (% rollout)
- [ ] Feature flag (behind flag)

**Why this strategy?**

### Monitoring?
What metrics will you watch after deployment?
- Quote creation success rate
- API response times
- Error rate
- User engagement

### Rollback trigger?
If X happens, rollback immediately:
- Error rate >1%
- Performance degradation >20%
- User-facing errors
- Data corruption

---

## 🎯 RELATED ISSUES

Fixes: #[issue]  
Relates to: #[related_issue]  
Blocks: #[blocking_issue]  

---

## 📝 ADDITIONAL NOTES

<!-- Any additional context, concerns, or notes? -->

---

## ✨ READY FOR MERGE?

- [ ] All checks passing
- [ ] No merge conflicts
- [ ] PR title is descriptive
- [ ] PR description complete
- [ ] Required approvals received
- [ ] Branch is up to date

**IMPORTANT:** Do not merge without approval from required reviewers.

---

**Created:** <!-- Add date -->  
**Last Updated:** <!-- Update if making changes -->  
**Reviewed By:** <!-- Add reviewer names -->
