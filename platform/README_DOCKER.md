# 🐳 Development Docker Setup

This directory contains a complete, containerized development environment for the AI-Native IDE platform.

## 🚀 Quick Start

1.  **Duplicate `.env.docker` to `.env` (optional)**:
    The Docker setup uses `.env.docker` by default, but some local commands might need `.env`.

2.  **Start the environment**:
    ```bash
    pnpm docker:dev
    ```
    This will start all infrastructure (Postgres, Redis, Kafka, Elasticsearch, MinIO) and all 14 microservices + the IDE frontend.

3.  **Initialize the Database**:
    Once the `postgres` and `api-gateway` services are up, run:
    ```bash
    pnpm docker:db-init
    ```

## 🛠 Services & Ports

### Backend Services
| Service | Port |
| :--- | :--- |
| **API Gateway** | [8000](http://localhost:8000) |
| **WebSocket Gateway** | [8012](ws://localhost:8012) |
| **Auth Service** | [3100](http://localhost:3100) |
| **Project Service** | [8002](http://localhost:8002) |
| **Execution Service** | [8004](http://localhost:8004) |
| **AI Service** | [8003](http://localhost:8003) |
| **Billing Service** | [8006](http://localhost:8006) |
| **Notification Service** | [8007](http://localhost:8007) |
| **Collab Service** | [8005](http://localhost:8005) |
| **Storage Service** | [8009](http://localhost:8009) |
| **Deployment Service** | [8010](http://localhost:8010) |
| **Analytics Service** | [8011](http://localhost:8011) |
| **Search Service** | [8008](http://localhost:8008) |

### Frontend Apps
| App | Port |
| :--- | :--- |
| **IDE Frontend** | [5173](http://localhost:5173) |

### Infrastructure
| Infra | Port |
| :--- | :--- |
| **PostgreSQL** | 5432 |
| **Redis** | 6379 |
| **Kafka** | 9092 |
| **Elasticsearch** | 9200 |
| **MinIO (API/Console)** | 9000 / 9001 |

## 📝 development Notes

- **Hot Reloading**: All services have their source code mounted as volumes. Changes to the code will trigger a restart/reload inside the container.
- **Node Modules**: The setup uses anonymous volumes for `node_modules` to avoid conflicts between the host and the container.
- **Resources**: Running the full stack requires significant RAM (approx. 8GB+). If you have performance issues, consider commenting out unused services in `docker-compose.dev.yml`.
