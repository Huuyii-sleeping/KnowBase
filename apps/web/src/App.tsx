import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { DocumentsPage } from '@/pages/documents-page';
import { DocumentDetailPage } from '@/pages/document-detail-page';
import { ReviewQueuePage } from '@/pages/review-queue-page';
import { LoginPage } from '@/pages/login-page';
import { RequireAuth, RequireRole } from '@/components/require-auth';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { path: '/', element: <Navigate to="/documents" replace /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:id', element: <DocumentDetailPage /> },
      { path: '/review', element: <RequireRole role="ADMIN"><ReviewQueuePage /></RequireRole> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
