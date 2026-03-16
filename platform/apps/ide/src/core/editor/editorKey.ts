export function normalizeFilePath(filePath: string): string {
  return filePath.startsWith('/') ? filePath : `/${filePath}`;
}

export function editorKey(projectId: string, filePath: string): string {
  return `${projectId}:${normalizeFilePath(filePath)}`;
}
