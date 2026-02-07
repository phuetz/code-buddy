---
name: jenkins-ci
version: 1.0.0
description: Jenkins CI/CD automation with pipeline jobs, Groovy scripting, and API control
author: Code Buddy
tags: jenkins, ci, cd, pipeline, groovy, automation, devops, build, deployment
env:
  JENKINS_URL: ""
  JENKINS_USER: ""
  JENKINS_API_TOKEN: ""
---

# Jenkins CI/CD Automation

Continuous Integration and Continuous Deployment with Jenkins pipelines, Groovy scripting, and comprehensive API control.

## Direct Control (CLI / API / Scripting)

### Jenkins CLI Commands

```bash
# Download Jenkins CLI
wget http://localhost:8080/jnlpJars/jenkins-cli.jar

# Set credentials
export JENKINS_URL="http://localhost:8080"
export JENKINS_USER="admin"
export JENKINS_TOKEN="your-api-token"

# Job operations
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN build my-job
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN build my-job -p PARAM1=value1 -p PARAM2=value2
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN list-jobs
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN get-job my-job > my-job.xml
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN create-job new-job < job-config.xml
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN delete-job old-job
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN disable-job my-job
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN enable-job my-job

# Build information
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN console my-job
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN console my-job 42  # Build number

# Node management
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN list-nodes
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN online-node agent-1
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN offline-node agent-1 -m "Maintenance"

# Plugin management
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN list-plugins
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN install-plugin workflow-aggregator
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN safe-restart

# Credentials
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN list-credentials-context-resolvers

# Queue operations
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN cancel-queue-item 123
```

### Jenkins REST API (cURL)

```bash
# Authentication
JENKINS_CRUMB=$(curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/crumbIssuer/api/json" | jq -r '.crumb')

# Trigger job without parameters
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  "$JENKINS_URL/job/my-job/build"

# Trigger job with parameters
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  "$JENKINS_URL/job/my-job/buildWithParameters?PARAM1=value1&PARAM2=value2"

# Get job info
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/job/my-job/api/json" | jq '.'

# Get last build status
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/job/my-job/lastBuild/api/json" | jq '.result'

# Get build info
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/job/my-job/42/api/json" | jq '.'

# Get console output
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/job/my-job/lastBuild/consoleText"

# Stop build
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  "$JENKINS_URL/job/my-job/42/stop"

# Create job from XML
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  -H "Content-Type: application/xml" \
  --data-binary @job-config.xml \
  "$JENKINS_URL/createItem?name=new-job"

# Update job configuration
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  -H "Content-Type: application/xml" \
  --data-binary @updated-config.xml \
  "$JENKINS_URL/job/my-job/config.xml"

# Delete job
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  "$JENKINS_URL/job/my-job/doDelete"

# Get queue information
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/queue/api/json" | jq '.items'

# Get system information
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/api/json" | jq '.'

# List plugins
curl -s -u $JENKINS_USER:$JENKINS_TOKEN \
  "$JENKINS_URL/pluginManager/api/json?depth=1" | jq '.plugins[] | {shortName, version, enabled}'

# Create credentials
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  -H "Content-Type: application/json" \
  --data '{
    "": "0",
    "credentials": {
      "scope": "GLOBAL",
      "id": "my-credential-id",
      "username": "user",
      "password": "pass",
      "description": "My credentials",
      "$class": "com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl"
    }
  }' \
  "$JENKINS_URL/credentials/store/system/domain/_/createCredentials"
```

### Jenkinsfile (Declarative Pipeline)

