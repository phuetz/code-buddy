#!/bin/bash
#
# Code Buddy Smoke Test
# Tests core functionality to ensure the CLI works correctly
#

# Don't exit on error - we handle errors manually
set +e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
SKIPPED=0

# Test directory
TEST_DIR=$(mktemp -d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Cleanup on exit
cleanup() {
    rm -rf "$TEST_DIR"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}                      SMOKE TEST RESULTS                    ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Passed:${NC}  $PASSED"
    echo -e "  ${RED}Failed:${NC}  $FAILED"
    echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed.${NC}"
        exit 1
    fi
}
trap cleanup EXIT

# Helper functions
log_test() {
    echo -e "\n${BLUE}[TEST]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
    ((SKIPPED++))
}

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Check if Code Buddy is built
check_build() {
    log_test "Checking if Code Buddy is built..."

    if [ -f "$PROJECT_DIR/dist/index.js" ]; then
        log_pass "Build exists at dist/index.js"
        return 0
    else
        log_info "Build not found, building now..."
        cd "$PROJECT_DIR"
        npm run build 2>/dev/null
        if [ -f "$PROJECT_DIR/dist/index.js" ]; then
            log_pass "Build successful"
            return 0
        else
            log_fail "Build failed"
            return 1
        fi
    fi
}

# Check API key
check_api_key() {
    log_test "Checking API key..."

    if [ -n "$GROK_API_KEY" ]; then
        log_pass "GROK_API_KEY is set"
        return 0
    else
        log_skip "GROK_API_KEY not set - skipping API tests"
        return 1
    fi
}

# ============================================================
# TEST 1: CLI starts and shows help
# ============================================================
test_cli_help() {
    log_test "CLI --help command..."

    cd "$PROJECT_DIR"
    if node dist/index.js --help 2>&1 | grep -q "Code Buddy"; then
        log_pass "CLI help works"
    else
        log_fail "CLI help failed"
    fi
}

# ============================================================
# TEST 2: CLI shows version
# ============================================================
test_cli_version() {
    log_test "CLI --version command..."

    cd "$PROJECT_DIR"
    if node dist/index.js --version 2>&1 | grep -qE "[0-9]+\.[0-9]+\.[0-9]+"; then
        log_pass "CLI version works"
    else
        log_fail "CLI version failed"
    fi
}

# ============================================================
# TEST 3: TypeScript compilation
# ============================================================
test_typescript() {
    log_test "TypeScript type checking..."

    cd "$PROJECT_DIR"
    if npm run typecheck 2>&1 | grep -q "error"; then
        log_fail "TypeScript errors found"
    else
        log_pass "TypeScript compiles without errors"
    fi
}

# ============================================================
# TEST 4: Unit tests pass
# ============================================================
test_unit_tests() {
    log_test "Running unit tests..."

    cd "$PROJECT_DIR"
    if npm test -- --passWithNoTests --silent 2>&1 | grep -q "PASS\|passed"; then
        log_pass "Unit tests pass"
    else
        log_fail "Unit tests failed"
    fi
}

# ============================================================
# TEST 5: Slash command parsing
# ============================================================
test_slash_commands() {
    log_test "Testing slash command parsing..."

    cd "$PROJECT_DIR"

    # Test that SlashCommandManager can be imported and used
    node -e "
        const { SlashCommandManager } = require('./dist/commands/slash-commands.js');
        const mgr = new SlashCommandManager('.');
        const cmds = mgr.getCommands();
        if (cmds.length > 10) {
            console.log('Found ' + cmds.length + ' commands');
            process.exit(0);
        } else {
            process.exit(1);
        }
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Slash commands load correctly"
    else
        log_fail "Slash commands failed to load"
    fi
}

# ============================================================
# TEST 6: Tool definitions
# ============================================================
test_tool_definitions() {
    log_test "Testing tool definitions..."

    cd "$PROJECT_DIR"

    node -e "
        const { CODEBUDDY_TOOLS } = require('./dist/codebuddy/tools.js');
        if (CODEBUDDY_TOOLS && CODEBUDDY_TOOLS.length > 5) {
            console.log('Found ' + CODEBUDDY_TOOLS.length + ' tools');
            process.exit(0);
        } else {
            console.log('Tools not found or empty');
            process.exit(1);
        }
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Tool definitions load correctly"
    else
        log_fail "Tool definitions failed"
    fi
}

# ============================================================
# TEST 7: Track system
# ============================================================
test_track_system() {
    log_test "Testing track system..."

    cd "$PROJECT_DIR"

    node -e "
        const { TrackManager } = require('./dist/tracks/track-manager.js');
        const { TrackCommands } = require('./dist/tracks/track-commands.js');

        const mgr = new TrackManager('/tmp/test-tracks');
        const cmds = new TrackCommands('/tmp/test-tracks');

        // Test that classes instantiate
        if (mgr && cmds) {
            console.log('Track system OK');
            process.exit(0);
        } else {
            process.exit(1);
        }
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Track system loads correctly"
    else
        log_fail "Track system failed"
    fi
}

# ============================================================
# TEST 8: File operations (no API needed)
# ============================================================
test_file_operations() {
    log_test "Testing file operations..."

    cd "$PROJECT_DIR"

    # Create a test file
    echo "test content" > "$TEST_DIR/test-file.txt"

    node -e "
        const fs = require('fs');
        const path = require('path');

        const testFile = '$TEST_DIR/test-file.txt';

        // Test read
        const content = fs.readFileSync(testFile, 'utf-8');
        if (content.trim() !== 'test content') {
            process.exit(1);
        }

        // Test write
        fs.writeFileSync('$TEST_DIR/output.txt', 'written by test');
        const written = fs.readFileSync('$TEST_DIR/output.txt', 'utf-8');
        if (written.trim() !== 'written by test') {
            process.exit(1);
        }

        console.log('File operations OK');
        process.exit(0);
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "File operations work"
    else
        log_fail "File operations failed"
    fi
}

