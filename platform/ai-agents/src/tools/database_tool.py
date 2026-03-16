"""Database Tool - Manage PostgreSQL databases for projects."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx


class DatabaseTool:
    """Tool for managing PostgreSQL databases.
    
    Creates databases, runs migrations, and resets data.
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")

    async def create_database(
        self,
        project_id: str,
        database_name: Optional[str] = None,
        user: str = "user",
        password: str = "pass"
    ) -> Dict[str, Any]:
        """Create a PostgreSQL database for a project.
        
        Args:
            project_id: Project identifier
            database_name: Optional database name (defaults to project_id)
            user: Database user
            password: Database password
            
        Returns:
            Dict with success status and connection info
        """
        db_name = database_name or project_id.replace("-", "_")
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/database",
                    json={
                        "action": "create",
                        "database_name": db_name,
                        "user": user,
                        "password": password
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "database_name": db_name,
                        "connection_string": f"postgresql://{user}:{password}@localhost:5432/{db_name}",
                        "host": "localhost",
                        "port": 5432,
                        "tool": "database"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to create database: {response.status_code}",
                        "tool": "database"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "database"
                }

    async def run_migrations(
        self,
        project_id: str,
        migration_path: str = "./migrations",
        database_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """Run database migrations.
        
        Args:
            project_id: Project identifier
            migration_path: Path to migration files
            database_url: Optional database URL override
            
        Returns:
            Dict with success status and migration results
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/database",
                    json={
                        "action": "migrate",
                        "migration_path": migration_path,
                        "database_url": database_url
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=120.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "migrations_run": data.get("data", {}).get("migrations_run", []),
                        "tool": "database"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Migration failed: {response.status_code}",
                        "tool": "database"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "database"
                }

    async def reset_database(
        self,
        project_id: str,
        database_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reset a database (drop and recreate).
        
        Args:
            project_id: Project identifier
            database_name: Optional database name
            
        Returns:
            Dict with success status
        """
        db_name = database_name or project_id.replace("-", "_")
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/database",
                    json={
                        "action": "reset",
                        "database_name": db_name
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    return {
                        "success": True,
                        "database_name": db_name,
                        "message": "Database reset successfully",
                        "tool": "database"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to reset database: {response.status_code}",
                        "tool": "database"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "database"
                }

    async def get_connection_info(
        self,
        project_id: str
    ) -> Dict[str, Any]:
        """Get database connection info for a project.
        
        Args:
            project_id: Project identifier
            
        Returns:
            Dict with connection information
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.api_url}/api/v1/projects/{project_id}/database",
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "database_name": data.get("data", {}).get("database_name"),
                        "host": data.get("data", {}).get("host", "localhost"),
                        "port": data.get("data", {}).get("port", 5432),
                        "user": data.get("data", {}).get("user"),
                        "tool": "database"
                    }
                elif response.status_code == 404:
                    return {
                        "success": False,
                        "error": "No database configured for this project",
                        "tool": "database"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to get connection info: {response.status_code}",
                        "tool": "database"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "database"
                }


# Singleton instance
database_tool = DatabaseTool()