```groovy
pipeline {
    agent any

    parameters {
        string(name: 'ENVIRONMENT', defaultValue: 'staging', description: 'Target environment')
        choice(name: 'DEPLOY_TYPE', choices: ['rolling', 'blue-green', 'canary'], description: 'Deployment strategy')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Run test suite')
    }

    environment {
        APP_NAME = 'my-application'
        DOCKER_REGISTRY = 'registry.example.com'
        DOCKER_IMAGE = "${DOCKER_REGISTRY}/${APP_NAME}"
        SLACK_CHANNEL = '#deployments'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
        timeout(time: 1, unit: 'HOURS')
        disableConcurrentBuilds()
    }

    triggers {
        pollSCM('H/5 * * * *')
        cron('H 2 * * 1-5')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    echo "Building ${APP_NAME}:${GIT_COMMIT_SHORT}"
                    sh '''
                        npm install
                        npm run build
                    '''
                }
            }
        }

        stage('Test') {
            when {
                expression { params.RUN_TESTS == true }
            }
            parallel {
                stage('Unit Tests') {
                    steps {
                        sh 'npm run test:unit'
                    }
                }
                stage('Integration Tests') {
                    steps {
                        sh 'npm run test:integration'
                    }
                }
                stage('Lint') {
                    steps {
                        sh 'npm run lint'
                    }
                }
            }
            post {
                always {
                    junit 'test-results/**/*.xml'
                    publishHTML([
                        reportDir: 'coverage',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report'
                    ])
                }
            }
        }

        stage('Security Scan') {
            steps {
                sh 'npm audit --audit-level=moderate'
                sh 'trivy fs --security-checks vuln,config .'
            }
        }

        stage('Docker Build') {
            steps {
                script {
                    docker.build("${DOCKER_IMAGE}:${GIT_COMMIT_SHORT}")
                    docker.build("${DOCKER_IMAGE}:latest")
                }
            }
        }

        stage('Docker Push') {
            steps {
                script {
                    docker.withRegistry("https://${DOCKER_REGISTRY}", 'docker-credentials') {
                        docker.image("${DOCKER_IMAGE}:${GIT_COMMIT_SHORT}").push()
                        docker.image("${DOCKER_IMAGE}:latest").push()
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                script {
                    if (params.ENVIRONMENT == 'production') {
                        input message: 'Deploy to production?', ok: 'Deploy'
                    }

                    withCredentials([
                        string(credentialsId: 'kubeconfig', variable: 'KUBECONFIG_CONTENT')
                    ]) {
                        sh """
                            echo "\$KUBECONFIG_CONTENT" > /tmp/kubeconfig
                            export KUBECONFIG=/tmp/kubeconfig
                            kubectl set image deployment/${APP_NAME} \
                              ${APP_NAME}=${DOCKER_IMAGE}:${GIT_COMMIT_SHORT} \
                              -n ${params.ENVIRONMENT}
                            kubectl rollout status deployment/${APP_NAME} -n ${params.ENVIRONMENT}
                        """
                    }
                }
            }
        }

        stage('Smoke Tests') {
            steps {
                script {
                    def appUrl = "https://${params.ENVIRONMENT}.example.com"
                    sh """
                        curl -f ${appUrl}/health || exit 1
                        curl -f ${appUrl}/api/version || exit 1
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: env.SLACK_CHANNEL,
                color: 'good',
                message: "Deployed ${APP_NAME}:${GIT_COMMIT_SHORT} to ${params.ENVIRONMENT} successfully!"
            )
        }
        failure {
            slackSend(
                channel: env.SLACK_CHANNEL,
                color: 'danger',
                message: "Failed to deploy ${APP_NAME}:${GIT_COMMIT_SHORT} to ${params.ENVIRONMENT}"
            )
        }
        always {
            cleanWs()
        }
    }
}
```

### Jenkinsfile (Scripted Pipeline)

