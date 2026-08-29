import { createBrowserRouter, Link, Navigate, RouterProvider, useRouteError } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { DocumentsPage } from '@/pages/documents-page';
import { DocumentDetailPage } from '@/pages/document-detail-page';
import { ReviewQueuePage } from '@/pages/review-queue-page';
import { LoginPage } from '@/pages/login-page';
import { AskPage } from '@/pages/ask-page';
import { SearchPage } from '@/pages/search-page';
import { RequireAuth, RequireRole } from '@/components/require-auth';
import { Button } from '@/components/ui/button';

function AppErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '页面暂时无法加载，请重试。';

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-destructive">Page error</div>
        <h1 className="mt-2 text-lg font-semibold">页面加载失败</h1>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{message}</p>
        <div className="mt-5 flex gap-2">
          <Button type="button" onClick={() => window.location.reload()}>重新加载</Button>
          <Button asChild type="button" variant="outline"><Link to="/documents">返回文档库</Link></Button>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <AppErrorPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <AppErrorPage />,
    children: [
      { path: '/', element: <Navigate to="/documents" replace /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:id', element: <DocumentDetailPage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/review', element: <RequireRole role="ADMIN"><ReviewQueuePage /></RequireRole> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
