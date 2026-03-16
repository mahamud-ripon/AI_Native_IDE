import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { IdeShell } from '../shell/IdeShell';

interface IdeShellRouteProps {
  projectId?: string;
  filePath?: string;
}

export function IdeShellRoute({ projectId: propProjectId, filePath: propFilePath }: IdeShellRouteProps = {}) {
  const { projectId: paramProjectId, '*': splat } = useParams();
  
  // Use props if provided, otherwise use URL params
  const projectId = propProjectId || paramProjectId || 'demo';
  const filePath = useMemo(() => {
    if (propFilePath) return propFilePath;
    if (splat) return decodeURIComponent(splat);
    return 'src/index.ts'; // Default file
  }, [propFilePath, splat]);

  return <IdeShell projectId={projectId} filePath={filePath} />;
}