```groovy
node {
    def app
    def dockerImage
    def gitCommit

    try {
        stage('Checkout') {
            checkout scm
            gitCommit = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
        }

        stage('Build') {
            sh 'npm install'
            sh 'npm run build'
        }

        stage('Test') {
            parallel(
                'unit': {
                    sh 'npm run test:unit'
                },
                'integration': {
                    sh 'npm run test:integration'
                }
            )
        }

        stage('Docker') {
            dockerImage = docker.build("myapp:${gitCommit}")
        }

        stage('Deploy') {
            docker.withRegistry('https://registry.example.com', 'docker-credentials') {
                dockerImage.push("${gitCommit}")
                dockerImage.push("latest")
            }
        }

        currentBuild.result = 'SUCCESS'
    } catch (Exception e) {
        currentBuild.result = 'FAILURE'
        throw e
    } finally {
        if (currentBuild.result == 'SUCCESS') {
            slackSend color: 'good', message: "Build ${env.BUILD_NUMBER} succeeded"
        } else {
            slackSend color: 'danger', message: "Build ${env.BUILD_NUMBER} failed"
        }
    }
}
```

### Shared Library (Global Pipeline Library)

```groovy
// vars/buildDockerImage.groovy
def call(Map config) {
    def imageName = config.imageName
    def tag = config.tag ?: 'latest'
    def dockerfilePath = config.dockerfile ?: 'Dockerfile'
    def buildArgs = config.buildArgs ?: [:]

    def buildArgsString = buildArgs.collect { k, v -> "--build-arg ${k}=${v}" }.join(' ')

    sh """
        docker build ${buildArgsString} -t ${imageName}:${tag} -f ${dockerfilePath} .
    """

    return "${imageName}:${tag}"
}

// vars/deployToKubernetes.groovy
def call(Map config) {
    def namespace = config.namespace
    def deployment = config.deployment
    def image = config.image
    def credentialsId = config.credentialsId ?: 'kubeconfig'

    withCredentials([file(credentialsId: credentialsId, variable: 'KUBECONFIG')]) {
        sh """
            kubectl set image deployment/${deployment} \
              ${deployment}=${image} \
              -n ${namespace} \
              --kubeconfig=\$KUBECONFIG

            kubectl rollout status deployment/${deployment} \
              -n ${namespace} \
              --kubeconfig=\$KUBECONFIG \
              --timeout=5m
        """
    }
}

// vars/notifySlack.groovy
def call(String status, String message = '') {
    def color = status == 'SUCCESS' ? 'good' : 'danger'
    def defaultMessage = "Build ${env.BUILD_NUMBER}: ${status}"
    def finalMessage = message ?: defaultMessage

    slackSend(
        channel: '#builds',
        color: color,
        message: finalMessage
    )
}

// Usage in Jenkinsfile
@Library('shared-library') _

pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                script {
                    def image = buildDockerImage(
                        imageName: 'myapp',
                        tag: env.GIT_COMMIT,
                        buildArgs: [VERSION: '1.0.0']
                    )
                    env.DOCKER_IMAGE = image
                }
            }
        }
        stage('Deploy') {
            steps {
                script {
                    deployToKubernetes(
                        namespace: 'production',
                        deployment: 'myapp',
                        image: env.DOCKER_IMAGE
                    )
                }
            }
        }
    }
    post {
        always {
            notifySlack(currentBuild.result)
        }
    }
}
```

