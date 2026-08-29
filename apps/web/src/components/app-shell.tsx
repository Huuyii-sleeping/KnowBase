import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { ToastHost } from '@/components/toast';
import { authApi, authStorage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(authStorage.getUser);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => authStorage.subscribe(() => setUser(authStorage.getUser())), []);
  const navItems = [
    { to: '/documents', label: '文档库' },
    { to: '/ask', label: 'AI 问答' },
    { to: '/search', label: '检索工作台' },
    { to: '/graph', label: '知识图谱' },
    ...(user?.role === 'ADMIN' ? [{ to: '/review', label: '审核队列' }] : []),
  ];
  const crumb =
    location.pathname.startsWith('/review')
      ? '审核队列'
      : location.pathname.startsWith('/documents/')
        ? '文档详情'
        : location.pathname.startsWith('/ask')
          ? 'AI 问答'
          : location.pathname.startsWith('/search')
            ? '检索工作台'
            : location.pathname.startsWith('/graph')
              ? '知识图谱'
        : '文档库';

  const [searchInput, setSearchInput] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  useEffect(() => {
    setSearchInput(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.search]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  return (
    <div className="flex min-h-screen">
      {mobileNavOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-screen w-[216px] shrink-0 flex-col border-r border-border bg-background px-3 py-4 transition-transform md:sticky md:top-0 md:z-auto md:flex md:translate-x-0',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex items-center gap-2 px-2.5 pb-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <strong className="text-[15px] font-semibold tracking-tight">Knowbase</strong>
            <span className="text-[12px] text-muted-foreground/70">企业知识库</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0 md:hidden"
            aria-label="关闭导航"
            onClick={() => setMobileNavOpen(false)}
          >
            关闭
          </Button>
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
              onClick={() => setMobileNavOpen(false)}
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
        <header className="sticky top-0 z-20 flex h-[52px] items-center gap-2 border-b border-border bg-background px-4 md:gap-4 md:px-7">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 md:hidden"
            aria-label="打开导航"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            菜单
          </Button>
          <span className="min-w-0 truncate text-[13px] text-muted-foreground/70">
            Knowbase / <b className="font-medium text-foreground">{crumb}</b>
          </span>
          <form className="ml-auto w-[120px] max-w-[36vw] md:w-[240px] md:max-w-none" onSubmit={submitSearch}>
            <input
              aria-label="全局搜索"
              className="h-8 w-full rounded-md border border-border bg-secondary px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              placeholder="搜索知识库…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </form>
        </header>
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 pb-16 pt-6 md:px-10 md:pt-8">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
