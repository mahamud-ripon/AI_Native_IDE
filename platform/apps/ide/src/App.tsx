import { Navigate, Route, Routes } from 'react-router-dom';
import { IdeShellRoute } from './routes/IdeShellRoute';
import { NewProjectRoute } from './routes/NewProjectRoute';
import { LoginRoute } from './routes/LoginRoute';
import { RegisterRoute } from './routes/RegisterRoute';

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      {/* Root redirects to new project page */}
      <Route path="/" element={<Navigate to="/new" replace />} />
      
      {/* Auth pages */}
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/register" element={<RegisterRoute />} />
      
      {/* New project creation - protected */}
      <Route 
        path="/new" 
        element={
          <ProtectedRoute>
            <NewProjectRoute />
          </ProtectedRoute>
        } 
      />
      
      {/* Active project IDE — file path is in the splat - protected */}
      <Route 
        path="/p/:projectId/f/*" 
        element={
          <ProtectedRoute>
            <IdeShellRoute />
          </ProtectedRoute>
        } 
      />
      
      {/* Project root without file — default to main entry - protected */}
      <Route 
        path="/p/:projectId" 
        element={
          <ProtectedRoute>
            <IdeShellRoute />
          </ProtectedRoute>
        } 
      />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/new" replace />} />
    </Routes>
  );
}
