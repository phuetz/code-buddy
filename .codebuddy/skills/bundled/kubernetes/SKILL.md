---
name: kubernetes
version: 1.0.0
description: Kubernetes cluster management with kubectl, Helm charts, and ArgoCD GitOps
author: Code Buddy
tags: kubernetes, k8s, kubectl, helm, argocd, containers, orchestration, devops
env:
  KUBECONFIG: ""
  ARGOCD_SERVER: ""
  ARGOCD_AUTH_TOKEN: ""
---

# Kubernetes Management

Comprehensive Kubernetes cluster operations including resource management, Helm package deployment, and ArgoCD continuous delivery workflows.

## Direct Control (CLI / API / Scripting)

### kubectl Commands

```bash
# Cluster info
kubectl cluster-info
kubectl get nodes -o wide
kubectl top nodes
kubectl version --short

# Namespace operations
kubectl get namespaces
kubectl create namespace my-app
kubectl config set-context --current --namespace=my-app

# Pod management
kubectl get pods -A
kubectl get pods -n production -o wide
kubectl describe pod my-app-7d5f6b8c9-xk2lm
kubectl logs my-app-7d5f6b8c9-xk2lm -f
kubectl logs my-app-7d5f6b8c9-xk2lm --previous
kubectl exec -it my-app-7d5f6b8c9-xk2lm -- /bin/bash
kubectl port-forward my-app-7d5f6b8c9-xk2lm 8080:80

# Deployment operations
kubectl get deployments -A
kubectl scale deployment my-app --replicas=5
kubectl rollout status deployment/my-app
kubectl rollout history deployment/my-app
kubectl rollout undo deployment/my-app
kubectl set image deployment/my-app app=myapp:v2

# Service and ingress
kubectl get services -A
kubectl get ingress -A
kubectl expose deployment my-app --port=80 --target-port=8080 --type=LoadBalancer

# ConfigMaps and Secrets
kubectl create configmap app-config --from-file=config.yaml
kubectl create secret generic db-credentials --from-literal=password=secretpass
kubectl get secrets -n production
kubectl get configmap app-config -o yaml

# Resource management
kubectl apply -f deployment.yaml
kubectl delete -f deployment.yaml
kubectl diff -f deployment.yaml
kubectl get all -n production
kubectl api-resources

# Debug and troubleshoot
kubectl get events -A --sort-by='.lastTimestamp'
kubectl describe node worker-node-1
kubectl top pods -n production
kubectl get pod my-app-7d5f6b8c9-xk2lm -o yaml
```

### Helm Commands

```bash
# Repository management
helm repo add stable https://charts.helm.sh/stable
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm repo list
helm search repo nginx

# Chart installation
helm install my-release bitnami/nginx
helm install my-release ./my-chart --values values.yaml
helm install my-release bitnami/postgresql \
  --set postgresqlPassword=secretpass \
  --set persistence.size=20Gi \
  --namespace database --create-namespace

# Release management
helm list -A
helm status my-release
helm get values my-release
helm get manifest my-release
helm upgrade my-release bitnami/nginx --version 10.0.0
helm upgrade my-release ./my-chart --values values.yaml --install
helm rollback my-release 1
helm uninstall my-release

# Chart development
helm create my-chart
helm lint my-chart
helm template my-release ./my-chart --values values.yaml
helm package my-chart
helm dependency update my-chart
```

### ArgoCD Commands

```bash
# Login
argocd login argocd.example.com --username admin --password password
argocd login argocd.example.com --sso

# Application management
argocd app create my-app \
  --repo https://github.com/org/repo.git \
  --path kubernetes/manifests \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace production

argocd app list
argocd app get my-app
argocd app sync my-app
argocd app sync my-app --prune --force
argocd app delete my-app
argocd app set my-app --revision main
argocd app diff my-app

# Application status
argocd app wait my-app --health
argocd app history my-app
argocd app logs my-app -f
argocd app manifests my-app

# Cluster management
argocd cluster add my-cluster
argocd cluster list
argocd cluster get https://kubernetes.default.svc

# Repository management
argocd repo add https://github.com/org/repo.git --username user --password token
argocd repo list
```

