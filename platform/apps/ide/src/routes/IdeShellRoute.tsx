import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { IdeShell } from '../components/layout/IdeShell';

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
    if (splat) {
      try {
        return decodeURIComponent(splat);
      } catch {
        return splat;
      }
    }
    return undefined;
  }, [propFilePath, splat]);

  return <IdeShell projectId={projectId} filePath={filePath} />;
}
