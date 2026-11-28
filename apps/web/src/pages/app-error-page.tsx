import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { RequestFailure } from '@/components/request-failure';
import { Button } from '@/components/ui/button';
import {
  ApiError,
  createApiError,
  httpError,
  requestFailure,
} from '@/lib/api-error';

export function AppErrorPage() {
  const error = useRouteError();
  const failure = requestFailure(
    isRouteErrorResponse(error)
      ? httpError(error.status, null)
      : error instanceof ApiError
        ? error
        : createApiError('PAGE_LOAD_FAILED'),
  );
  const reload = () => window.location.reload();

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-6">
      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">页面加载失败</h1>
        <RequestFailure
          title="暂时无法打开此页面"
          failure={failure}
          onRetry={reload}
          onRefresh={reload}
        />
        <Button asChild variant="outline">
          <Link to="/documents">返回文档库</Link>
        </Button>
      </div>
    </div>
  );
}
