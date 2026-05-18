#!/bin/bash

# ================================================================
# Quote Buddy — Pre-Commit Hook
# ================================================================
# Runs before each commit to enforce governance rules
# Prevents committing code that violates:
# - TypeScript compilation
# - ESLint rules
# - Type safety
# - Test coverage
#
# INSTALL: Copy this to .git/hooks/pre-commit
# chmod +x .git/hooks/pre-commit

set -e

echo "🔍 Running pre-commit hooks..."

# 1. LINT CHECK
echo "📋 Checking linting..."
if ! npm run lint --fix > /dev/null 2>&1; then
  echo "❌ Linting failed. Fix errors and commit again."
  npm run lint
  exit 1
fi

# 2. TYPE CHECK
echo "🔎 Checking TypeScript types..."
if ! npx tsc --noEmit > /dev/null 2>&1; then
  echo "❌ Type check failed. Fix type errors and commit again."
  npx tsc --noEmit
  exit 1
fi

# 3. BUILD CHECK
echo "🏗️  Checking build..."
if ! npm run build:check > /dev/null 2>&1; then
  echo "❌ Build check failed. Fix errors and commit again."
  exit 1
fi

# 4. FORMAT CHECK
echo "✨ Checking code format (Prettier)..."
if ! npm run format:check > /dev/null 2>&1; then
  echo "⚠️  Auto-formatting code..."
  npm run format
  echo "✅ Code formatted. Please review and commit again."
  exit 1
fi

# 5. TEST CHECK
echo "🧪 Running unit tests..."
if ! npm test > /dev/null 2>&1; then
  echo "❌ Tests failed. Fix failing tests and commit again."
  npm test
  exit 1
fi

# 6. SECURITY CHECK - No hardcoded secrets
echo "🔐 Checking for hardcoded secrets..."
if grep -r "API_KEY\|password\|secret" src/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v "mock"; then
  echo "⚠️  WARNING: Possible hardcoded secrets detected"
  echo "   Make sure secrets are in environment variables"
fi

# 7. NO CONSOLE.LOG IN NON-TEST CODE
echo "📝 Checking for console.log statements..."
if grep -r "console\.log" src/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v "mock"; then
  echo "❌ console.log statements found in non-test code"
  exit 1
fi

# 8. NO DEBUGGER STATEMENTS
echo "🐛 Checking for debugger statements..."
if grep -r "debugger" src/ --include="*.ts" --include="*.tsx" | grep -v "test"; then
  echo "❌ debugger statements found in source code"
  exit 1
fi

# 9. NO 'any' TYPES
echo "🔍 Checking for 'any' types..."
if grep -r ": any\|as any" src/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v "mock"; then
  echo "⚠️  WARNING: 'any' types found (should use proper types)"
fi

echo ""
echo "✅ All pre-commit checks passed!"
echo "   Ready to commit."
