# Tool Usage Examples

This guide provides practical examples for each tool available in Code Buddy.

## File Operations

### read_file

Read the contents of a file:

```bash
# Basic usage
> Read the contents of package.json

# With line range
> Show me lines 50-100 of src/index.ts

# Multiple files
> Read all the test files in tests/unit/
```

### write_file

Create or overwrite files:

```bash
# Create a new file
> Create a new file called utils/helpers.ts with a function to format dates

# Generate boilerplate
> Create a React component file called Button.tsx with props for label and onClick

# Write configuration
> Create a .env.example file with placeholders for GROK_API_KEY and DATABASE_URL
```

### edit_file

Make targeted edits to existing files:

```bash
# Fix a bug
> In auth.ts, change the token expiry from 1 hour to 24 hours

# Add imports
> Add the lodash import to utils/data.ts

# Refactor
> In UserService.ts, rename the method 'getUser' to 'fetchUserById'

# Add error handling
> Add try-catch around the API call in fetchData.ts
```

### list_directory

Browse directory contents:

```bash
# List current directory
> What files are in this directory?

# List specific folder
> Show me the contents of src/components/

# Recursive listing
> List all TypeScript files in src/ recursively
```

---

## Search Operations

### glob

Find files by pattern:

```bash
# Find all TypeScript files
> Find all .ts files in the src directory

# Find test files
> Find all files matching *.test.ts

# Find config files
> Find all files named config.* or *.config.*

# Complex patterns
> Find all React components (*.tsx) excluding test files
```

### grep

Search file contents:

```bash
# Find function definitions
> Search for "async function" in all TypeScript files

# Find imports
> Find all files that import 'lodash'

# Find TODO comments
> Search for TODO and FIXME comments in the codebase

# Regex search
> Find all console.log statements that aren't commented out

# Context search
> Find usages of 'UserService' and show surrounding lines
```

---

## Shell Operations

### bash

Execute shell commands:

```bash
# Run tests
> Run the test suite

# Install dependencies
> Install axios and its types

# Git operations
> Show me the git status and recent commits

# Build project
> Build the project and show any errors

# Start services
> Start the development server

# Check environment
> Show me the current Node.js and npm versions
```

---

## Web Operations

### web_search

Search the internet:

```bash
# Research
> Search for best practices for TypeScript error handling

# Find documentation
> Search for React useEffect cleanup patterns

# Find solutions
> Search for how to fix "Cannot find module" error in Node.js

# Compare options
> Search for comparison between Jest and Vitest
```

### web_fetch

Fetch web content:

```bash
# Get documentation
> Fetch the README from https://github.com/microsoft/TypeScript

# Get API response
> Fetch https://api.github.com/users/octocat

# Check website
> Fetch the homepage of https://example.com and summarize it

# Get package info
> Fetch the npm page for the express package
```

---

## Advanced Examples

### Multi-Step Workflows

**Refactoring a module:**
```bash
> I want to refactor the user authentication system:
> 1. First, show me all files related to authentication
> 2. Analyze the current structure
> 3. Suggest improvements
> 4. Implement the changes step by step
```

**Adding a new feature:**
```bash
> Add a password reset feature:
> 1. Create a new endpoint POST /auth/reset-password
> 2. Add email sending functionality
> 3. Create the reset token model
> 4. Add tests for the new feature
```

**Debugging an issue:**
```bash
> The login is failing with a 401 error:
> 1. Find the login endpoint handler
> 2. Check the authentication middleware
> 3. Look at recent changes to auth files
> 4. Identify and fix the issue
```

### Project Analysis

**Codebase overview:**
```bash
> Give me an overview of this codebase:
> - What's the architecture?
> - What are the main components?
> - What technologies are used?
```

**Security audit:**
```bash
> Perform a security review:
> 1. Check for hardcoded secrets
> 2. Look for SQL injection vulnerabilities
> 3. Check authentication implementation
> 4. Review input validation
```

**Performance review:**
```bash
> Analyze performance issues:
> 1. Find N+1 query problems
> 2. Check for unnecessary re-renders in React
> 3. Look for memory leaks
> 4. Suggest optimizations
```

---

## Tool Combinations

### Reading + Editing
```bash
# First understand, then modify
> Read the UserService.ts file, understand how it works,
> then add a new method to update user preferences
```

### Search + Edit
```bash
# Find and fix across files
> Find all places where we use deprecated API calls
> and update them to the new syntax
```

### Bash + File Operations
```bash
# Generate and save output
> Run the tests with coverage and create a summary
> in docs/test-coverage.md
```

### Web + Code
```bash
# Research and implement
> Search for how to implement rate limiting in Express,
> then add it to our API routes
```

---

## Error Handling Examples

### When operations fail

```bash
# If file read fails
> Try to read config.json - if it doesn't exist, create it with default values

# If command fails
> Run npm install - if it fails, check the error and suggest fixes

# If search returns nothing
> Search for 'deprecated' - if nothing found, confirm the codebase is clean
```

### Confirmation prompts

By default, destructive operations require confirmation:

```bash
# File deletion (requires confirmation)
> Delete all .bak files in the project

# System commands (requires confirmation)
> Run rm -rf node_modules && npm install

# Overwriting files (requires confirmation)
> Replace the entire auth module with a new implementation
```

To auto-approve safe operations, use `--security auto-edit` mode.

---

## Best Practices

### Be Specific
```bash
# Good: Specific and actionable
> In src/api/users.ts, add input validation for the email parameter
> in the createUser function using zod

# Less good: Vague
> Add some validation
```

### Provide Context
```bash
# Good: Includes context
> We're using Express with TypeScript. Add a middleware
> that logs request duration to our existing logger

# Less good: Missing context
> Add logging middleware
```

### Break Down Complex Tasks
```bash
# Good: Step by step
> Let's add user roles:
> 1. First, show me the current User model
> 2. Add a 'role' field with enum type
> 3. Create a middleware to check roles
> 4. Add role checks to admin routes

# Less good: All at once
> Add user roles with admin checks everywhere
```

### Review Before Confirming
```bash
# Use plan mode for big changes
buddy --mode plan
> Plan how to migrate from REST to GraphQL

# Then switch to code mode
/mode code
> Implement the migration we planned
```
