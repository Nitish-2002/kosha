import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { MembersPage } from './pages/MembersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { RequestsPage } from './pages/RequestsPage';
import { ComparePage } from './pages/ComparePage';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pending-approval" element={<PendingPage />} />
          {/* Landing page for both roles (login redirects to "/"). */}
          <Route path="/" element={<Navigate to="/projects" replace />} />
          {/* Open to both roles — ProjectsService/ProjectDetailPage's own API
              calls scope a Member to their ProjectAssignments; there's no
              admin-only gate to apply here anymore. */}
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <Layout>
                  <ProjectsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <ProtectedRoute>
                <Layout>
                  <ProjectDetailPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId/environments/:environmentId"
            element={
              <ProtectedRoute>
                <Layout>
                  <ProjectDetailPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/credentials"
            element={
              <ProtectedRoute adminOnly>
                <Layout>
                  <CredentialsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          {/* Merged into the "Access" tab of /requests — kept as a redirect
              so an old bookmark/link still lands somewhere useful. */}
          <Route path="/access-requests" element={<Navigate to="/requests" replace />} />
          <Route
            path="/members"
            element={
              <ProtectedRoute adminOnly>
                <Layout>
                  <MembersPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute adminOnly>
                <Layout>
                  <AuditLogPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/requests"
            element={
              <ProtectedRoute adminOnly>
                <Layout>
                  <RequestsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          {/* Reached from the project page's "Compare environments" link —
              comparison only ever makes sense within one project, so there's
              no standalone cross-project picker. Open to both roles;
              DiffService scopes each side to the requester's
              ProjectAssignments and masks Secrets, same as the variable table. */}
          <Route
            path="/projects/:projectId/compare"
            element={
              <ProtectedRoute>
                <Layout>
                  <ComparePage />
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