### Kubernetes API (Python)

```python
from kubernetes import client, config

# Load config from ~/.kube/config
config.load_kube_config()

# Core API
v1 = client.CoreV1Api()

# List all pods in namespace
pods = v1.list_namespaced_pod(namespace="production")
for pod in pods.items:
    print(f"{pod.metadata.name} - {pod.status.phase}")

# Create deployment
apps_v1 = client.AppsV1Api()
deployment = client.V1Deployment(
    metadata=client.V1ObjectMeta(name="my-app"),
    spec=client.V1DeploymentSpec(
        replicas=3,
        selector=client.V1LabelSelector(
            match_labels={"app": "my-app"}
        ),
        template=client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(labels={"app": "my-app"}),
            spec=client.V1PodSpec(
                containers=[
                    client.V1Container(
                        name="app",
                        image="nginx:latest",
                        ports=[client.V1ContainerPort(container_port=80)]
                    )
                ]
            )
        )
    )
)
apps_v1.create_namespaced_deployment(namespace="production", body=deployment)

# Watch pod events
watch = client.watch.Watch()
for event in watch.stream(v1.list_namespaced_pod, namespace="production"):
    print(f"Event: {event['type']} {event['object'].metadata.name}")
```

## MCP Server Integration

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-kubernetes"],
      "env": {
        "KUBECONFIG": "/home/user/.kube/config"
      }
    }
  }
}
```

### Available MCP Tools

**kubernetes_list_pods**
- Lists pods in a namespace
- Parameters: `namespace` (string)
- Returns: Pod names, status, IPs, node placement

**kubernetes_get_pod_logs**
- Retrieves logs from a pod
- Parameters: `pod_name` (string), `namespace` (string), `container` (optional), `tail_lines` (optional)
- Returns: Container logs

**kubernetes_describe_resource**
- Describes any Kubernetes resource
- Parameters: `resource_type` (string), `name` (string), `namespace` (string)
- Returns: Detailed resource description

**kubernetes_apply_manifest**
- Applies YAML manifest to cluster
- Parameters: `manifest` (string YAML), `namespace` (string)
- Returns: Applied resource details

**kubernetes_delete_resource**
- Deletes a Kubernetes resource
- Parameters: `resource_type` (string), `name` (string), `namespace` (string)
- Returns: Deletion confirmation

**kubernetes_scale_deployment**
- Scales deployment replicas
- Parameters: `deployment_name` (string), `namespace` (string), `replicas` (number)
- Returns: Scaling operation status

**kubernetes_port_forward**
- Creates port forwarding to a pod
- Parameters: `pod_name` (string), `namespace` (string), `local_port` (number), `remote_port` (number)
- Returns: Port forward session info

**kubernetes_exec_command**
- Executes command in pod container
- Parameters: `pod_name` (string), `namespace` (string), `command` (array), `container` (optional)
- Returns: Command output

## Common Workflows

### 1. Deploy Application with Rolling Update

```bash
# Create namespace
kubectl create namespace my-app

# Apply deployment manifest
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: app
        image: myregistry/my-app:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
EOF

# Create service
kubectl expose deployment my-app --port=80 --target-port=8080 --type=LoadBalancer -n my-app

# Watch rollout
kubectl rollout status deployment/my-app -n my-app

# Update to new version
kubectl set image deployment/my-app app=myregistry/my-app:v2.0.0 -n my-app

# Monitor update
kubectl rollout status deployment/my-app -n my-app
kubectl get pods -n my-app -w

# Rollback if needed
kubectl rollout undo deployment/my-app -n my-app
```

### 2. Install Application with Helm and Custom Values

```bash
# Create values file
cat > my-values.yaml <<EOF
replicaCount: 3

image:
  repository: myregistry/my-app
  tag: "1.5.0"
  pullPolicy: IfNotPresent

service:
  type: LoadBalancer
  port: 80
  targetPort: 8080

