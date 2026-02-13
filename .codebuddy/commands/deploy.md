---
description: Deploy the application to production
---

# Deploy Command

Perform a deployment to production:

1. Run all tests to ensure nothing is broken
2. Build the project for production
3. Check for any uncommitted changes
4. Create a git tag for the release
5. Push to the deployment branch

Environment: $1 (default: production)

Safety checks:
- Ensure all tests pass
- Ensure no uncommitted changes
- Confirm before proceeding
