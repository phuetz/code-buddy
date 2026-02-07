---
name: gitlab
version: 1.0.0
description: GitLab DevOps platform with CI/CD pipelines, API automation, and glab CLI control
author: Code Buddy
tags: gitlab, ci, cd, devops, git, pipeline, merge-request, api, glab
env:
  GITLAB_TOKEN: ""
  GITLAB_URL: ""
---

# GitLab DevOps Platform

Complete GitLab integration including CI/CD pipelines, merge request workflows, API automation, and command-line control with glab.

## Direct Control (CLI / API / Scripting)

### glab CLI Commands

```bash
# Authentication
glab auth login
glab auth status

# Repository operations
glab repo clone group/project
glab repo view
glab repo create my-new-project
glab repo fork
glab repo archive my-project

# Merge Request (MR) operations
glab mr create --title "Feature: Add new API" --description "Implements new REST endpoint"
glab mr create --title "Fix bug" --label bug --assignee @username
glab mr list
glab mr list --author @me
glab mr list --state opened --label bug
glab mr view 123
glab mr view 123 --web
glab mr approve 123
glab mr merge 123
glab mr merge 123 --when-pipeline-succeeds --remove-source-branch
glab mr close 123
glab mr reopen 123
glab mr checkout 123
glab mr diff 123
glab mr note 123 --message "Looks good to me!"
glab mr update 123 --title "Updated title" --label enhancement

# Issue operations
glab issue create --title "Bug in authentication" --description "Users cannot log in"
glab issue list
glab issue list --assignee @me --state opened
glab issue view 456
glab issue close 456
glab issue update 456 --label bug --assign @username

# Pipeline operations
glab pipeline list
glab pipeline view 789
glab pipeline ci view
glab pipeline ci status
glab pipeline ci trace
glab pipeline ci trace --branch main
glab pipeline delete 789
glab pipeline retry 789

# CI/CD variables
glab variable set API_KEY "secret-value" --scope prod
glab variable list
glab variable update API_KEY "new-value"
glab variable delete API_KEY

# Project operations
glab project view
glab project create my-new-project --description "My awesome project"
glab project list
glab project delete my-old-project

# Release operations
glab release create v1.0.0 --name "Version 1.0.0" --notes "Initial release"
glab release list
glab release view v1.0.0
glab release delete v1.0.0

# Label operations
glab label create bug --color "#FF0000"
glab label list

# User operations
glab user list
glab user events @me
```

### GitLab REST API (cURL)

```bash
# Authentication
export GITLAB_TOKEN="your-personal-access-token"
export GITLAB_URL="https://gitlab.com"

# Projects
# List all projects
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$GITLAB_URL/api/v4/projects"

# Get specific project
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$GITLAB_URL/api/v4/projects/123"

# Create project
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name": "my-project", "description": "My awesome project", "visibility": "private"}' \
  "$GITLAB_URL/api/v4/projects"

# Delete project
curl --request DELETE --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123"

# Merge Requests
# List merge requests
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/merge_requests?state=opened"

# Get merge request
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/merge_requests/1"

# Create merge request
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "source_branch": "feature-branch",
    "target_branch": "main",
    "title": "Add new feature",
    "description": "This MR adds a new feature"
  }' \
  "$GITLAB_URL/api/v4/projects/123/merge_requests"

# Approve merge request
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/merge_requests/1/approve"

# Merge a merge request
curl --request PUT --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/merge_requests/1/merge"

# Add comment to MR
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"body": "This looks great!"}' \
  "$GITLAB_URL/api/v4/projects/123/merge_requests/1/notes"

# Pipelines
# List pipelines
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/pipelines"

# Get pipeline
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/pipelines/456"

# Trigger pipeline
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/pipeline?ref=main"

# Retry pipeline
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/pipelines/456/retry"

# Cancel pipeline
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/pipelines/456/cancel"

# Jobs
# List jobs
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/jobs"

# Get job
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/jobs/789"

# Get job log
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/jobs/789/trace"

# Retry job
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/jobs/789/retry"

# Download artifacts
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/jobs/789/artifacts" \
  --output artifacts.zip

# Issues
# List issues
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/issues"

# Create issue
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "title": "Bug in login",
    "description": "Users cannot log in with valid credentials",
    "labels": "bug,high-priority"
  }' \
  "$GITLAB_URL/api/v4/projects/123/issues"

# Update issue
curl --request PUT --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"state_event": "close"}' \
  "$GITLAB_URL/api/v4/projects/123/issues/10"

# CI/CD Variables
# List variables
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/variables"

# Create variable
curl --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"key": "API_KEY", "value": "secret123", "protected": true, "masked": true}' \
  "$GITLAB_URL/api/v4/projects/123/variables"

# Update variable
curl --request PUT --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"value": "newsecret456"}' \
  "$GITLAB_URL/api/v4/projects/123/variables/API_KEY"

# Delete variable
curl --request DELETE --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/variables/API_KEY"

# Container Registry
# List repositories
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/registry/repositories"

# List tags
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/registry/repositories/1/tags"

# Delete tag
curl --request DELETE --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/123/registry/repositories/1/tags/v1.0.0"
```

