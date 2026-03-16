"""Scaffold Project Tool - Create base project structure from templates."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx


class ScaffoldProjectTool:
    """Tool for scaffolding projects from JSON templates.
    
    Loads template definitions from JSON files and creates project structure.
    """

    def __init__(self) -> None:
        # Templates are in platform/ai-agents/templates/
        self.templates_dir = Path(__file__).parent.parent.parent / "templates"
        self._templates_cache: Dict[str, Dict[str, Any]] = {}

    def list_templates(self) -> List[Dict[str, str]]:
        """List available templates.
        
        Returns:
            List of template info (name, description, category)
        """
        templates = []
        
        if not self.templates_dir.exists():
            return templates
            
        for file in self.templates_dir.glob("*.json"):
            try:
                template = self._load_template(file.stem)
                templates.append({
                    "name": template.get("name", file.stem),
                    "description": template.get("description", ""),
                    "category": template.get("category", "unknown")
                })
            except Exception:
                continue
        
        return templates

    def get_template(self, name: str) -> Optional[Dict[str, Any]]:
        """Get template by name.
        
        Args:
            name: Template name
            
        Returns:
            Template definition or None
        """
        try:
            return self._load_template(name)
        except FileNotFoundError:
            return None

    def _load_template(self, name: str) -> Dict[str, Any]:
        """Load template from JSON file.
        
        Args:
            name: Template name
            
        Returns:
            Template definition
        """
        if name in self._templates_cache:
            return self._templates_cache[name]
        
        template_file = self.templates_dir / f"{name}.json"
        
        if not template_file.exists():
            raise FileNotFoundError(f"Template not found: {name}")
        
        with open(template_file, "r", encoding="utf-8") as f:
            template = json.load(f)
        
        self._templates_cache[name] = template
        return template

    async def scaffold(
        self,
        project_id: str,
        template_name: str,
        project_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Scaffold a project from template.
        
        Args:
            project_id: Project identifier
            template_name: Template name to use
            project_name: Optional project name override
            
        Returns:
            Dict with success status and created files
        """
        try:
            template = self._load_template(template_name)
        except FileNotFoundError as e:
            return {
                "success": False,
                "error": str(e),
                "tool": "scaffold_project"
            }

        files = template.get("files", {})
        
        if not files:
            return {
                "success": False,
                "error": "Template has no files",
                "tool": "scaffold_project"
            }

        # Build file content
        files_to_create: Dict[str, str] = {}
        
        for file_path, content in files.items():
            # Handle nested paths (e.g., frontend/package.json)
            files_to_create[file_path] = content

        # Call create_files via project-service
        api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        system_token = os.getenv("SYSTEM_TOKEN", "")
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{api_url}/api/v1/projects/{project_id}/files/sync",
                    json={"files": [{"path": k, "content": v} for k, v in files_to_create.items()]},
                    headers={"Authorization": f"Bearer {system_token}"},
                    timeout=60.0,
                )
                
                if response.status_code == 200:
                    created_files = list(files_to_create.keys())
                    dependencies = template.get("dependencies", [])
                    dev_command = template.get("devCommand", "")
                    dev_port = template.get("devPort", 3000)
                    
                    return {
                        "success": True,
                        "template": template_name,
                        "files_created": created_files,
                        "dependencies": dependencies,
                        "dev_command": dev_command,
                        "dev_port": dev_port,
                        "tool": "scaffold_project"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to create files: {response.status_code}",
                        "tool": "scaffold_project"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "scaffold_project"
                }

    def get_dependencies(self, template_name: str) -> List[str]:
        """Get dependencies for a template.
        
        Args:
            template_name: Template name
            
        Returns:
            List of dependencies
        """
        try:
            template = self._load_template(template_name)
            deps = template.get("dependencies", [])
            
            # Handle fullstack templates with nested dependencies
            if isinstance(deps, dict):
                all_deps = []
                for sub_deps in deps.values():
                    if isinstance(sub_deps, list):
                        all_deps.extend(sub_deps)
                return all_deps
            
            return deps if isinstance(deps, list) else []
        except FileNotFoundError:
            return []

    def get_dev_command(self, template_name: str) -> str:
        """Get dev command for a template.
        
        Args:
            template_name: Template name
            
        Returns:
            Dev command string
        """
        try:
            template = self._load_template(template_name)
            return template.get("devCommand", "")
        except FileNotFoundError:
            return ""

    def get_dev_port(self, template_name: str) -> int:
        """Get dev server port for a template.
        
        Args:
            template_name: Template name
            
        Returns:
            Port number
        """
        try:
            template = self._load_template(template_name)
            return template.get("devPort", 3000)
        except FileNotFoundError:
            return 3000


# Singleton instance
scaffold_project_tool = ScaffoldProjectTool()
