# AI Service - Implementation Guide (PRD)

> **Version:** 2.0
> **Date:** March 12, 2026
> **Service:** ai-service (Port 8003)
> **Tech Stack:** TypeScript + Node.js + Fastify

---

## 1. Superseded Notice

> **IMPORTANT:** The detailed Python LangGraph documentation originally in this file has been migrated strictly to the `ai-agents` package/service.
> 
> See `platform/ai-agents/PRD.md` and `ARCHITECTURE_STANDARDS.md` for the actual Python LLM logic.

## 2. Role of AI-Service

Per `ARCHITECTURE_STANDARDS.md`, `ai-service` is a **TypeScript/Fastify** component that sits in front of the Python `ai-agents` service. It handles:
1. Validating web requests and tokens from the API Gateway.
2. Managing the project context payload limits.
3. Managing HTTP/SSE streams from the Python LangGraph backend and streaming them immediately back to the client.
4. Implementing the `opossum` Circuit Breaker around the Python backend to protect the system.
5. Emitting Kafka billing events (`ai.task.completed`).

## 3. Implementation Status
- **Architecture Standardized:** ✅ Complete
- **Codebase Migration Context Isolated:** ✅ Complete
