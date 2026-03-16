# Infrastructure - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `infra/` (Terraform, Kubernetes, Firecracker)  
> **Goal:** High-availability, self-healing, Cloud-Native deployment

---

## 1. Executive Summary

The Infrastructure module provides 100% Infrastructure as Code (IaC) for deploying the AI-Native IDE Platform. It includes Terraform for cloud provisioning, Kubernetes manifests for container orchestration, and Firecracker configurations for secure microVM execution.

---

## 2. Project Structure

### 2.1 Directory Layout

```text
infra/
 ├── terraform/
 │    ├── environments/
 │    │    ├── prod/
 │    │    │    ├── main.tf
 │    │    │    ├── variables.tf
 │    │    │    ├── outputs.tf
 │    │    │    └── backend.tf
 │    │    └── staging/
 │    │        ├── main.tf
 │    │        ├── variables.tf
 │    │        ├── outputs.tf
 │    │        └── backend.tf
 │    └── modules/
 │         ├── vpc/
 │         ├── rds/
 │         ├── eks/
 │         ├── redis/
 │         ├── s3/
 │         ├── elasticsearch/
 │         └── secrets/
 │
 ├── k8s/
 │    ├── helm-charts/
 │    │    ├── api-gateway/
 │    │    ├── auth-service/
 │    │    ├── project-service/
 │    │    └── ... (all services)
 │    ├── ingress/
 │    │    ├── kong-ingress.yaml
 │    │    └── tls-certificates.yaml
 │    ├── service-mesh/
 │    │    ├── istio-config.yaml
 │    │    └── network-policies.yaml
 │    └── monitoring/
 │         ├── prometheus.yaml
 │         ├── grafana-dashboards.yaml
 │         └── loki-stack.yaml
 │
 └── firecracker/
      ├── rootfs-images/
      │    ├── nodejs/Dockerfile
      │    ├── python/Dockerfile
      │    └── golang/Dockerfile
      ├── network/
      │    ├── cni-config.yaml
      │    └── tap-interface.yaml
      └── agent/
           ├── main.go
           └── vsock_handler.go
```

---

## 3. Terraform Modules

### 3.1 VPC Module (modules/vpc/main.tf)

```terraform
# VPC Configuration
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name        = "${var.environment}-vpc"
    Environment = var.environment
  }
}

# Public Subnets (3 AZs)
resource "aws_subnet" "public" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  map_public_ip_on_launch = true
  
  tags = {
    Name        = "${var.environment}-public-${count.index + 1}"
    Type        = "public"
    Environment = var.environment
  }
}

# Private Subnets (3 AZs)
resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name        = "${var.environment}-private-${count.index + 1}"
    Type        = "private"
    Environment = var.environment
  }
}

# NAT Gateways
resource "aws_nat_gateway" "main" {
  count         = 3
  subnet_id     = aws_subnet.public[count.index].id
  allocation_id = aws_eip.nat[count.index].id
  
  tags = {
    Name = "${var.environment}-nat-${count.index + 1}"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = {
    Name = "${var.environment}-igw"
  }
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  
  tags = {
    Name = "${var.environment}-public-rt"
  }
}
```

### 3.2 EKS Module (modules/eks/main.tf)

```terraform
# EKS Cluster
resource "aws_eks_cluster" "main" {
  name     = "${var.environment}-cluster"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.kubernetes_version
  
  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
  }
  
  encryption_config {
    resources = ["secrets"]
    provider {
      key_arn = aws_kms_key.eks.arn
    }
  }
  
  tags = {
    Environment = var.environment
  }
}

# Node Group (Managed)
resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.environment}-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.private_subnet_ids
  
  scaling_config {
    desired_size = var.desired_capacity
    max_size     = var.max_capacity
    min_size     = var.min_capacity
  }
  
  instance_types = var.instance_types
  
  labels = {
    Environment = var.environment
  }
}

# OIDC Provider
resource "aws_iam_openid_connect_provider" "main" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.oidc_thumbprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
}
```

