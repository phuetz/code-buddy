---
name: n8n
version: 1.0.0
description: n8n workflow automation - create, trigger, and manage workflows via REST API and webhooks
author: Code Buddy
tags: automation, workflows, integration, api, webhooks, etl
env:
  N8N_API_URL: ""
  N8N_API_KEY: ""
---

# n8n Workflow Automation

n8n is a fair-code workflow automation platform that connects apps, services, and APIs. This skill enables you to create, manage, and trigger n8n workflows programmatically through REST API calls and webhook triggers.

## Direct Control (CLI / API / Scripting)

### REST API Authentication

All n8n API requests require an API key in the `X-N8N-API-KEY` header:

```bash
# Set your n8n instance URL and API key
export N8N_API_URL="https://your-n8n-instance.com/api/v1"
export N8N_API_KEY="your-api-key-here"

# Test connection
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows"
```

### Workflow Management

```bash
# List all workflows
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows"

# Get specific workflow
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/{workflowId}"

# Create new workflow
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Workflow",
    "nodes": [
      {
        "name": "Start",
        "type": "n8n-nodes-base.start",
        "position": [250, 300],
        "parameters": {}
      },
      {
        "name": "HTTP Request",
        "type": "n8n-nodes-base.httpRequest",
        "position": [450, 300],
        "parameters": {
          "url": "https://api.example.com/data",
          "method": "GET"
        }
      }
    ],
    "connections": {
      "Start": {
        "main": [[{"node": "HTTP Request", "type": "main", "index": 0}]]
      }
    },
    "active": true,
    "settings": {}
  }' \
  "$N8N_API_URL/workflows"

# Update workflow
curl -X PATCH \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}' \
  "$N8N_API_URL/workflows/{workflowId}"

# Delete workflow
curl -X DELETE \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/{workflowId}"
```

### Workflow Execution

```bash
# Execute workflow manually
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/{workflowId}/activate"

# Trigger webhook workflow
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"data": "your-payload"}' \
  "https://your-n8n-instance.com/webhook/{webhook-path}"

# Trigger workflow with test webhook
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"userId": 123, "action": "test"}' \
  "https://your-n8n-instance.com/webhook-test/{webhook-path}"

# Get workflow execution history
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?workflowId={workflowId}&limit=10"

# Get specific execution details
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions/{executionId}"

# Delete execution
curl -X DELETE \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions/{executionId}"
```

### Credentials Management

```bash
# List credentials
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/credentials"

# Create credential
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key",
    "type": "httpHeaderAuth",
    "data": {
      "name": "Authorization",
      "value": "Bearer token-here"
    }
  }' \
  "$N8N_API_URL/credentials"

# Delete credential
curl -X DELETE \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/credentials/{credentialId}"
```

### Node.js/TypeScript Integration

```typescript
import axios from 'axios';

const n8nClient = axios.create({
  baseURL: process.env.N8N_API_URL,
  headers: {
    'X-N8N-API-KEY': process.env.N8N_API_KEY,
  },
});

// List workflows
async function listWorkflows() {
  const response = await n8nClient.get('/workflows');
  return response.data;
}

// Trigger workflow via webhook
async function triggerWorkflow(webhookPath: string, payload: any) {
  const response = await axios.post(
    `https://your-n8n-instance.com/webhook/${webhookPath}`,
    payload
  );
  return response.data;
}

// Get execution status
async function getExecution(executionId: string) {
  const response = await n8nClient.get(`/executions/${executionId}`);
  return response.data;
}

// Create and activate workflow
async function createWorkflow(workflow: any) {
  const response = await n8nClient.post('/workflows', workflow);
  const workflowId = response.data.id;

  // Activate it
  await n8nClient.post(`/workflows/${workflowId}/activate`);

  return response.data;
}
```

## MCP Server Integration

Add this to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["-y", "@czlonkowski/n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://your-n8n-instance.com/api/v1",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Available MCP Tools

The n8n MCP server provides:

- **list_workflows** - List all workflows with their IDs and active status
- **get_workflow** - Get detailed workflow definition including nodes and connections
- **create_workflow** - Create a new workflow from JSON definition
- **update_workflow** - Update existing workflow (activate/deactivate, modify nodes)
- **delete_workflow** - Delete a workflow by ID
- **execute_workflow** - Manually trigger workflow execution
- **list_executions** - Get execution history for a workflow
- **get_execution** - Get detailed execution data including input/output for each node
- **trigger_webhook** - Send data to a webhook trigger
- **list_credentials** - List available credentials (names only, no secrets)
- **create_credential** - Create new API credentials for nodes to use

### MCP Usage Examples

```typescript
// List all workflows
const workflows = await mcp.callTool('n8n', 'list_workflows', {});