### .gitlab-ci.yml Configuration

```yaml
# Complete CI/CD pipeline
stages:
  - test
  - build
  - deploy
  - release

variables:
  DOCKER_DRIVER: overlay2
  DOCKER_TLS_CERTDIR: "/certs"
  IMAGE_TAG: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
  KUBECONFIG: /tmp/kubeconfig

# Reusable templates
.node_template: &node_template
  image: node:18
  cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
  before_script:
    - npm ci

.docker_template: &docker_template
  image: docker:24
  services:
    - docker:24-dind
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY

# Test stage
lint:
  <<: *node_template
  stage: test
  script:
    - npm run lint
  only:
    - merge_requests
    - main

unit-test:
  <<: *node_template
  stage: test
  script:
    - npm run test:unit -- --coverage
  coverage: '/Lines\s*:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
      junit: test-results/junit.xml
    paths:
      - coverage/
    expire_in: 1 week

integration-test:
  <<: *node_template
  stage: test
  services:
    - postgres:14
    - redis:7
  variables:
    POSTGRES_DB: testdb
    POSTGRES_USER: testuser
    POSTGRES_PASSWORD: testpass
    DATABASE_URL: postgresql://testuser:testpass@postgres:5432/testdb
    REDIS_URL: redis://redis:6379
  script:
    - npm run test:integration
  only:
    - merge_requests
    - main

security-scan:
  stage: test
  image: aquasec/trivy:latest
  script:
    - trivy fs --security-checks vuln,config --format json --output trivy-report.json .
  artifacts:
    reports:
      container_scanning: trivy-report.json
  allow_failure: true

# Build stage
build:
  <<: *node_template
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 day
  only:
    - main
    - tags

docker-build:
  <<: *docker_template
  stage: build
  script:
    - docker build -t $IMAGE_TAG .
    - docker tag $IMAGE_TAG $CI_REGISTRY_IMAGE:latest
    - docker push $IMAGE_TAG
    - docker push $CI_REGISTRY_IMAGE:latest
  only:
    - main
    - tags

# Deploy stage
deploy-staging:
  stage: deploy
  image: bitnami/kubectl:latest
  environment:
    name: staging
    url: https://staging.example.com
    on_stop: stop-staging
  script:
    - echo "$KUBECONFIG_STAGING" > $KUBECONFIG
    - kubectl set image deployment/myapp myapp=$IMAGE_TAG -n staging
    - kubectl rollout status deployment/myapp -n staging
  only:
    - main

deploy-production:
  stage: deploy
  image: bitnami/kubectl:latest
  environment:
    name: production
    url: https://example.com
  script:
    - echo "$KUBECONFIG_PRODUCTION" > $KUBECONFIG
    - kubectl set image deployment/myapp myapp=$IMAGE_TAG -n production
    - kubectl rollout status deployment/myapp -n production
  when: manual
  only:
    - main
    - tags

stop-staging:
  stage: deploy
  image: bitnami/kubectl:latest
  environment:
    name: staging
    action: stop
  script:
    - echo "$KUBECONFIG_STAGING" > $KUBECONFIG
    - kubectl scale deployment/myapp --replicas=0 -n staging
  when: manual
  only:
    - main

# Release stage
create-release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  script:
    - echo "Creating release for $CI_COMMIT_TAG"
  release:
    tag_name: $CI_COMMIT_TAG
    name: 'Release $CI_COMMIT_TAG'
    description: 'Release created using GitLab CI/CD'
    assets:
      links:
        - name: 'Docker Image'
          url: '$CI_REGISTRY_IMAGE:$CI_COMMIT_TAG'
  only:
    - tags

# Dynamic child pipelines
trigger-downstream:
  stage: deploy
  trigger:
    include:
      - local: .gitlab-ci-downstream.yml
    strategy: depend
  only:
    - main

# Parallel matrix jobs
test-matrix:
  stage: test
  image: node:${NODE_VERSION}
  parallel:
    matrix:
      - NODE_VERSION: ['16', '18', '20']
  script:
    - npm ci
    - npm test

# Review apps (dynamic environments)
review:
  stage: deploy
  script:
    - echo "Deploying review app for $CI_COMMIT_REF_NAME"
    - helm upgrade --install review-$CI_COMMIT_REF_SLUG ./chart \
        --set image.tag=$IMAGE_TAG \
        --namespace review-apps
  environment:
    name: review/$CI_COMMIT_REF_NAME
    url: https://review-$CI_COMMIT_REF_SLUG.example.com
    on_stop: stop-review
  only:
    - merge_requests

stop-review:
  stage: deploy
  script:
    - helm uninstall review-$CI_COMMIT_REF_SLUG --namespace review-apps
  environment:
    name: review/$CI_COMMIT_REF_NAME
    action: stop
  when: manual
  only:
    - merge_requests
```

