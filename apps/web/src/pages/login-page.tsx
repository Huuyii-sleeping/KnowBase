import { requestFailure, type RequestFailureInfo } from '@/lib/api-error';
import { RequestFailure } from '@/components/request-failure';
import { Icon } from '@/components/ui/icon';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('knowbase-admin');
  const [error, setError] = useState<RequestFailureInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/documents', { replace: true });
    } catch (reason) {
      setError(requestFailure(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#edf5f6] p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <Icon name="book" />
          </div>
          <span className="text-[22px] font-semibold tracking-tight">
            knowbase<span className="text-primary">.</span>
          </span>
        </div>
        <div className="relative z-10 max-w-lg py-16">
          <p className="eyebrow">A shared place for knowledge</p>
          <h2 className="mt-5 text-[42px] font-semibold leading-[1.4] tracking-tight xl:text-[48px]">
            让知识相连，
            <br />
            让想法发生。
          </h2>
          <p className="mt-6 max-w-sm text-[14px] leading-8 text-muted-foreground">
            从一份文档，到一个答案。
            <br />
            把团队积累的经验，变成随时可用的知识。
          </p>
          <div
            className="mt-12 flex max-w-sm items-center justify-between rounded-2xl border border-primary/15 bg-white/65 p-6 text-primary"
            aria-hidden="true"
          >
            <Icon name="files" width={30} height={30} />
            <span className="h-px flex-1 bg-primary/20 mx-4" />
            <Icon name="graph" width={30} height={30} />
            <span className="h-px flex-1 bg-primary/20 mx-4" />
            <Icon name="spark" width={30} height={30} />
          </div>
          <div className="mt-4 flex max-w-sm justify-between px-6 text-[11px] text-muted-foreground">
            <span>沉淀文档</span>
            <span>连接知识</span>
            <span>找到答案</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Knowbase · 团队的知识，共同的积累
        </p>
      </aside>
      <section className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-[360px]">
          <div className="mb-12 flex items-center gap-2.5 lg:hidden">
            <div className="brand-mark">
              <Icon name="book" />
            </div>
            <span className="text-xl font-semibold tracking-tight">
              knowbase.
            </span>
          </div>
          <div className="mb-8">
            <p className="eyebrow">Welcome back</p>
            <h1 className="mt-3 text-[28px] font-semibold tracking-tight">
              欢迎回到知识空间
            </h1>
            <p className="mt-3 text-[13px] text-muted-foreground">
              登录企业账号，继续探索团队的知识。
            </p>
          </div>
          <form
            ref={formRef}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error && (
              <RequestFailure
                title="暂时无法登录"
                failure={error}
                onRetry={() => formRef.current?.requestSubmit()}
              />
            )}
            <Button
              className="w-full"
              size="lg"
              disabled={submitting}
              type="submit"
            >
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
          <p className="mt-8 border-t border-border pt-5 text-center text-[11px] text-muted-foreground">
            企业内部知识空间 · 仅授权成员可访问
          </p>
        </div>
      </section>
    </main>
  );
}
