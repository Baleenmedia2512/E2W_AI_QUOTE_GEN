# BRANCH PROTECTION CONFIGURATION

This file documents the branch protection rules for Quote Buddy.

**These rules should be configured in GitHub Settings → Branches → Branch Protection Rules**

---

## MAIN BRANCH (Production)

### Require Pull Request Reviews

- ✅ **Require pull request reviews before merging**: YES
- ✅ **Required number of reviewers before merge**: 2
- ✅ **Dismiss stale pull request approvals when new commits are pushed**: YES
- ✅ **Require review from code owners**: YES
- ✅ **Restrict who can push to matching branches**: Admins only

### Require Status Checks to Pass

- ✅ **Require status checks to pass before merging**: YES
- ✅ **Require branches to be up to date before merging**: YES

**Required checks:**
- TypeScript Build Check
- ESLint Linting
- Unit Tests
- Integration Tests
- Coverage (>80%)
- Security Audit
- Dependency Audit

### Other Requirements

- ✅ **Require signed commits**: YES
- ✅ **Require conversation resolution before merging**: YES
- ✅ **Include administrators**: YES (admins follow same rules)
- ✅ **Restrict who can push to matching branches**: Admins + DevOps only

### Enforcement

- ⚠️ Do NOT allow force pushes (maintain audit trail)
- ⚠️ Do NOT allow deletion (prevent accidents)

---

## STAGING BRANCH (Pre-Production)

### Require Pull Request Reviews

- ✅ **Require pull request reviews before merging**: YES
- ✅ **Required number of reviewers before merge**: 1
- ✅ **Dismiss stale pull request approvals when new commits are pushed**: YES
- ✅ **Require review from code owners**: YES

### Require Status Checks to Pass

- ✅ **Require status checks to pass before merging**: YES
- ✅ **Require branches to be up to date before merging**: YES

**Required checks:**
- TypeScript Build Check
- ESLint Linting
- Unit Tests
- Integration Tests
- Coverage (>80%)
- Security Audit

### Other Requirements

- ✅ **Require signed commits**: NO (development branch)
- ✅ **Require conversation resolution before merging**: YES
- ✅ **Include administrators**: YES

---

## DEVELOP BRANCH (Integration)

### Require Pull Request Reviews

- ✅ **Require pull request reviews before merging**: YES
- ✅ **Required number of reviewers before merge**: 1
- ✅ **Dismiss stale pull request approvals when new commits are pushed**: YES
- ✅ **Require review from code owners**: YES

### Require Status Checks to Pass

- ✅ **Require status checks to pass before merging**: YES
- ✅ **Require branches to be up to date before merging**: YES

**Required checks:**
- TypeScript Build Check
- ESLint Linting
- Unit Tests
- Coverage (>70%)

### Other Requirements

- ✅ **Require signed commits**: NO
- ✅ **Require conversation resolution before merging**: YES

---

## FEATURE/* BRANCHES (Feature Development)

- ❌ **No protection** (developers can force push locally)
- ❌ **Only protected when PR is created** (becomes staging/develop PR)

---

## GitHub Actions Configuration

### Protect Against Unreviewed Deployments

Add this workflow to prevent direct pushes:

```yaml
name: Prevent Direct Push to Main

on:
  push:
    branches: [main]

jobs:
  prevent:
    runs-on: ubuntu-latest
    steps:
      - name: Fail if Direct Push
        run: |
          echo "❌ Direct push to main is not allowed"
          echo "Please create a PR to staging first"
          exit 1
```

---

## Setting Up Branch Protection via GitHub CLI

```bash
# Main branch - most restrictive
gh repo rule create \
  --branch main \
  --required-reviews 2 \
  --required-signatures \
  --require-status-checks \
  --status-checks 'TypeScript Build Check' 'ESLint' 'Tests' \
  --dismiss-stale-reviews \
  --require-code-owner-review

# Staging branch - moderate
gh repo rule create \
  --branch staging \
  --required-reviews 1 \
  --require-status-checks \
  --status-checks 'TypeScript Build Check' 'ESLint' 'Tests' \
  --dismiss-stale-reviews

# Develop branch - flexible
gh repo rule create \
  --branch develop \
  --required-reviews 1 \
  --require-status-checks \
  --status-checks 'TypeScript Build Check' 'ESLint' 'Tests'
```

---

## Manual Setup (GitHub Web UI)