// Get workflow details
const workflow = await mcp.callTool('n8n', 'get_workflow', {
  workflowId: '123'
});

// Create ETL workflow
const newWorkflow = await mcp.callTool('n8n', 'create_workflow', {
  name: 'GitHub to Slack Pipeline',
  nodes: [
    {
      name: 'GitHub Webhook',
      type: 'n8n-nodes-base.githubTrigger',
      parameters: {
        events: ['push', 'pull_request']
      }
    },
    {
      name: 'Slack',
      type: 'n8n-nodes-base.slack',
      parameters: {
        channel: '#deployments',
        text: '={{$json["commits"][0]["message"]}}'
      }
    }
  ]
});

// Execute workflow and wait for result
const execution = await mcp.callTool('n8n', 'execute_workflow', {
  workflowId: '123',
  wait: true
});

// Check execution status
const status = await mcp.callTool('n8n', 'get_execution', {
  executionId: execution.id
});
```

## Common Workflows

### 1. Create Data Sync Workflow (API → Database)

```bash
# Step 1: Create workflow that polls API and writes to database
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API to Database Sync",
    "nodes": [
      {
        "name": "Schedule Trigger",
        "type": "n8n-nodes-base.scheduleTrigger",
        "position": [250, 300],
        "parameters": {
          "rule": {
            "interval": [{"field": "minutes", "minutesInterval": 15}]
          }
        }
      },
      {
        "name": "HTTP Request",
        "type": "n8n-nodes-base.httpRequest",
        "position": [450, 300],
        "parameters": {
          "url": "https://api.example.com/users",
          "method": "GET",
          "authentication": "genericCredentialType",
          "genericAuthType": "httpHeaderAuth"
        }
      },
      {
        "name": "Postgres",
        "type": "n8n-nodes-base.postgres",
        "position": [650, 300],
        "parameters": {
          "operation": "insert",
          "table": "users",
          "columns": "id,name,email,created_at"
        }
      }
    ],
    "connections": {
      "Schedule Trigger": {
        "main": [[{"node": "HTTP Request", "type": "main", "index": 0}]]
      },
      "HTTP Request": {
        "main": [[{"node": "Postgres", "type": "main", "index": 0}]]
      }
    },
    "active": true
  }' \
  "$N8N_API_URL/workflows"

# Step 2: Verify workflow is running
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows" | grep "API to Database Sync"

# Step 3: Monitor executions
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?limit=5"
```

### 2. Webhook-Triggered Notification Pipeline

```bash
# Step 1: Create workflow with webhook trigger
WORKFLOW_ID=$(curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alert Pipeline",
    "nodes": [
      {
        "name": "Webhook",
        "type": "n8n-nodes-base.webhook",
        "position": [250, 300],
        "parameters": {
          "path": "alert",
          "httpMethod": "POST",
          "responseMode": "onReceived"
        },
        "webhookId": "alert-webhook"
      },
      {
        "name": "Filter Critical",
        "type": "n8n-nodes-base.if",
        "position": [450, 300],
        "parameters": {
          "conditions": {
            "string": [
              {
                "value1": "={{$json[\"severity\"]}}",
                "operation": "equal",
                "value2": "critical"
              }
            ]
          }
        }
      },
      {
        "name": "Send Slack Alert",
        "type": "n8n-nodes-base.slack",
        "position": [650, 200],
        "parameters": {
          "channel": "#alerts",
          "text": "🚨 CRITICAL: {{$json[\"message\"]}}"
        }
      },
      {
        "name": "Send Email",
        "type": "n8n-nodes-base.emailSend",
        "position": [650, 400],
        "parameters": {
          "toEmail": "oncall@company.com",
          "subject": "Critical Alert",
          "text": "={{$json[\"message\"]}}"
        }
      }
    ],
    "connections": {
      "Webhook": {
        "main": [[{"node": "Filter Critical", "type": "main", "index": 0}]]
      },
      "Filter Critical": {
        "main": [
          [{"node": "Send Slack Alert", "type": "main", "index": 0}],
          [{"node": "Send Email", "type": "main", "index": 0}]
        ]
      }
    },
    "active": true
  }' \
  "$N8N_API_URL/workflows" | jq -r '.id')