### Python GitLab API Client

```python
import gitlab

# Initialize GitLab client
gl = gitlab.Gitlab('https://gitlab.com', private_token='your-token')

# Get project
project = gl.projects.get('group/project')

# List merge requests
mrs = project.mergerequests.list(state='opened')
for mr in mrs:
    print(f"MR #{mr.iid}: {mr.title} by {mr.author['name']}")

# Create merge request
mr = project.mergerequests.create({
    'source_branch': 'feature-branch',
    'target_branch': 'main',
    'title': 'New feature',
    'description': 'Adds awesome feature'
})

# Approve and merge
mr.approve()
mr.merge()

# Pipelines
pipelines = project.pipelines.list()
latest_pipeline = pipelines[0]
print(f"Pipeline #{latest_pipeline.id}: {latest_pipeline.status}")

# Jobs
jobs = latest_pipeline.jobs.list()
for job in jobs:
    print(f"Job {job.name}: {job.status}")
    if job.status == 'failed':
        print(job.trace())  # Get logs

# Trigger pipeline
pipeline = project.pipelines.create({'ref': 'main'})

# Issues
issue = project.issues.create({
    'title': 'Bug report',
    'description': 'Something is broken',
    'labels': ['bug', 'high-priority']
})

# Add comment to issue
issue.notes.create({'body': 'Working on a fix'})

# CI/CD Variables
project.variables.create({'key': 'API_KEY', 'value': 'secret123'})
vars = project.variables.list()
for var in vars:
    print(f"{var.key}: {'*' * len(var.value)}")

# Container Registry
repositories = project.repositories.list()
for repo in repositories:
    tags = repo.tags.list()
    for tag in tags:
        print(f"{repo.location}:{tag.name}")
```

