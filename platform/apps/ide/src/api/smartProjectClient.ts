/**
 * Smart Project Client - Creates projects in browser (IndexedDB) or cloud
 */

import { browserWorkspaceService } from '../workspace/browserWorkspaceService';
import { projectClient } from './projectClient';
import type { Project } from './projectClient';

export interface CreateProjectOptions {
  name: string;
  template?: string;
  visibility?: 'private' | 'public';
  description?: string;
  type: 'browser' | 'cloud';
}

export interface SmartProject extends Project {
  type: 'browser' | 'cloud';
}

export const smartProjectClient = {
  async createProject(options: CreateProjectOptions): Promise<SmartProject> {
    if (options.type === 'browser') {
      // Create browser project in IndexedDB
      const project = await browserWorkspaceService.createProject(options.name);
      return {
        id: project.id,
        name: project.name,
        slug: project.name.toLowerCase().replace(/\s+/g, '-'),
        status: 'active',
        template: options.template || null,
        language: 'typescript',
        framework: options.template || null,
        type: 'browser',
      };
    }

    // Create cloud project via API
    const cloudProject = await projectClient.createProject({
      name: options.name,
      template: options.template,
      visibility: options.visibility || 'private',
      description: options.description,
    });

    return {
      ...cloudProject,
      type: 'cloud',
    };
  },

  async listProjects(): Promise<SmartProject[]> {
    // Get browser projects from IndexedDB
    const browserProjects = await browserWorkspaceService.getAllProjects();
    
    // projectClient doesn't have listProjects, so we just return browser projects for now
    const cloudProjects: Project[] = [];

    return [
      ...browserProjects.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.name.toLowerCase().replace(/\s+/g, '-'),
        status: 'active',
        template: null,
        language: 'typescript',
        framework: null,
        type: 'browser' as const,
      })),
      ...cloudProjects.map((p: Project) => ({ ...p, type: 'cloud' as const })),
    ];
  },

  async exportToCloud(projectId: string): Promise<{ success: boolean; error?: string }> {
    const project = await browserWorkspaceService.getProject(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    // Create cloud project
    try {
      const cloudProject = await projectClient.createProject({
        name: project.name,
        visibility: 'private',
      });

      // Export files to cloud
      await browserWorkspaceService.exportToCloud(projectId, cloudProject.id);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  },
};

export default smartProjectClient;
