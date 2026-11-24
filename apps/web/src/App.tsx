import { IndexUpgradesPage } from '@/pages/index-upgrades-page';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { DocumentsPage } from '@/pages/documents-page';
import { DocumentDetailPage } from '@/pages/document-detail-page';
import { ReviewQueuePage } from '@/pages/review-queue-page';
import { LoginPage } from '@/pages/login-page';
import { AskPage } from '@/pages/ask-page';
import { SearchPage } from '@/pages/search-page';
import { GraphPage } from '@/pages/graph-page';
import { RequireAuth, RequireRole } from '@/components/require-auth';
import { AppErrorPage } from '@/pages/app-error-page';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <AppErrorPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <AppErrorPage />,
    children: [
      { path: '/', element: <Navigate to="/documents" replace /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:id', element: <DocumentDetailPage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/graph', element: <GraphPage /> },
      {
        path: '/index-upgrades',
        element: (
          <RequireRole role="ADMIN">
            <IndexUpgradesPage />
          </RequireRole>
        ),
      },
      {
        path: '/review',
        element: (
          <RequireRole role="ADMIN">
            <ReviewQueuePage />
          </RequireRole>
        ),
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