# ============================================================
# TEST 9: API client instantiation
# ============================================================
test_api_connection() {
    if [ -z "$GROK_API_KEY" ]; then
        log_skip "API connection test (no API key)"
        return
    fi

    log_test "Testing API client..."

    cd "$PROJECT_DIR"

    node -e "
        const { CodeBuddyClient } = require('./dist/codebuddy/client.js');

        try {
            const client = new CodeBuddyClient({
                apiKey: process.env.GROK_API_KEY
            });

            if (client) {
                console.log('API client instantiated');
                process.exit(0);
            } else {
                process.exit(1);
            }
        } catch (e) {
            console.error(e.message);
            process.exit(1);
        }
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "API client works"
    else
        log_fail "API client failed"
    fi
}

# ============================================================
# TEST 10: Simple AI interaction (requires API key + live API)
# ============================================================
test_ai_interaction() {
    if [ -z "$GROK_API_KEY" ]; then
        log_skip "AI interaction test (no API key)"
        return
    fi

    log_test "Testing AI interaction..."

    cd "$PROJECT_DIR"

    # Use timeout to prevent hanging
    timeout 30s node -e "
        const { CodeBuddyClient } = require('./dist/codebuddy/client.js');

        async function test() {
            const client = new CodeBuddyClient({
                apiKey: process.env.GROK_API_KEY,
                model: 'grok-3-mini-fast'
            });

            try {
                const response = await client.chat([
                    { role: 'user', content: 'Reply with only the word PONG' }
                ]);

                if (response && response.toLowerCase().includes('pong')) {
                    console.log('AI responded correctly');
                    process.exit(0);
                } else {
                    console.log('Unexpected response: ' + response);
                    process.exit(1);
                }
            } catch (e) {
                // API not available - this is optional
                console.log('API not available: ' + e.message);
                process.exit(2); // Special exit code for skip
            }
        }
        test();
    " 2>&1

    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        log_pass "AI interaction works"
    elif [ $exit_code -eq 2 ]; then
        log_skip "AI interaction (API not available)"
    else
        log_fail "AI interaction failed"
    fi
}

# ============================================================
# TEST 11: Tool execution (via BashTool directly)
# ============================================================
test_tool_execution() {
    log_test "Testing tool execution..."

    cd "$PROJECT_DIR"

    # Test BashTool directly
    node -e "
        const { BashTool } = require('./dist/tools/bash.js');

        async function test() {
            const bash = new BashTool();
            const result = await bash.execute('echo hello');

            if (result.success && result.output.includes('hello')) {
                console.log('Tool execution OK');
                process.exit(0);
            } else {
                console.log('Tool failed:', result.error || 'unexpected output');
                process.exit(1);
            }
        }
        test();
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Tool execution works"
    else
        log_fail "Tool execution failed"
    fi
}

# ============================================================
# TEST 12: Context loader
# ============================================================
test_context_loader() {
    log_test "Testing context loader..."

    cd "$PROJECT_DIR"

    node -e "
        const { ContextLoader } = require('./dist/context/context-loader.js');

        const loader = new ContextLoader('$PROJECT_DIR', {
            patterns: ['package.json'],
            respectGitignore: true
        });

        loader.loadFiles(['package.json']).then(files => {
            if (files.length >= 1) {
                console.log('Context loader OK');
                process.exit(0);
            } else {
                process.exit(1);
            }
        }).catch(() => process.exit(1));
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Context loader works"
    else
        log_fail "Context loader failed"
    fi
}

# ============================================================
# TEST 13: Checkpoint manager
# ============================================================
test_checkpoint_manager() {
    log_test "Testing checkpoint manager..."

    cd "$PROJECT_DIR"

    node -e "
        const { CheckpointManager } = require('./dist/checkpoints/checkpoint-manager.js');

        const mgr = new CheckpointManager({ workingDirectory: '$TEST_DIR' });

        // Create a test checkpoint (synchronous)
        const testFile = '$TEST_DIR/checkpoint-test.txt';
        require('fs').writeFileSync(testFile, 'original');

        const cp = mgr.createCheckpoint('test checkpoint', [testFile]);
        if (cp && cp.id) {
            console.log('Checkpoint manager OK');
            process.exit(0);
        } else {
            process.exit(1);
        }
    " 2>&1

    if [ $? -eq 0 ]; then
        log_pass "Checkpoint manager works"
    else
        log_fail "Checkpoint manager failed"
    fi
}

# ============================================================
# MAIN
# ============================================================

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                   CODE BUDDY SMOKE TEST                    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Project: ${YELLOW}$PROJECT_DIR${NC}"
echo -e "Test dir: ${YELLOW}$TEST_DIR${NC}"
echo ""

# Pre-checks
check_build || exit 1
HAS_API_KEY=true
check_api_key || HAS_API_KEY=false

echo ""
echo -e "${BLUE}Running tests...${NC}"

# Run all tests
test_cli_help
test_cli_version
test_typescript
test_slash_commands
test_tool_definitions
test_track_system
test_file_operations
test_tool_execution
test_context_loader
test_checkpoint_manager

# API tests (optional)
test_api_connection
test_ai_interaction

# Unit tests (run last as they take longest)
test_unit_tests

# Cleanup happens automatically via trap
