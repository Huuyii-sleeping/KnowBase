import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { DocumentsPage } from '@/pages/documents-page';
import { DocumentDetailPage } from '@/pages/document-detail-page';
import { ReviewQueuePage } from '@/pages/review-queue-page';

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Navigate to="/documents" replace /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:id', element: <DocumentDetailPage /> },
      { path: '/review', element: <ReviewQueuePage /> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