## MCP Server Integration

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "your-gitlab-token",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    }
  }
}
```

### Available MCP Tools

**gitlab_create_merge_request**
- Creates a new merge request
- Parameters: `project_id` (string), `source_branch` (string), `target_branch` (string), `title` (string), `description` (optional)
- Returns: MR IID, URL, status

**gitlab_get_merge_request**
- Retrieves merge request details
- Parameters: `project_id` (string), `mr_iid` (number)
- Returns: Full MR details, diff, approvals, pipeline status

**gitlab_list_merge_requests**
- Lists merge requests for a project
- Parameters: `project_id` (string), `state` (optional), `labels` (optional), `author` (optional)
- Returns: Array of merge requests

**gitlab_approve_merge_request**
- Approves a merge request
- Parameters: `project_id` (string), `mr_iid` (number)
- Returns: Approval confirmation

**gitlab_merge_merge_request**
- Merges a merge request
- Parameters: `project_id` (string), `mr_iid` (number), `should_remove_source_branch` (boolean)
- Returns: Merge status and commit SHA

**gitlab_create_issue**
- Creates a new issue
- Parameters: `project_id` (string), `title` (string), `description` (optional), `labels` (optional)
- Returns: Issue IID and URL

**gitlab_list_issues**
- Lists issues for a project
- Parameters: `project_id` (string), `state` (optional), `labels` (optional), `assignee` (optional)
- Returns: Array of issues

**gitlab_get_pipeline**
- Retrieves pipeline details
- Parameters: `project_id` (string), `pipeline_id` (number)
- Returns: Pipeline status, jobs, duration

**gitlab_trigger_pipeline**
- Triggers a new pipeline
- Parameters: `project_id` (string), `ref` (string), `variables` (optional object)
- Returns: Pipeline ID and status

**gitlab_list_pipelines**
- Lists pipelines for a project
- Parameters: `project_id` (string), `ref` (optional), `status` (optional)
- Returns: Array of pipelines

**gitlab_get_job_log**
- Retrieves job log output
- Parameters: `project_id` (string), `job_id` (number)
- Returns: Job log text

**gitlab_list_projects**
- Lists accessible projects
- Parameters: `search` (optional), `membership` (boolean)
- Returns: Array of projects with IDs and names

**gitlab_get_file_content**
- Retrieves file from repository
- Parameters: `project_id` (string), `file_path` (string), `ref` (optional)
- Returns: File content and metadata

**gitlab_create_variable**
- Creates CI/CD variable
- Parameters: `project_id` (string), `key` (string), `value` (string), `protected` (boolean), `masked` (boolean)
- Returns: Variable details

## Common Workflows

### 1. Complete GitOps CI/CD Pipeline

```bash
# Create .gitlab-ci.yml
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test
  - deploy

build-image:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

test:
  stage: test
  image: node:18
  script:
    - npm ci
    - npm test
    - npm run lint

deploy-k8s:
  stage: deploy
  image: bitnami/kubectl:latest
  script:
    - kubectl set image deployment/myapp myapp=$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
    - kubectl rollout status deployment/myapp
  environment:
    name: production
    url: https://myapp.example.com
  only:
    - main
EOF

# Commit and push
git add .gitlab-ci.yml
git commit -m "ci: add GitLab CI/CD pipeline"
git push

# Monitor pipeline
glab pipeline ci status
glab pipeline ci trace
```

### 2. Automated Merge Request Workflow

```bash
# Create feature branch
git checkout -b feature/new-api
# Make changes
git add .
git commit -m "feat: add new API endpoint"
git push -u origin feature/new-api

# Create merge request with glab
glab mr create \
  --title "feat: Add new REST API endpoint" \
  --description "Implements /api/v2/users endpoint with pagination" \
  --label "feature,api" \
  --assignee @reviewer \
  --milestone "v2.0" \
  --remove-source-branch

# Monitor MR status
MR_IID=$(glab mr list --author @me --state opened | head -1 | awk '{print $1}')
glab mr view $MR_IID

# Check pipeline
glab pipeline ci status

# Address review comments
git add .
git commit -m "fix: address review comments"
git push

# Merge when ready
glab mr merge $MR_IID --when-pipeline-succeeds --remove-source-branch
```

### 3. Multi-Environment Deployment Strategy

```yaml
# .gitlab-ci.yml with environment-specific deploys
stages:
  - build
  - deploy-dev
  - deploy-staging
  - deploy-production

variables:
  DOCKER_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA

build:
  stage: build
  script:
    - docker build -t $DOCKER_IMAGE .
    - docker push $DOCKER_IMAGE

.deploy_template: &deploy_template
  image: bitnami/kubectl:latest
  script:
    - echo "$KUBECONFIG_CONTENT" > /tmp/kubeconfig
    - export KUBECONFIG=/tmp/kubeconfig
    - |
      helm upgrade --install myapp ./chart \
        --namespace $NAMESPACE \
        --set image.tag=$CI_COMMIT_SHORT_SHA \
        --set environment=$ENVIRONMENT \
        --set replicas=$REPLICAS \
        --wait \
        --timeout 5m

deploy-dev:
  <<: *deploy_template
  stage: deploy-dev
  variables:
    ENVIRONMENT: dev
    NAMESPACE: development
    REPLICAS: 1
  environment:
    name: development
    url: https://dev.example.com
  only:
    - branches
  except:
    - main

deploy-staging:
  <<: *deploy_template
  stage: deploy-staging
  variables:
    ENVIRONMENT: staging
    NAMESPACE: staging
    REPLICAS: 2
  environment:
    name: staging
    url: https://staging.example.com
  only:
    - main