ingress:
  enabled: true
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: myapp.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: myapp-tls
      hosts:
        - myapp.example.com

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

postgresql:
  enabled: true
  auth:
    username: myapp
    password: secretpass
    database: myappdb
  persistence:
    size: 20Gi
EOF

# Install with Helm
helm install my-app ./my-chart \
  --values my-values.yaml \
  --namespace production \
  --create-namespace \
  --wait \
  --timeout 5m

# Verify installation
helm list -n production
kubectl get all -n production
kubectl get ingress -n production

# Upgrade with new values
helm upgrade my-app ./my-chart \
  --values my-values.yaml \
  --set replicaCount=5 \
  --namespace production \
  --wait

# Check release history
helm history my-app -n production
```

### 3. Setup GitOps with ArgoCD

```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods
kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd

# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward to access UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Login with CLI
argocd login localhost:8080 --username admin --password <password> --insecure

# Add Git repository
argocd repo add https://github.com/org/k8s-manifests.git \
  --username git-user \
  --password ghp_token123

# Create application
argocd app create my-production-app \
  --repo https://github.com/org/k8s-manifests.git \
  --path apps/my-app/overlays/production \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace production \
  --sync-policy automated \
  --auto-prune \
  --self-heal

# Enable auto-sync
argocd app set my-production-app --sync-policy automated

# Monitor sync status
argocd app get my-production-app
argocd app wait my-production-app --health

# Manual sync if needed
argocd app sync my-production-app --prune
```

### 4. Debug Failed Pods and Resource Issues

```bash
# Find failing pods
kubectl get pods -A | grep -v Running

# Get detailed pod info
kubectl describe pod failing-pod-abc123 -n production

# Check recent events
kubectl get events -n production --sort-by='.lastTimestamp' | tail -20

# Get logs (current container)
kubectl logs failing-pod-abc123 -n production --tail=100

# Get logs (previous crashed container)
kubectl logs failing-pod-abc123 -n production --previous

# Check resource usage
kubectl top nodes
kubectl top pods -n production --sort-by=memory
kubectl top pods -n production --sort-by=cpu

# Exec into pod for debugging
kubectl exec -it failing-pod-abc123 -n production -- /bin/sh

# Check container state
kubectl get pod failing-pod-abc123 -n production -o jsonpath='{.status.containerStatuses[0].state}'

# Verify config and secrets
kubectl get configmap app-config -n production -o yaml
kubectl get secret app-secrets -n production -o jsonpath='{.data}'

# Check service endpoints
kubectl get endpoints my-app-service -n production

# Network debugging pod
kubectl run netshoot --image=nicolaka/netshoot --rm -it -- /bin/bash
# Inside pod: nslookup my-app-service, curl, traceroute, etc.

# Force delete stuck pod
kubectl delete pod stuck-pod-abc123 -n production --grace-period=0 --force
```

### 5. Backup and Disaster Recovery

```bash
# Backup all resources in namespace
kubectl get all,configmap,secret,ingress,pvc -n production -o yaml > production-backup.yaml

# Export specific resource types
kubectl get deployments,statefulsets,services -n production -o yaml > deployments-backup.yaml

# Backup with Velero (if installed)
velero backup create production-backup --include-namespaces production
velero backup describe production-backup
velero backup logs production-backup

# Restore from backup
kubectl apply -f production-backup.yaml

# Velero restore
velero restore create --from-backup production-backup

# Export all cluster resources (disaster recovery)
kubectl get all --all-namespaces -o yaml > full-cluster-backup.yaml

# Backup ETCD (for cluster admins)
ETCDCTL_API=3 etcdctl snapshot save snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify snapshot
ETCDCTL_API=3 etcdctl snapshot status snapshot.db --write-out=table

# Export Helm releases
helm list -A -o yaml > helm-releases-backup.yaml

# Backup PersistentVolumes
kubectl get pv -o yaml > pv-backup.yaml
kubectl get pvc -A -o yaml > pvc-backup.yaml
```
