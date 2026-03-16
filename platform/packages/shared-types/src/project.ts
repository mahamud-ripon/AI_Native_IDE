export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: 'private' | 'public' | 'org';
  framework?: string;
  language?: string;
  template?: string;
  ownerId: string;
  orgId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  branchId: string;
  parentId?: string;
  path: string;
  name: string;
  isDirectory: boolean;
  language?: string;
  sizeBytes?: number;
  contentHash?: string;
}

export interface ProjectBranch {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  headCommitSha?: string;
  createdAt: string;
}

export interface ProjectCollaborator {
  projectId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  visibility?: 'private' | 'public' | 'org';
  template?: string;
  framework?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  visibility?: 'private' | 'public' | 'org';
}
