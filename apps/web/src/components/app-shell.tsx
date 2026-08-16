import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ToastHost } from '@/components/toast';
import { authApi, authStorage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(authStorage.getUser);
  useEffect(() => authStorage.subscribe(() => setUser(authStorage.getUser())), []);
  const navItems = [
    { to: '/documents', label: '文档库' },
    ...(user?.role === 'ADMIN' ? [{ to: '/review', label: '审核队列' }] : []),
  ];
  const crumb =
    location.pathname.startsWith('/review')
      ? '审核队列'
      : location.pathname.startsWith('/documents/')
        ? '文档详情'
        : '文档库';

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[216px] shrink-0 flex-col border-r border-border bg-background px-3 py-4">
        <div className="flex items-baseline gap-2 px-2.5 pb-4">
          <strong className="text-[15px] font-semibold tracking-tight">Knowbase</strong>
          <span className="text-[12px] text-muted-foreground/70">企业知识库</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] text-muted-foreground transition-colors hover:bg-accent',
                  isActive && 'bg-accent font-medium text-foreground',
                )
              }
            >
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-5 px-2.5 pb-1.5 text-[11px] text-muted-foreground/70">管理</div>
        <div className="flex flex-col gap-0.5 opacity-60">
          <span className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            分类与标签
          </span>
          <span className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            检索与问答（预留）
          </span>
        </div>
        <div className="mt-auto border-t border-border pt-3">
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {(user?.displayName || user?.username || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] text-muted-foreground">{user?.displayName}</div>
              <div className="text-[11px] text-muted-foreground/70">{user?.role === 'ADMIN' ? '管理员' : '成员'}</div>
            </div>
            <Button className="ml-auto shrink-0" variant="ghost" size="sm" onClick={() => { authApi.logout(); navigate('/login', { replace: true }); }}>
              退出
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center gap-4 border-b border-border bg-background px-7">
          <span className="text-[13px] text-muted-foreground/70">
            Knowbase / <b className="font-medium text-foreground">{crumb}</b>
          </span>
          <div className="ml-auto flex w-[220px] items-center rounded-md border border-border bg-secondary px-3 py-[5px] text-[13px] text-muted-foreground/70">
            全局搜索（预留）
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-10 pb-16 pt-8">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
