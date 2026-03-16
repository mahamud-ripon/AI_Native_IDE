import { Navigate, Route, Routes } from 'react-router-dom';

import { IdeShellRoute } from './routes/IdeShellRoute';

export function App() {
  return (
    <Routes>
      {/* Default route - clean URL */}
      <Route
        path="/"
        element={<Navigate to="/new" replace />}
      />
      
      {/* Project routes */}
      <Route path="/new" element={<IdeShellRoute projectId="demo" filePath="src/index.ts" />} />
      <Route path="/p/:projectId/f/*" element={<IdeShellRoute />} />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
