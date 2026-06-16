# GOVERNANCE README

**Quote Buddy** — Enterprise-Grade Engineering Governance System

Welcome to the governance documentation. This folder contains the rules, standards, and procedures that every developer and AI assistant must follow.

---

## 📚 GOVERNANCE DOCUMENTS

### Core Governance

1. **[claude.md](../claude.md)** ⭐ **START HERE**
   - Complete engineering constitution
   - All governance rules in one place
   - 14 parts covering all aspects
   - Read this first, reference daily

### Implementation

2. **[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)**
   - 8-week rollout plan
   - Phase-by-phase execution
   - Quick wins
   - Success metrics

### Architecture

3. **[ARCHITECTURE.md](ARCHITECTURE.md)** (See claude.md Part 2)
   - Module boundaries
   - Allowed/forbidden dependencies
   - Folder structure standards
   - Anti-patterns to avoid

### Business Rules

4. **[BUSINESS_RULES.md](BUSINESS_RULES.md)**
   - Registry of all business logic
   - Where each rule is implemented
   - Test coverage for rules
   - Change process
   - Currently documents:
     - Quote calculations
     - Client validation
     - Permission rules
     - And more...

### Code Editing

5. **[Code Editing Governance](../claude.md#part-4--code-editing-governance)**
   - Pre-edit analysis workflow
   - Change classification
   - No-rewrite rules
   - Dependency management

### Testing

6. **[TESTING_ARCHITECTURE.md](TESTING_ARCHITECTURE.md)**
   - Testing strategy & pyramid
   - Unit test requirements (90%+ coverage)
   - Integration test patterns
   - E2E test guidelines
   - Fixtures & mocking
   - Performance testing
   - CI/CD integration

### Pull Requests

7. **[PR Template](../.github/pull_request_template.md)**
   - Mandatory PR structure
   - Business impact assessment
   - Architecture impact
   - Testing requirements
   - Risk assessment

### Branching

8. **[BRANCH_PROTECTION.md](BRANCH_PROTECTION.md)**
   - Git workflow (Git Flow)
   - Branch protection rules
   - Naming conventions
   - GitHub Actions integration
   - Setup instructions

### Security

9. **[Security Governance](../claude.md#part-8--security-governance)**
   - Authentication & authorization
   - Secrets management
   - Input validation
   - Data protection
   - Rate limiting

### CI/CD

10. **[CI/CD Governance](../claude.md#part-11--cicd-governance)**
    - GitHub Actions workflows
    - Pipeline architecture
    - Required status checks
    - Deployment strategy
    - Rollback procedure

### AI Governance

11. **[AI Coding Governance](../claude.md#part-5--ai-coding-governance)**
    - Rules for Claude/Copilot
    - Hallucination prevention
    - Confidence scoring
    - Unsafe edit detection
    - Mandatory human review

### Pre-Production

12. **[Pre-Production Governance](../claude.md#part-10--pre-production-governance)**
    - Staging validation
    - Automated pre-prod tests
    - Manual QA checklist
    - Performance validation
    - Data integrity checks

---

## 🚀 QUICK START

### For New Developers

1. **Read claude.md** (Parts 1-3, 15-20 min)
   - Understand core rules
   - Know forbidden practices

2. **Read code editing workflow** (Part 4, 10 min)
   - Learn how to make changes

3. **Read testing requirements** (TESTING_ARCHITECTURE.md, 10 min)
   - Understand testing standards

4. **Ask questions** if confused!

### For Code Reviewers

1. **Use PR template** (auto-enforced)
2. **Run through review checklist** (claude.md Part 6)
3. **Check business logic** (BUSINESS_RULES.md)
4. **Verify tests** (TESTING_ARCHITECTURE.md)

### For Release/DevOps

1. **Follow branch protection rules** (BRANCH_PROTECTION.md)
2. **Run CI/CD workflows** (auto-enforced)
3. **Use deployment strategies** (claude.md Part 11)
4. **Monitor production** (post-release)

### For AI Assistants (Claude, Copilot)

1. **Use feature development prompt** (claude.md Part 13.1)
2. **Use bug fixing prompt** (claude.md Part 13.2)
3. **Use testing prompt** (claude.md Part 13.3)
4. **Always verify confidence score**
5. **Submit for human review**

---

## ⚙️ GOVERNANCE SCRIPTS

### Pre-Commit Hook

```bash
# Setup pre-commit hook
cp .governance/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# Now runs automatically before each commit
# Checks: lint, types, tests
```

### Run Locally

```bash
# Full governance check
npm run check:all

# Individual checks
npm run lint              # ESLint
npm run type-check       # TypeScript
npm run test             # All tests
npm run test:coverage    # With coverage report
npm run build:check      # Build without output
```

### GitHub Actions

All checks run automatically on:
- Every PR (PR validation workflow)
- Merge to staging (staging deployment)
- Git tag (production release)

---

## 📊 ENFORCEMENT MATRIX

| Rule | Enforcement | Owner | Failure |
|------|---|---|---|
| No `any` types | ESLint | CI/CD | PR blocked |
| No console.log | ESLint | CI/CD | PR blocked |
| Tests passing | GitHub Actions | CI/CD | PR blocked |
| Coverage >80% | GitHub Actions | CI/CD | PR blocked |
| Security audit | Snyk | CI/CD | Warning |
| 2 approvals (main) | GitHub | Code owners | Merge blocked |
| 1 approval (staging) | GitHub | Code owners | Merge blocked |
| Business rules unchanged | Manual | Code reviewers | Rejection |
| Architecture respected | Manual | Architect | Rejection |

---

## 🎯 KEY METRICS

Tracked monthly:

| Metric | Target | Current |
|--------|--------|---------|
| Code coverage | >80% | ___ |
| Test pass rate | 100% | ___ |
| Architectural violations | 0 | ___ |
| Production incidents | <1/month | ___ |
| Time to fix bugs | <7 days | ___ |
| Regression rate | <1% | ___ |
| PR review time | <24h | ___ |

---

## ❓ FAQ

### Q: I'm in a hurry, do I still need to follow governance?

**A:** YES. Especially when in a hurry. Governance prevents costly mistakes.

### Q: What if I disagree with a rule?

**A:** Propose changes in the team standup. Rules are collaborative.

### Q: Can AI skip the review process?

**A:** NO. AI code is reviewed like any other code.

### Q: What if a test is flaky?

**A:** Don't skip it, fix it. Flaky tests indicate real problems.

### Q: Can I force push to main?

**A:** Only with CTO approval and documented reason. Rare emergency only.

### Q: What if branch protection blocks my merge?

**A:** Fix the issue (failing test, missing approval, etc.) then retry.

### Q: How do I report a governance issue?

**A:** Create a GitHub issue labeled `governance` in this repo.

---

## 🔗 RELATED RESOURCES

- GitHub Workflows: `.github/workflows/`
- ESLint Config: `.eslintrc.cjs`
- TypeScript Config: `tsconfig.json`
- Code Owners: `.github/CODEOWNERS`
- PR Template: `.github/pull_request_template.md`

---

## 📞 GOVERNANCE TEAM

- **Principal Engineer** [@alice] - Architecture decisions, governance updates
- **DevOps Lead** [@devops-lead] - CI/CD, deployment, infrastructure
- **Architect** [@bob] - Architecture reviews, standards
- **QA Lead** [@qa-lead] - Testing strategy, pre-production validation
- **Security** [@security] - Security reviews, vulnerability scanning

---

## 📅 GOVERNANCE REVIEWS

- **Weekly:** Team standup governance review
- **Monthly:** Metrics review & adjustments
- **Quarterly:** Full governance audit
- **Annually:** Comprehensive review & updates

---

## 🎓 TRAINING

### Onboarding

New developers receive:
1. Governance orientation (1 hour)
2. claude.md walkthrough (30 min)
3. Code review guidelines (30 min)
4. Pair programming (2 hours)

### Ongoing

Monthly training sessions:
- New patterns
- Lessons learned
- Best practices
- Tool updates

---

## 📝 GOVERNANCE VERSION

**Current Version:** 1.0.0  
**Last Updated:** May 18, 2026  
**Next Review:** August 18, 2026  

See git history for change log:
```bash
git log --oneline -- claude.md .governance/
```

---

## ✅ GOVERNANCE CHECKLIST

Before every commit:

- [ ] Read and understand governance
- [ ] Analyze code before writing
- [ ] Reuse existing code when possible
- [ ] Write tests first
- [ ] Run pre-commit hooks
- [ ] No `any` types
- [ ] No console.log
- [ ] Business logic protected
- [ ] Architecture respected
- [ ] Ready for review

---

## 🚨 GOVERNANCE VIOLATIONS

Caught in violations?

1. **First time** — Friendly reminder + guidance
2. **Second time** — More structured review required
3. **Third time** — Pair programming requirement
4. **Pattern** — Escalate to leadership

Goal: Help developers succeed, not punish.

---

## 🎯 MISSION

> **We build software that works. That scales. That lasts.**
> 
> Governance enables this through:
> - Clear standards everyone understands
> - Automation that catches mistakes early
> - Collaboration through code review
> - Continuous improvement
> - Accountability for quality
> 
> **Governance isn't overhead. Governance is speed.**

---

## Questions?

- Check `claude.md` for detailed answers
- Ask in #engineering Slack channel
- DM @principal-engineer
- Create GitHub issue

**We're all building this together.** ✌️
