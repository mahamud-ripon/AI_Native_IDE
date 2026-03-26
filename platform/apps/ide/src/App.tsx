import { Navigate, Route, Routes } from 'react-router-dom';
import { IdeShellRoute } from './routes/IdeShellRoute';
import { NewProjectRoute } from './routes/NewProjectRoute';
import { AuthPage } from './routes/AuthPage';
import { HomePage } from './routes/HomePage';

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
      {/* Homepage — bolt.new style landing with prompt bar */}
      <Route path="/" element={<HomePage />} />
      
      {/* Auth page — unified login/signup with NEXUS design */}
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<Navigate to="/login?tab=signup" replace />} />
      
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