### 3.3 RDS Module (modules/rds/main.tf)

```terraform
# RDS Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.environment}-db-subnet"
  subnet_ids = var.subnet_ids
  
  tags = {
    Name = "${var.environment}-db-subnet-group"
  }
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier           = "${var.environment}-postgres"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = var.instance_class
  allocated_storage    = var.allocated_storage
  storage_encrypted    = true
  storage_type         = "gp3"
  
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"
  
  deletion_protection = var.environment == "prod" ? true : false
  
  tags = {
    Environment = var.environment
  }
}

# Read Replica (for production)
resource "aws_db_instance" "replica" {
  count                = var.environment == "prod" ? 1 : 0
  identifier           = "${var.environment}-postgres-replica"
  engine               = "postgres"
  instance_class       = var.instance_class
  source_db_instance   = aws_db_instance.main.id
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
}
```

### 3.4 Redis Module (modules/redis/main.tf)

```terraform
# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-redis-subnet"
  subnet_ids = var.subnet_ids
}

# Redis Cluster (Cluster Mode Enabled)
resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.environment}-redis"
  engine                     = "redis"
  engine_version             = "7.0"
  node_type                  = var.node_type
  num_cache_clusters         = var.environment == "prod" ? 2 : 1
  
  port                 = 6379
  parameter_group_name = "default.redis7.cluster.on"
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token_enabled         = true
  
  subnet_group_name = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
  
  automatic_failover_enabled = var.environment == "prod" ? true : false
  multi_az_enabled          = var.environment == "prod" ? true : false
  
  snapshot_retention_limit = 7
  
  tags = {
    Environment = var.environment
  }
}
```

### 3.5 S3 Module (modules/s3/main.tf)

```terraform
# S3 Bucket for User Files
resource "aws_s3_bucket" "user_files" {
  bucket = "${var.environment}-user-files"
  
  tags = {
    Environment = var.environment
    Purpose     = "user-files"
  }
}

resource "aws_s3_bucket_versioning" "user_files" {
  bucket = aws_s3_bucket.user_files.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "user_files" {
  bucket = aws_s3_bucket.user_files.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Lifecycle Policy
resource "aws_s3_bucket_lifecycle_configuration" "user_files" {
  bucket = aws_s3_bucket.user_files.id
  
  rule {
    id     = "archive-old-objects"
    status = "Enabled"
    
    expiration {
      days = 365
    }
  }
}

# Additional Buckets
resource "aws_s3_bucket" "snapshots" {
  bucket = "${var.environment}-snapshots"
  
  lifecycle_rule {
    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket" "build_logs" {
  bucket = "${var.environment}-build-logs"
  
  lifecycle_rule {
    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.environment}-artifacts"
  
  lifecycle_rule {
    expiration {
      days = 7
    }
  }
}
```

---

## 4. Kubernetes Manifests

### 4.1 Namespace (k8s/namespace.yaml)

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: platform
  labels:
    istio-injection: enabled
---
apiVersion: v1
kind: Namespace
metadata:
  name: monitoring
---
apiVersion: v1
kind: Namespace
metadata:
  name: firecracker
```

### 4.2 API Gateway Deployment (k8s/helm-charts/api-gateway/values.yaml)

```yaml
replicaCount: 3

image:
  repository: platform/api-gateway
  tag: latest
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 8000

resources:
  limits:
    cpu: 1000m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

env:
  - name: NODE_ENV
    value: production
  - name: JWT_PUBLIC_KEY
    valueFrom:
      secretKeyRef:
        name: jwt-secrets
        key: public-key
  - name: REDIS_URL
    value: redis://platform-redis:6379

ingress:
  enabled: true
  className: kong
  annotations:
    konghq.com/plugins: rate-limiting, cors
  hosts:
    - host: api.platform.io
      paths:
        - path: /
          pathType: Prefix

