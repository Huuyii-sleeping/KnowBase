import { Button } from '@/components/ui/button';
import type { RequestFailureInfo } from '@/lib/api-error';

export function RequestFailure({
  title,
  failure,
  onRetry,
  onRefresh,
}: {
  title: string;
  failure: RequestFailureInfo;
  onRetry?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-border bg-secondary/60 p-4 sm:p-5"
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        {failure.message}
      </p>
      {failure.retryable && onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 bg-white"
          onClick={onRetry}
        >
          重新尝试
        </Button>
      )}
      {failure.action === 'refresh' && onRefresh && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 bg-white"
          onClick={onRefresh}
        >
          刷新状态
        </Button>
      )}
      {failure.action === 'login' && (
        <Button asChild variant="outline" size="sm" className="mt-3 bg-white">
          <a href="/login">重新登录</a>
        </Button>
      )}
    </div>
  );
}
