import { Button } from '@/components/ui/button';

export function RequestFailure({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-border bg-secondary/60 p-4 sm:p-5"
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        {message}
      </p>
      {onRetry && (
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
    </div>
  );
}
