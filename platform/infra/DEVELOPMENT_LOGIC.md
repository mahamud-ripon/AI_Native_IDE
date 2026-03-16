# ☁️ Infrastructure & DevOps — Elite Engineering Logic & Architecture

> **Target:** `infra/` (`terraform/`, `k8s/`, `firecracker/`)
> **Goal:** High-availability, self-healing, Cloud-Native deployment for a massive Tier-1 Cloud IDE. Fully automated environment provisioning. Sub-125ms VM boots. 
> **Standard:** 100% Infrastructure as Code (IaC). Zero Click Ops. Immutable infrastructure. Elite SRE principles.

## 📁 Required File Structure (DevOps must follow)
```text
infra/
 ├── terraform/                    # ☁️ Cloud Provisioning (AWS/GCP)
 │    ├── environments/
 │    │    ├── prod/               # Highly available, multi-AZ configurations
 │    │    └── staging/            # Cost-optimized replica of prod
 │    └── modules/                 # Reusable modules (VPC, RDS, EKS, Redis)
 │
 ├── k8s/                          # ☸️ Kubernetes Manifests & Helm Configs
 │    ├── helm-charts/             # Charts for all microservices
 │    ├── ingress/                 # Kong/Nginx configs (TLS, Rate Limits)
 │    ├── service-mesh/            # Istio or Linkerd (Zero Trust networking)
 │    └── monitoring/              # Prometheus, Grafana, Loki stacks
 │
 └── firecracker/                  # 🔥 MicroVM Runtime Configs (The Metal)
      ├── rootfs-images/           # Minimal alpine/ubuntu Dockerfiles (Node/Python/Go)
      ├── network/                 # CNI plugin configs, Tap interfaces
      └── agent/                   # The tiny init binary that runs INSIDE the VM
```

## 🧠 Elite Engineering Guidelines for Developer (DO NOT DEVIATE)

### 1. Firecracker Lifecycle & Hyper-Optimization (The Core Differentiator)
- **Constraint:** Running traditional Docker containers for user code is insecure (root escapes) and too slow to boot. Heavy VMs take 30 seconds to boot. We need isolation in < 125ms.
- **Elite Logic:**
  - **No Docker:** Use bare-metal AWS EC2 `.metal` instances (or nested virtualization compatible hypervisors). Run `firecracker` directly on the host OS.
  - **Pre-warmed Pools:** The `execution-service` must maintain a pool of "warm" Firecracker VMs (already booted, but paused). When a user opens a project, inject the repo state via vsock and unpause in milliseconds.
  - **Minimal rootfs (ext4):** The OS images must be stripped down to the absolute bare minimum (`alpine` based). No SSH daemon, no unnecessary services. Only an `agent` listening on `AF_VSOCK`.
  - **Jailer:** Every Firecracker process MUST be wrapped in the Firecracker `jailer`—dropped privileges, isolated chroot, aggressive seccomp-bpf filters. Zero exceptions.

### 2. The Zero-Trust Service Mesh (Kubernetes)
- **Constraint:** If the `project-service` is compromised, the attacker must not be able to freely ping the `billing-service` database.
- **Elite Logic:**
  - Implement a Service Mesh (e.g., Istio / Linkerd).
  - Default policy: **DENY ALL**.
  - Provide explicit NetworkPolicies: Only the `api-gateway` can talk to microservices. `collab-service` can talk to `websocket-gateway` and `database`, but it CANNOT initiate a connection to `auth-service`.
  - All inter-service communication inside the cluster MUST flow over mTLS (Mutual TLS). No unencrypted data is allowed on the internal network.

### 3. Terraform Immutability & State Management
- **Constraint:** Manual changes in the AWS Console ("Click Ops") cause configuration drift and late-night outages.
- **Elite Logic:**
  - Absolutely NO manual manipulation of resources. If a resource isn't defined in Terraform, it does not exist (and will be wiped by Terraform).
  - Use an S3 backend with DynamoDB locking for Terraform state.
  - Segregate state: Keep the VPC/Database state separate from the App Layer state. If the app layer deployment crashes, the database state remains untouched.

### 4. Secrets Management (HashiCorp Vault Integration)
- **Constraint:** Hardcoding Stripe API keys or Database passwords in GitHub Actions or K8s Secret YAML files is a critical vulnerability.
- **Elite Logic:**
  - Secrets live ONLY in HashiCorp Vault.
  - K8s pods use the `Vault Auto-Auth` mechanism with their Kubernetes Service Account tokens.
  - When the `auth-service` boots, the Vault sidecar injector places the Private Key in an ephemeral memory mount (`/vault/secrets/`), which the app reads exactly once and scrubs.

### 5. Datadog / Prometheus SRE Triggers (Auto-Scaling)
- **Constraint:** Traffic spikes (e.g., after launching on ProductHunt) will kill the IDE unless the platform scales preemptively.
- **Elite Logic:**
  - Setup Horizontal Pod Autoscalers (HPA) targeting Custom Metrics (e.g., CPU, Memory, or HTTP 5XX error rates).
  - If `execution-service` VM queue drops below 20% capacity, autoscale the underlaying Auto Scaling Group (ASG) to spin up a new EC2 Bare Metal host immediately.
  - Define strict P99 latency alerts: If `api-gateway` latency exceeds 200ms for more than 2 minutes, trigger a PagerDuty alert to the on-call engineer.
