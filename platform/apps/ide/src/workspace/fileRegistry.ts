export interface WorkspaceFileEntry {
  path: string;
}

// Dynamic file registry - updated when AI generates files
export const workspaceFileRegistry: WorkspaceFileEntry[] = [
  { path: 'src/index.ts' },
  { path: 'src/app.tsx' },
  { path: 'README.md' }
];

// Function to add files dynamically
export function addFilesToRegistry(paths: string[]): void {
  const existingPaths = new Set(workspaceFileRegistry.map(f => f.path));
  
  for (const path of paths) {
    if (!existingPaths.has(path)) {
      workspaceFileRegistry.push({ path });
      existingPaths.add(path);
    }
  }
}

// Function to get all registered files
export function getRegisteredFiles(): string[] {
  return workspaceFileRegistry.map(f => f.path);
}