deploy-production:
  <<: *deploy_template
  stage: deploy-production
  variables:
    ENVIRONMENT: production
    NAMESPACE: production
    REPLICAS: 5
  environment:
    name: production
    url: https://example.com
  when: manual
  only:
    - main
    - tags
```

### 4. Automated Testing and Quality Gates

```yaml
# .gitlab-ci.yml with comprehensive testing
stages:
  - lint
  - test
  - security
  - quality-gate
  - build

lint:
  stage: lint
  image: node:18
  script:
    - npm ci
    - npm run lint
    - npm run format:check

unit-test:
  stage: test
  image: node:18
  script:
    - npm ci
    - npm run test:unit -- --coverage
  coverage: '/Lines\s*:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      junit: junit.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

e2e-test:
  stage: test
  image: cypress/base:18
  services:
    - postgres:14
  script:
    - npm ci
    - npm run start:test &
    - npx wait-on http://localhost:3000
    - npm run test:e2e
  artifacts:
    when: always
    paths:
      - cypress/videos/
      - cypress/screenshots/

dependency-scan:
  stage: security
  image: node:18
  script:
    - npm audit --audit-level=moderate
  allow_failure: true

container-scan:
  stage: security
  image: aquasec/trivy:latest
  script:
    - trivy image --severity HIGH,CRITICAL $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  allow_failure: true

sonarqube-check:
  stage: quality-gate
  image: sonarsource/sonar-scanner-cli:latest
  script:
    - sonar-scanner
      -Dsonar.projectKey=$CI_PROJECT_NAME
      -Dsonar.sources=src
      -Dsonar.host.url=$SONAR_HOST_URL
      -Dsonar.login=$SONAR_TOKEN
  allow_failure: false
  only:
    - merge_requests
    - main
```

### 5. Release Automation with Semantic Versioning

```bash
# Install semantic-release
npm install --save-dev semantic-release @semantic-release/gitlab

# Create .releaserc.json
cat > .releaserc.json <<'EOF'
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/gitlab",
    "@semantic-release/npm",
    [
      "@semantic-release/git",
      {
        "assets": ["package.json"],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ]
  ]
}
EOF

# Add to .gitlab-ci.yml
cat >> .gitlab-ci.yml <<'EOF'
release:
  stage: release
  image: node:18
  script:
    - npm ci
    - npx semantic-release
  only:
    - main
  variables:
    GL_TOKEN: $GITLAB_TOKEN
EOF

# Commit with conventional commits
git add .
git commit -m "feat: implement automated releases"
git push

# Tag and create release manually
VERSION="v2.1.0"
git tag -a $VERSION -m "Release $VERSION"
git push origin $VERSION

# Create GitLab release via API
curl --request POST \
  --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data "{
    \"tag_name\": \"$VERSION\",
    \"name\": \"Release $VERSION\",
    \"description\": \"## Features\n- New API endpoint\n- Performance improvements\",
    \"assets\": {
      \"links\": [
        {
          \"name\": \"Docker Image\",
          \"url\": \"$CI_REGISTRY_IMAGE:$VERSION\"
        }
      ]
    }
  }" \
  "$GITLAB_URL/api/v4/projects/$CI_PROJECT_ID/releases"

# View release
glab release view $VERSION
```

## Advanced Features

### Auto DevOps

```yaml
# Enable Auto DevOps with custom configuration
include:
  - template: Auto-DevOps.gitlab-ci.yml

variables:
  AUTO_DEVOPS_CHART: gitlab/auto-deploy-app
  POSTGRES_ENABLED: "true"
  REDIS_ENABLED: "true"

production:
  extends: .production
  before_script:
    - echo "Custom pre-deployment steps"
```

### Container Registry Cleanup

```bash
# Delete old tags (keep last 10)
curl --request DELETE \
  --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/registry/repositories/$REPO_ID/tags" \
  --data 'name_regex_delete=.*' \
  --data 'keep_n=10' \
  --data 'older_than=30d'
```

### Scheduled Pipelines

```bash
# Create pipeline schedule via API
curl --request POST \
  --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "description": "Nightly build",
    "ref": "main",
    "cron": "0 2 * * *",
    "cron_timezone": "UTC",
    "active": true
  }' \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/pipeline_schedules"
```