# Step 2: Get webhook URL
WEBHOOK_URL="https://your-n8n-instance.com/webhook/alert"

# Step 3: Test webhook trigger
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "severity": "critical",
    "message": "Database CPU at 95%",
    "service": "postgres-prod"
  }' \
  "$WEBHOOK_URL"

# Step 4: Verify execution
sleep 2
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?workflowId=$WORKFLOW_ID&limit=1"
```

### 3. Multi-Step ETL with Error Handling

```bash
# Create robust ETL workflow with error handling
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ETL with Error Handling",
    "nodes": [
      {
        "name": "Cron Trigger",
        "type": "n8n-nodes-base.cron",
        "position": [250, 300],
        "parameters": {
          "cronExpression": "0 2 * * *"
        }
      },
      {
        "name": "Extract from API",
        "type": "n8n-nodes-base.httpRequest",
        "position": [450, 300],
        "parameters": {
          "url": "https://api.example.com/data",
          "method": "GET"
        },
        "continueOnFail": true
      },
      {
        "name": "Transform Data",
        "type": "n8n-nodes-base.code",
        "position": [650, 300],
        "parameters": {
          "language": "javascript",
          "code": "return items.map(item => ({\n  json: {\n    id: item.json.id,\n    name: item.json.name.toUpperCase(),\n    processed_at: new Date().toISOString()\n  }\n}));"
        }
      },
      {
        "name": "Load to Database",
        "type": "n8n-nodes-base.postgres",
        "position": [850, 300],
        "parameters": {
          "operation": "insert",
          "table": "etl_output"
        },
        "continueOnFail": true
      },
      {
        "name": "Error Handler",
        "type": "n8n-nodes-base.executeWorkflowTrigger",
        "position": [650, 500],
        "parameters": {}
      }
    ],
    "connections": {
      "Cron Trigger": {
        "main": [[{"node": "Extract from API", "type": "main", "index": 0}]]
      },
      "Extract from API": {
        "main": [[{"node": "Transform Data", "type": "main", "index": 0}]]
      },
      "Transform Data": {
        "main": [[{"node": "Load to Database", "type": "main", "index": 0}]]
      }
    },
    "active": true,
    "settings": {
      "errorWorkflow": "error-handler-workflow-id"
    }
  }' \
  "$N8N_API_URL/workflows"
```

### 4. Monitor and Manage Workflow Executions

```bash
# Get recent executions with status
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?limit=20" | \
  jq '.data[] | {id, workflowId, finished, mode, startedAt, stoppedAt}'

# Find failed executions
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?limit=50" | \
  jq '.data[] | select(.finished == false or .data.resultData.error != null)'

# Get detailed error information
FAILED_EXECUTION_ID="execution-id-here"
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions/$FAILED_EXECUTION_ID" | \
  jq '.data.resultData.error'

# Retry failed workflow manually
WORKFLOW_ID=$(curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions/$FAILED_EXECUTION_ID" | \
  jq -r '.workflowId')

curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/$WORKFLOW_ID/activate"

# Clean up old executions (keep last 100)
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?limit=1000" | \
  jq -r '.data[100:] | .[].id' | \
  while read exec_id; do
    curl -X DELETE \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      "$N8N_API_URL/executions/$exec_id"
  done
```

### 5. Backup and Restore Workflows

```bash
# Backup all workflows to JSON file
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows" | \
  jq '.data' > n8n_workflows_backup_$(date +%Y%m%d).json

# Restore workflows from backup
cat n8n_workflows_backup_20260207.json | \
  jq -c '.[]' | \
  while read workflow; do
    # Remove ID to create as new workflow
    workflow_data=$(echo "$workflow" | jq 'del(.id)')

    curl -X POST \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$workflow_data" \
      "$N8N_API_URL/workflows"
  done

# Export specific workflow
WORKFLOW_ID="123"
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/$WORKFLOW_ID" > workflow_${WORKFLOW_ID}.json

# Import workflow from file
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow_123.json \
  "$N8N_API_URL/workflows"
```