### Step 1: Navigate to Settings

1. Go to Repository → Settings
2. Click "Branches" in left sidebar
3. Under "Branch protection rules", click "Add rule"

### Step 2: Create Rule for `main`

1. **Branch name pattern**: `main`
2. Under "Protect matching branches":
   - ✅ Require a pull request before merging
     - ✅ Require 2 approvals
     - ✅ Dismiss stale approvals
     - ✅ Require code owner review
   - ✅ Require status checks to pass
     - Select all checks from .github/workflows/
   - ✅ Require branches to be up to date
   - ✅ Require signed commits
   - ✅ Require conversation resolution
   - ✅ Include administrators

3. Click "Create"

### Step 3: Create Rule for `staging`

Repeat with: pattern `staging`, 1 reviewer (not 2)

### Step 4: Create Rule for `develop`

Repeat with: pattern `develop`, 1 reviewer

---

## Enforcement Rules

### Enforce on Admins?

YES - Even admins should follow process:

1. Create a PR
2. Get required approvals
3. Pass all checks
4. Merge normally

**No bypass merges allowed.**

### Force Push Exception?

RARELY. Only if:

1. Revert a bad merge
2. Rebase develop (planned downtime)
3. CTO-approved emergency

When force pushing:
1. Notify team in Slack
2. Document reason
3. Update commit history

### Manual Override?

NEVER in normal circumstances:

- NO "Dismiss reviews and push anyway"
- NO "Bypass protection rules"
- NO "Force push without review"

If absolutely necessary:
1. CTO approval required
2. Document in GitHub issue
3. Revert process within 1 hour

---

## Bypass Scenarios (Rare)

### Emergency Production Hotfix

Process:
1. Create hotfix branch from main
2. Normal PR process to main
3. If tests slow down: emergency escalation
4. CTO verifies correctness
5. Manual approval (last resort)
6. Always followed by full validation

### Critical Security Vulnerability

Process:
1. Private security fix branch
2. Test locally first
3. CTO + Security lead review
4. Manual approval if needed
5. Deploy with full monitoring

---

## Monitoring Branch Protection

### Check Protection Status

```bash
# List all protection rules
gh repo rule list

# Check specific branch
gh repo rule list --branch main
```

### Audit Log

GitHub maintains audit log of:
- All bypasses
- All force pushes
- All manual approvals
- Who did what when

Monitor in Settings → Audit log

---

## Team Communication

When setting up protection rules:

```markdown
Dear Team,

We're implementing branch protection rules to ensure code quality and reliability.

## Key Changes:

- `main`: Requires 2 approvals + all tests passing
- `staging`: Requires 1 approval + all tests passing
- `develop`: Requires 1 approval + tests

## What This Means:

✅ PRs must have:
  - 2 reviewers (main) or 1 (staging/develop)
  - All GitHub Actions passing
  - Signed commits (main only)
  - No merge conflicts

❌ NOT allowed:
  - Direct commits to main/staging/develop
  - Bypassing reviews
  - Merging failing tests
  - Force pushes (unless emergency)

## Help:

1. Create feature branch: `git checkout -b feature/description`
2. Make changes and commit
3. Push and create PR
4. Get approvals
5. Merge when all checks pass

Questions? Ask #engineering
```

---

## Rollback if Needed

If protection rules cause issues:

1. **Disable temporarily** (Settings → Branches)
2. **Resolve issue** (e.g., fix failing test)
3. **Re-enable rules**
4. **Post-mortem** (what broke?)

Temporary disable should take <30 minutes.

---

## Integration with CI/CD

Branch protection rules trigger GitHub Actions.

Workflow:
1. PR created
2. Workflows run automatically
3. Results appear on PR
4. If passing: reviewers can approve
5. If failing: must fix
6. Once approved + passing: merge enabled

## Protecting Against Race Conditions

"Require branches to be up to date" setting means:

- Feature branch pulled from main
- Someone else merges to main
- Your branch is now stale
- Must rebase before merge

This prevents race conditions.

---

## Regular Audits

Check branch protection status weekly:

```bash
# List branches with protection
gh repo rule list

# Verify all required checks are there
gh workflow list
```

Update rules if:
- New required checks added
- Tests renamed
- Reviewer count changes
- Security requirements updated

---

## Questions?

See: `claude.md` — PART 6: Pull Request Governance
See: `claude.md` — PART 7: Branching Strategy