## MCP Server Integration

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "npx",
      "args": ["-y", "@lanbaoshen/mcp-jenkins"],
      "env": {
        "JENKINS_URL": "http://localhost:8080",
        "JENKINS_USER": "admin",
        "JENKINS_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Available MCP Tools

**jenkins_trigger_build**
- Triggers a Jenkins job build
- Parameters: `job_name` (string), `parameters` (object), `wait` (boolean)
- Returns: Build number, queue ID, status

**jenkins_get_build_status**
- Gets status of a specific build
- Parameters: `job_name` (string), `build_number` (number)
- Returns: Build status, duration, result, timestamp

**jenkins_get_console_output**
- Retrieves console output from a build
- Parameters: `job_name` (string), `build_number` (number), `start` (optional offset)
- Returns: Console text output

**jenkins_cancel_build**
- Cancels a running build
- Parameters: `job_name` (string), `build_number` (number)
- Returns: Cancellation confirmation

**jenkins_list_jobs**
- Lists all Jenkins jobs
- Parameters: `folder` (optional), `filter` (optional)
- Returns: Array of job names and URLs

**jenkins_get_job_config**
- Retrieves job configuration XML
- Parameters: `job_name` (string)
- Returns: Job configuration XML

**jenkins_create_job**
- Creates a new Jenkins job
- Parameters: `job_name` (string), `config_xml` (string)
- Returns: Creation confirmation

**jenkins_update_job**
- Updates existing job configuration
- Parameters: `job_name` (string), `config_xml` (string)
- Returns: Update confirmation

**jenkins_delete_job**
- Deletes a Jenkins job
- Parameters: `job_name` (string)
- Returns: Deletion confirmation

**jenkins_get_queue**
- Gets current build queue
- Parameters: None
- Returns: Queued items with IDs and jobs

**jenkins_list_nodes**
- Lists all Jenkins nodes/agents
- Parameters: None
- Returns: Node names, labels, status

**jenkins_get_node_info**
- Gets detailed node information
- Parameters: `node_name` (string)
- Returns: Node configuration, executors, status

**jenkins_list_plugins**
- Lists installed plugins
- Parameters: `active_only` (boolean)
- Returns: Plugin names, versions, enabled status

## Common Workflows

### 1. Set Up Complete CI/CD Pipeline

```bash
# Create Jenkinsfile in repository
cat > Jenkinsfile <<'EOF'
pipeline {
    agent {
        docker {
            image 'node:18'
            args '-v /var/run/docker.sock:/var/run/docker.sock'
        }
    }

    environment {
        CI = 'true'
        REGISTRY = credentials('docker-registry')
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Lint & Test') {
            parallel {
                stage('Lint') {
                    steps {
                        sh 'npm run lint'
                    }
                }
                stage('Unit Tests') {
                    steps {
                        sh 'npm run test:unit -- --coverage'
                    }
                }
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Docker Build & Push') {
            when {
                branch 'main'
            }
            steps {
                script {
                    def image = docker.build("myapp:${env.GIT_COMMIT}")
                    docker.withRegistry(env.REGISTRY) {
                        image.push()
                        image.push('latest')
                    }
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    kubectl set image deployment/myapp \
                      myapp=myapp:${GIT_COMMIT} \
                      -n staging
                '''
            }
        }

        stage('Integration Tests') {
            when {
                branch 'main'
            }
            steps {
                sh 'npm run test:e2e'
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                input message: 'Deploy to production?'
                sh '''
                    kubectl set image deployment/myapp \
                      myapp=myapp:${GIT_COMMIT} \
                      -n production
                '''
            }
        }
    }

    post {
        always {
            junit 'test-results/**/*.xml'
            publishHTML([
                reportDir: 'coverage',
                reportFiles: 'index.html',
                reportName: 'Coverage'
            ])
        }
    }
}
EOF

# Create job via API
cat > job-config.xml <<'EOF'
<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>My Application CI/CD Pipeline</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
      <triggers>
        <hudson.triggers.SCMTrigger>
          <spec>H/5 * * * *</spec>
        </hudson.triggers.SCMTrigger>
      </triggers>
    </org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition">
    <scm class="hudson.plugins.git.GitSCM">
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>https://github.com/org/repo.git</url>
          <credentialsId>github-credentials</credentialsId>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/main</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
    </scm>
    <scriptPath>Jenkinsfile</scriptPath>
  </definition>
</flow-definition>
EOF

# Create job
curl -X POST -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: $JENKINS_CRUMB" \
  -H "Content-Type: application/xml" \
  --data-binary @job-config.xml \
  "$JENKINS_URL/createItem?name=my-app-pipeline"
```

### 2. Multi-Branch Pipeline with GitHub Integration

```groovy
// Multibranch Jenkinsfile
pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                echo "Building branch: ${env.BRANCH_NAME}"
                sh 'npm install && npm run build'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Deploy Dev') {
            when {
                branch 'develop'
            }
            steps {
                sh 'kubectl apply -f k8s/dev/ -n dev'
            }
        }

        stage('Deploy Staging') {
            when {
                branch 'staging'
            }
            steps {
                sh 'kubectl apply -f k8s/staging/ -n staging'
            }
        }

        stage('Deploy Production') {
            when {
                branch 'main'
            }
            steps {
                input 'Deploy to production?'
                sh 'kubectl apply -f k8s/prod/ -n production'
            }
        }

        stage('Pull Request Validation') {
            when {
                changeRequest()
            }
            steps {
                echo "Validating PR #${env.CHANGE_ID}"
                sh 'npm run lint'
                sh 'npm test'
            }
        }
    }

    post {
        success {
            echo "Build successful for ${env.BRANCH_NAME}"
        }
        failure {
            echo "Build failed for ${env.BRANCH_NAME}"
        }
    }
}
```

```bash
# Create multibranch pipeline via CLI
cat > multibranch-config.xml <<'EOF'
<?xml version='1.1' encoding='UTF-8'?>
<org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject>
  <sources>
    <data>
      <jenkins.branch.BranchSource>
        <source class="org.jenkinsci.plugins.github_branch_source.GitHubSCMSource">
          <repoOwner>myorg</repoOwner>
          <repository>myrepo</repository>
          <credentialsId>github-token</credentialsId>
          <traits>
            <org.jenkinsci.plugins.github__branch__source.BranchDiscoveryTrait>
              <strategyId>1</strategyId>
            </org.jenkinsci.plugins.github__branch__source.BranchDiscoveryTrait>
            <org.jenkinsci.plugins.github__branch__source.OriginPullRequestDiscoveryTrait>
              <strategyId>1</strategyId>
            </org.jenkinsci.plugins.github__branch__source.OriginPullRequestDiscoveryTrait>
          </traits>
        </source>
      </jenkins.branch.BranchSource>
    </data>
  </sources>
  <factory class="org.jenkinsci.plugins.workflow.multibranch.WorkflowBranchProjectFactory">
    <scriptPath>Jenkinsfile</scriptPath>
  </factory>
</org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject>
EOF

java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_TOKEN \
  create-job my-app-multibranch < multibranch-config.xml
```

### 3. Automated Testing and Quality Gates

```groovy
pipeline {
    agent any

    stages {
        stage('Code Quality') {
            parallel {
                stage('SonarQube Scan') {
                    steps {
                        script {
                            def scannerHome = tool 'SonarScanner'
                            withSonarQubeEnv('SonarQube') {
                                sh "${scannerHome}/bin/sonar-scanner"
                            }
                        }
                    }
                }

                stage('Security Scan') {
                    steps {
                        sh 'trivy fs --security-checks vuln,config .'
                        sh 'npm audit --audit-level=high'
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Performance Tests') {
            steps {
                sh '''
                    artillery run performance-test.yml --output report.json
                    artillery report report.json
                '''
            }
        }
    }

    post {
        always {
            publishHTML([
                reportDir: 'artillery-report',
                reportFiles: 'index.html',
                reportName: 'Performance Test Report'
            ])
        }
    }
}
```

### 4. Blue-Green Deployment Strategy

```groovy
pipeline {
    agent any

    environment {
        BLUE_DEPLOYMENT = 'myapp-blue'
        GREEN_DEPLOYMENT = 'myapp-green'
        SERVICE = 'myapp-service'
        NAMESPACE = 'production'
    }

    stages {
        stage('Determine Active') {
            steps {
                script {
                    def activeVersion = sh(
                        script: """
                            kubectl get service ${SERVICE} -n ${NAMESPACE} \
                              -o jsonpath='{.spec.selector.version}'
                        """,
                        returnStdout: true
                    ).trim()

                    env.ACTIVE = activeVersion
                    env.INACTIVE = (activeVersion == 'blue') ? 'green' : 'blue'
                    env.INACTIVE_DEPLOYMENT = (activeVersion == 'blue') ? GREEN_DEPLOYMENT : BLUE_DEPLOYMENT

                    echo "Active: ${env.ACTIVE}, Deploying to: ${env.INACTIVE}"
                }
            }
        }

        stage('Deploy to Inactive') {
            steps {
                sh """
                    kubectl set image deployment/${env.INACTIVE_DEPLOYMENT} \
                      app=myapp:${env.GIT_COMMIT} \
                      -n ${NAMESPACE}

                    kubectl rollout status deployment/${env.INACTIVE_DEPLOYMENT} -n ${NAMESPACE}
                """
            }
        }

        stage('Smoke Test') {
            steps {
                script {
                    def inactivePodIP = sh(
                        script: """
                            kubectl get pods -n ${NAMESPACE} \
                              -l app=myapp,version=${env.INACTIVE} \
                              -o jsonpath='{.items[0].status.podIP}'
                        """,
                        returnStdout: true
                    ).trim()

                    sh "curl -f http://${inactivePodIP}:8080/health"
                }
            }
        }

        stage('Switch Traffic') {
            steps {
                input message: "Switch traffic to ${env.INACTIVE}?"

                sh """
                    kubectl patch service ${SERVICE} -n ${NAMESPACE} \
                      -p '{"spec":{"selector":{"version":"${env.INACTIVE}"}}}'
                """

                echo "Traffic switched to ${env.INACTIVE}"
            }
        }

        stage('Monitor') {
            steps {
                sleep time: 2, unit: 'MINUTES'
                echo "Monitoring new deployment..."
            }
        }
    }

    post {
        failure {
            script {
                if (env.ACTIVE) {
                    echo "Rolling back to ${env.ACTIVE}"
                    sh """
                        kubectl patch service ${SERVICE} -n ${NAMESPACE} \
                          -p '{"spec":{"selector":{"version":"${env.ACTIVE}"}}}'
                    """
                }
            }
        }
    }
}
```

### 5. Monitoring and Notifications

```groovy
pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                script {
                    try {
                        sh 'npm run build'
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        notifyFailure(e.message)
                        throw e
                    }
                }
            }
        }
    }

    post {
        success {
            script {
                // Slack notification
                slackSend(
                    color: 'good',
                    message: """
                        Build Successful!
                        Job: ${env.JOB_NAME}
                        Build: ${env.BUILD_NUMBER}
                        Commit: ${env.GIT_COMMIT}
                        Author: ${env.GIT_AUTHOR_NAME}
                        Duration: ${currentBuild.durationString}
                        URL: ${env.BUILD_URL}
                    """
                )

                // Email notification
                emailext(
                    subject: "Build ${env.BUILD_NUMBER} - SUCCESS",
                    body: "Build completed successfully",
                    to: 'team@example.com'
                )

                // Update GitHub status
                githubNotify(
                    status: 'SUCCESS',
                    description: 'Build passed',
                    context: 'continuous-integration/jenkins'
                )

                // Send metrics to Prometheus
                sh """
                    curl -X POST http://prometheus-pushgateway:9091/metrics/job/jenkins \
                      --data-binary @- <<EOF
jenkins_build_duration_seconds{job="${env.JOB_NAME}"} ${currentBuild.duration / 1000}
jenkins_build_status{job="${env.JOB_NAME}",result="success"} 1
EOF
                """
            }
        }

        failure {
            script {
                slackSend(
                    color: 'danger',
                    message: """
                        Build Failed!
                        Job: ${env.JOB_NAME}
                        Build: ${env.BUILD_NUMBER}
                        URL: ${env.BUILD_URL}console
                    """
                )

                githubNotify(
                    status: 'FAILURE',
                    description: 'Build failed',
                    context: 'continuous-integration/jenkins'
                )
            }
        }
    }
}

def notifyFailure(String error) {
    slackSend(
        color: 'danger',
        message: "Build Error: ${error}"
    )
}
```