networkPolicy:
  enabled: true
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8000
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: platform
```

### 4.3 Network Policy (k8s/service-mesh/network-policies.yaml)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: platform
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-gateway-policy
  namespace: platform
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8000
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: auth-service
        - podSelector:
            matchLabels:
              app: project-service
        - podSelector:
            matchLabels:
              app: ai-service
    - to:
        - namespaceSelector:
            matchLabels:
              name: platform
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: auth-service-policy
  namespace: platform
spec:
  podSelector:
    matchLabels:
      app: auth-service
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: kafka
      ports:
        - protocol: TCP
          port: 9092
```

### 4.4 Prometheus Monitoring (k8s/monitoring/prometheus.yaml)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: platform-prometheus
  namespace: monitoring
spec:
  replicas: 2
  retention: 15d
  storage:
    volumeClaimSpec:
      storageClassName: gp3
      resources:
        requests:
          storage: 200Gi
  
  serviceAccountName: prometheus
  
  serviceMonitorSelector:
    matchLabels:
      team: platform
  
  ruleSelector:
    matchLabels:
      role: alert-rules
  
  alerting:
    alertmanagers:
      - namespace: monitoring
        name: alertmanager-main
        port: web
  
  resources:
    requests:
      cpu: 500m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 4Gi
```

### 4.5 Horizontal Pod Autoscaler (k8s/hpa.yaml)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: platform
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
```

---

## 5. Firecracker Configuration

### 5.1 Rootfs Image (firecracker/rootfs-images/nodejs/Dockerfile)

```dockerfile
FROM alpine:3.18 AS builder
RUN apk add --no-cache gcc musl-dev nodejs npm

FROM scratch
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/bin/npm /usr/bin/npm
COPY --from=builder /lib /lib
COPY --from=builder /usr/lib /usr/lib

COPY agent /agent
RUN chmod +x /agent

ENTRYPOINT ["/agent"]
```

### 5.2 Network Config (firecracker/network/cni-config.yaml)

```yaml
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: firecracker-network
  namespace: firecracker
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "firecracker-network",
    "type": "bridge",
    "bridge": "fc-br0",
    "ipam": {
      "type": "host-local",
      "subnet": "10.42.0.0/16",
      "routes": [
        {"dst": "0.0.0.0/0", "gw": "10.42.0.1"}
      ]
    },
    "dns": {
      "nameservers": ["8.8.8.8"]
    }
  }'
```

### 5.3 VM Agent (firecracker/agent/main.go)

```go
package main

import (
    "log"
    "net"
    "os"
    "os/exec"
    "fmt"
)

const (
    VSOCK_PORT = 9000
)

func main() {
    log.Println("Firecracker Agent starting...")
    
    // Setup vsock listener
    listener, err := net.Listen("vsock", fmt.Sprintf(":%d", VSOCK_PORT))
    if err != nil {
        log.Fatalf("Failed to listen on vsock: %v", err)
    }
    
    log.Printf("Listening on vsock port %d", VSOCK_PORT)
    
    for {
        conn, err := listener.Accept()
        if err != nil {
            log.Printf("Accept error: %v", err)
            continue
        }
        
        go handleConnection(conn)
    }
}

func handleConnection(conn net.Conn) {
    defer conn.Close()
    
    buf := make([]byte, 4096)
    n, err := conn.Read(buf)
    if err != nil {
        log.Printf("Read error: %v", err)
        return
    }
    
    // Parse command
    var cmd struct {
        Type string `json:"type"`
        Args []string `json:"args"`
    }
    
    if err := json.Unmarshal(buf[:n], &cmd); err != nil {
        log.Printf("Parse error: %v", err)
        return
    }
    
    switch cmd.Type {
    case "exec":
        executeCommand(conn, cmd.Args)
    case "file":
        handleFileTransfer(conn, cmd.Args)
    case "kill":
        os.Exit(0)
    }
}

func executeCommand(conn net.Conn, args []string) {
    cmd := exec.Command(args[0], args[1:]...)
    cmd.Stdout = conn
    cmd.Stderr = conn
    
    if err := cmd.Run(); err != nil {
        conn.Write([]byte(fmt.Sprintf("Error: %v\n", err)))
    }
}
```

