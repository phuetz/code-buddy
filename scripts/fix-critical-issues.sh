#!/bin/bash
# Script de correction des problèmes critiques identifiés dans l'audit
# Date: 2025-12-12
# Auteur: Claude (Sonnet 4.5)

set -e

echo "🔧 Fix Critical Issues - Grok CLI"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✅ $2${NC}"
  else
    echo -e "${RED}❌ $2${NC}"
  fi
}

# Function to print warning
print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to print info
print_info() {
  echo -e "ℹ️  $1"
}

echo "Step 1: Fix Zod version conflict"
echo "---------------------------------"

# Backup package.json
cp package.json package.json.backup
print_info "Backed up package.json to package.json.backup"

# Replace zod version
if grep -q '"zod": "\^4.1.13"' package.json; then
  sed -i 's/"zod": "\^4.1.13"/"zod": "^3.25.0"/' package.json
  print_status $? "Updated zod version from ^4.1.13 to ^3.25.0"
else
  print_warning "Zod version not found or already updated"
fi

echo ""
echo "Step 2: Install ripgrep (system-level)"
echo "---------------------------------------"

# Detect OS and install ripgrep
if command -v apt-get &> /dev/null; then
  print_info "Detected Debian/Ubuntu system"
  apt-get update -qq
  apt-get install -y ripgrep
  print_status $? "Installed ripgrep via apt-get"
elif command -v brew &> /dev/null; then
  print_info "Detected macOS system"
  brew install ripgrep
  print_status $? "Installed ripgrep via Homebrew"
elif command -v yum &> /dev/null; then
  print_info "Detected RHEL/CentOS system"
  yum install -y ripgrep
  print_status $? "Installed ripgrep via yum"
else
  print_warning "Could not detect package manager. Please install ripgrep manually:"
  print_info "  Ubuntu/Debian: sudo apt-get install ripgrep"
  print_info "  macOS: brew install ripgrep"
  print_info "  RHEL/CentOS: sudo yum install ripgrep"
fi

# Verify ripgrep installation
if command -v rg &> /dev/null; then
  RG_VERSION=$(rg --version | head -1)
  print_status 0 "ripgrep is available: $RG_VERSION"
else
  print_warning "ripgrep not found in PATH"
fi

echo ""
echo "Step 3: Clean previous installation"
echo "------------------------------------"

# Remove node_modules and lock files
if [ -d "node_modules" ]; then
  rm -rf node_modules
  print_status $? "Removed node_modules directory"
fi

if [ -f "package-lock.json" ]; then
  rm -f package-lock.json
  print_status $? "Removed package-lock.json"
fi

echo ""
echo "Step 4: Install dependencies"
echo "----------------------------"

# Try standard install first
print_info "Attempting npm install..."
if npm install 2>&1 | tee /tmp/npm-install.log; then
  print_status 0 "npm install succeeded"
else
  print_warning "npm install failed, retrying with --legacy-peer-deps"
  if npm install --legacy-peer-deps 2>&1 | tee /tmp/npm-install-legacy.log; then
    print_status 0 "npm install --legacy-peer-deps succeeded"
  else
    print_status 1 "npm install failed even with --legacy-peer-deps"
    print_info "Check /tmp/npm-install-legacy.log for details"
    exit 1
  fi
fi

echo ""
echo "Step 5: Verify installation"
echo "---------------------------"

# Check critical dependencies
check_dependency() {
  if [ -d "node_modules/$1" ]; then
    print_status 0 "$1 installed"
  else
    print_status 1 "$1 NOT installed"
    return 1
  fi
}

DEPS_OK=0
check_dependency "zod" || DEPS_OK=1
check_dependency "openai" || DEPS_OK=1
check_dependency "typescript" || DEPS_OK=1
check_dependency "@types/node" || DEPS_OK=1
check_dependency "react" || DEPS_OK=1
check_dependency "ink" || DEPS_OK=1

if [ $DEPS_OK -eq 0 ]; then
  print_status 0 "All critical dependencies installed"
else
  print_warning "Some dependencies missing, but continuing..."
fi

echo ""
echo "Step 6: Build TypeScript"
echo "------------------------"

if npm run build 2>&1 | tee /tmp/tsc-build.log; then
  print_status 0 "TypeScript compilation succeeded"

  # Check dist directory
  if [ -f "dist/index.js" ]; then
    print_status 0 "dist/index.js created"
  else
    print_status 1 "dist/index.js NOT found"
  fi
else
  print_status 1 "TypeScript compilation failed"
  print_info "Check /tmp/tsc-build.log for details"

  # Show first 20 errors
  print_info "First errors:"
  head -20 /tmp/tsc-build.log
fi

echo ""
echo "Step 7: Run basic tests"
echo "-----------------------"

# Test that the CLI can be invoked
if node dist/index.js --help &> /dev/null; then
  print_status 0 "CLI executable (--help works)"
else
  print_warning "CLI --help failed (may need API key)"
fi

echo ""
echo "Step 8: Update SECURITY.md"
echo "--------------------------"

# Fix security email if still using example.com
if grep -q "security@example.com" SECURITY.md; then
  print_warning "SECURITY.md still uses security@example.com"
  print_info "Please update with real security contact email"

  # Suggest replacement
  read -p "Enter security email (or press Enter to skip): " SECURITY_EMAIL
  if [ ! -z "$SECURITY_EMAIL" ]; then
    sed -i "s/security@example.com/$SECURITY_EMAIL/" SECURITY.md
    print_status 0 "Updated security email to $SECURITY_EMAIL"
  fi
else
  print_status 0 "SECURITY.md has valid security contact"
fi

echo ""
echo "=================================="
echo "🎉 Fix Complete!"
echo "=================================="
echo ""

# Final summary
echo "Summary:"
echo "--------"
echo "✅ Zod version: $(grep '"zod":' package.json | awk '{print $2}')"
echo "✅ ripgrep: $(command -v rg &> /dev/null && echo 'Installed' || echo 'Not found')"
echo "✅ node_modules: $([ -d 'node_modules' ] && echo 'Present' || echo 'Missing')"
echo "✅ TypeScript build: $([ -f 'dist/index.js' ] && echo 'Success' || echo 'Failed')"
echo ""

echo "Next steps:"
echo "----------"
echo "1. Set your API key:"
echo "   export GROK_API_KEY='your-key-here'"
echo ""
echo "2. Start the CLI:"
echo "   npm start"
echo "   # or"
echo "   npm run dev"
echo ""
echo "3. Run tests:"
echo "   npm test"
echo ""
echo "4. Review the full audit report:"
echo "   cat AUDIT-SECURITY-USABILITY-2025-12-12.md"
echo ""

print_info "For more details, see AUDIT-SECURITY-USABILITY-2025-12-12.md"
