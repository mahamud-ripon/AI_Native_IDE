"""Project Planner Agent - Analyzes prompts and decides architecture."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ProjectPlan(BaseModel):
    """Output from ProjectPlannerAgent."""
    frontend_template: Optional[str] = None
    backend_template: Optional[str] = None
    database: Optional[str] = None
    dependencies: List[str] = []
    services: List[Dict[str, Any]] = []
    plan_summary: str


class ProjectPlannerAgent:
    """Agent for analyzing user prompts and creating project plans.
    
    Analyzes natural language to determine:
    - Frontend framework
    - Backend framework  
    - Database requirements
    - Architecture decisions
    """

    # Template mappings
    FRONTEND_PATTERNS = {
        "react": ["react", "reactjs", "react.js"],
        "react-vite": ["react vite", "vite react", "vite + react"],
        "nextjs": ["nextjs", "next.js", "next js"],
        "vue": ["vue", "vuejs", "vue.js"],
        "angular": ["angular"],
    }
    
    BACKEND_PATTERNS = {
        "fastapi": ["fastapi", "fast api"],
        "flask": ["flask"],
        "django": ["django"],
        "node-express": ["express", "node", "nodejs", "node.js"],
        "express": ["express"],
    }
    
    DATABASE_PATTERNS = {
        "postgresql": ["postgresql", "postgres", "pg"],
        "mongodb": ["mongodb", "mongo"],
        "mysql": ["mysql"],
        "redis": ["redis"],
    }

    def __init__(self) -> None:
        self.available_templates = self._load_available_templates()

    def _load_available_templates(self) -> Dict[str, Any]:
        """Load available templates."""
        return {
            "frontend": ["react-vite", "nextjs"],
            "backend": ["fastapi", "node-express"],
            "fullstack": ["fullstack-react-fastapi"]
        }

    async def plan(self, user_prompt: str) -> ProjectPlan:
        """Analyze user prompt and create project plan.
        
        Args:
            user_prompt: User's natural language request
            
        Returns:
            ProjectPlan with architecture decisions
        """
        prompt_lower = user_prompt.lower()
        
        # Detect frontend
        frontend = self._detect_frontend(prompt_lower)
        
        # Detect backend
        backend = self._detect_backend(prompt_lower)
        
        # Detect database
        database = self._detect_database(prompt_lower)
        
        # Check for fullstack intent
        is_fullstack = frontend and backend
        
        # Build plan
        if is_fullstack:
            plan = self._build_fullstack_plan(frontend, backend, database)
        elif frontend:
            plan = self._build_frontend_plan(frontend)
        elif backend:
            plan = self._build_backend_plan(backend, database)
        else:
            # Default to React + FastAPI
            plan = self._build_fullstack_plan("react-vite", "fastapi", "postgresql")
        
        return plan

    def _detect_frontend(self, prompt: str) -> Optional[str]:
        """Detect frontend framework from prompt."""
        for template, patterns in self.FRONTEND_PATTERNS.items():
            for pattern in patterns:
                if pattern in prompt:
                    if template == "react":
                        return "react-vite"  # Default to react-vite
                    return template
        return None

    def _detect_backend(self, prompt: str) -> Optional[str]:
        """Detect backend framework from prompt."""
        for template, patterns in self.BACKEND_PATTERNS.items():
            for pattern in patterns:
                if pattern in prompt:
                    if template == "express":
                        return "node-express"
                    return template
        return None

    def _detect_database(self, prompt: str) -> Optional[str]:
        """Detect database from prompt."""
        for db, patterns in self.DATABASE_PATTERNS.items():
            for pattern in patterns:
                if pattern in prompt:
                    return db
        return None

    def _build_fullstack_plan(
        self,
        frontend: str,
        backend: str,
        database: Optional[str]
    ) -> ProjectPlan:
        """Build a fullstack project plan."""
        dependencies = []
        services = []
        
        # Frontend service
        if frontend == "react-vite":
            dependencies.extend(["react", "react-dom", "vite", "@vitejs/plugin-react"])
            services.append({
                "name": "frontend",
                "command": "npm run dev",
                "port": 5173,
                "url": "http://localhost:5173"
            })
        elif frontend == "nextjs":
            dependencies.extend(["react", "react-dom", "next"])
            services.append({
                "name": "frontend",
                "command": "npm run dev",
                "port": 3000,
                "url": "http://localhost:3000"
            })
        
        # Backend service
        if backend == "fastapi":
            dependencies.extend(["fastapi", "uvicorn", "pydantic", "sqlalchemy"])
            services.append({
                "name": "backend",
                "command": "uvicorn main:app --reload --port 8000",
                "port": 8000,
                "url": "http://localhost:8000"
            })
        elif backend == "node-express":
            dependencies.extend(["express", "cors", "dotenv"])
            services.append({
                "name": "backend",
                "command": "npm run dev",
                "port": 3001,
                "url": "http://localhost:3001"
            })
        
        # Database
        db_service = None
        if database == "postgresql":
            db_service = {"name": "postgres", "port": 5432}
            services.append(db_service)
        
        plan_summary = f"Fullstack app: {frontend} frontend + {backend} backend"
        if database:
            plan_summary += f" + {database} database"
        
        return ProjectPlan(
            frontend_template=frontend,
            backend_template=backend,
            database=database,
            dependencies=dependencies,
            services=services,
            plan_summary=plan_summary
        )

    def _build_frontend_plan(self, frontend: str) -> ProjectPlan:
        """Build a frontend-only project plan."""
        dependencies = []
        services = []
        
        if frontend == "react-vite":
            dependencies.extend(["react", "react-dom", "vite", "@vitejs/plugin-react"])
            services.append({
                "name": "frontend",
                "command": "npm run dev",
                "port": 5173,
                "url": "http://localhost:5173"
            })
        elif frontend == "nextjs":
            dependencies.extend(["react", "react-dom", "next"])
            services.append({
                "name": "frontend",
                "command": "npm run dev",
                "port": 3000,
                "url": "http://localhost:3000"
            })
        
        return ProjectPlan(
            frontend_template=frontend,
            dependencies=dependencies,
            services=services,
            plan_summary=f"{frontend} frontend application"
        )

    def _build_backend_plan(
        self,
        backend: str,
        database: Optional[str]
    ) -> ProjectPlan:
        """Build a backend-only project plan."""
        dependencies = []
        services = []
        
        if backend == "fastapi":
            dependencies.extend(["fastapi", "uvicorn", "pydantic", "sqlalchemy"])
            services.append({
                "name": "backend",
                "command": "uvicorn main:app --reload --port 8000",
                "port": 8000,
                "url": "http://localhost:8000"
            })
        elif backend == "node-express":
            dependencies.extend(["express", "cors", "dotenv"])
            services.append({
                "name": "backend",
                "command": "npm run dev",
                "port": 3001,
                "url": "http://localhost:3001"
            })
        
        if database == "postgresql":
            services.append({"name": "postgres", "port": 5432})
        
        plan_summary = f"{backend} backend API"
        if database:
            plan_summary += f" with {database}"
        
        return ProjectPlan(
            backend_template=backend,
            database=database,
            dependencies=dependencies,
            services=services,
            plan_summary=plan_summary
        )


# Singleton instance
project_planner_agent = ProjectPlannerAgent()