---

## 6. Secrets Management

### 6.1 Vault Configuration

```hcl
# Terraform Vault Provider
provider "vault" {
  address = "https://vault.platform.io"
  token   = var.vault_token
}

# Secret for JWT Keys
resource "vault_generic_secret" "jwt_secrets" {
  path = "secret/data/platform/jwt"
  
  data = {
    public-key  = var.jwt_public_key
    private-key = var.jwt_private_key
  }
}

# Secret for Database
resource "vault_generic_secret" "db_secrets" {
  path = "secret/data/platform/database"
  
  data = {
    username = var.db_username
    password = var.db_password
  }
}

# Secret for External APIs
resource "vault_generic_secret" "external_apis" {
  path = "secret/data/platform/external"
  
  data = {
    stripe-api-key    = var.stripe_key
    aws-access-key    = var.aws_access_key
    aws-secret-key    = var.aws_secret_key
    openai-api-key    = var.openai_key
    anthropic-api-key = var.anthropic_key
  }
}
```

### 6.2 K8s Vault Injector Annotation

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: auth-service
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "platform-auth-service"
    vault.hashicorp.com/agent-inject-secret-jwt: "secret/data/platform/jwt"
    vault.hashicorp.com/agent-inject-template-jwt: |
      {{- with secret "secret/data/platform/jwt" -}}
      export JWT_PUBLIC_KEY="{{ .Data.data.public-key }}"
      {{- end }}
```

---

## 7. CI/CD Pipeline

### 7.1 GitHub Actions Workflow

```yaml
name: Deploy Infrastructure

on:
  push:
    paths:
      - 'infra/**'
    branches:
      - main

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: hashicorp/setup-terraform@v2
        with:
          terraform_version: 1.6.0
      
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Terraform Init
        run: |
          cd infra/terraform/environments/prod
          terraform init -backend-config="bucket=platform-terraform-state"
      
      - name: Terraform Plan
        run: |
          cd infra/terraform/environments/prod
          terraform plan -out=tfplan
      
      - name: Terraform Apply
        if: github.ref == 'refs/heads/main'
        run: |
          cd infra/terraform/environments/prod
          terraform apply tfplan
```

---

## 8. Testing Checklist

```bash
# Terraform
cd infra/terraform/environments/prod
terraform init
terraform validate
terraform plan
terraform apply

# Kubernetes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/service-mesh/network-policies.yaml
kubectl apply -f k8s/hpa.yaml
helm install api-gateway k8s/helm-charts/api-gateway

# Verify
kubectl get pods -n platform
kubectl get hpa -n platform
kubectl get networkpolicies -n platform
```

---

## 9. Implementation Status

| Component | Status |
|-----------|--------|
| Terraform Modules | ✅ Complete |
| VPC & Networking | ✅ Complete |
| EKS Cluster | ✅ Complete |
| RDS PostgreSQL | ✅ Complete |
| ElastiCache Redis | ✅ Complete |
| S3 Buckets | ✅ Complete |
| K8s Manifests | ✅ Complete |
| Network Policies | ✅ Complete |
| Monitoring | ✅ Complete |
| Firecracker | ✅ Complete |
| Vault Integration | ✅ Complete |
| CI/CD Pipeline | ✅ Complete |

---

## 10. Key Implementation Notes

### 10.1 Firecracker MicroVMs
- Pre-warmed VM pools for <125ms boot
- Minimal rootfs (alpine-based)
- Jailer for isolation
- vsock for host communication

### 10.2 Zero-Trust Networking
- Service mesh with mTLS
- Default DENY ALL policy
- Explicit NetworkPolicies

### 10.3 Infrastructure as Code
- 100% Terraform-defined
- S3 backend with DynamoDB locking
- Segregated state files

### 10.4 Secrets Management
- HashiCorp Vault only
- K8s Vault Agent injection
- Ephemeral memory mounts

### 10.5 Auto-Scaling
- HPA with CPU/Memory metrics
- Custom metrics for VM queue
- PagerDuty alerts for latency
