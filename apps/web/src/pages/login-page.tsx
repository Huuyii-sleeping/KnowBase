import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('knowbase-admin');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/documents', { replace: true });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-5">
      <section className="w-full max-w-[390px] rounded-xl border border-border bg-background p-8 shadow-sm">
        <div className="mb-7">
          <div className="text-[15px] font-semibold tracking-tight">Knowbase</div>
          <h1 className="mt-6 text-[24px] font-semibold tracking-tight">登录企业知识库</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">使用企业账号访问文档与检索能力</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <Button className="w-full" size="lg" disabled={submitting} type="submit">
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>
      </section>
    </main>
  );
}
