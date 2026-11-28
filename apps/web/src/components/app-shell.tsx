import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ToastHost } from '@/components/toast';
import { authApi, authStorage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

const NAV_ITEMS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/documents', label: '文档库', icon: 'files' },
  { to: '/ask', label: 'AI 问答', icon: 'spark' },
  { to: '/search', label: '检索工作台', icon: 'search' },
  { to: '/graph', label: '知识图谱', icon: 'graph' },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(authStorage.getUser);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(
    () => authStorage.subscribe(() => setUser(authStorage.getUser())),
    [],
  );

  const crumb = location.pathname.startsWith('/documents/')
    ? '文档详情'
    : location.pathname.startsWith('/index-upgrades')
      ? '存量索引升级'
      : location.pathname.startsWith('/review')
        ? '审核队列'
        : (NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
            ?.label ?? '文档库');
  const [searchInput, setSearchInput] = useState(
    () => new URLSearchParams(location.search).get('q') ?? '',
  );

  useEffect(() => {
    setSearchInput(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.search]);
  useEffect(
    () => setMobileNavOpen(false),
    [location.pathname, location.search],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('a, button') ?? [],
      ).filter((element) => element.getClientRects().length);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      menuRef.current?.focus();
    };
  }, [mobileNavOpen]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary p-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        跳到主要内容
      </a>
      {mobileNavOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        role={mobileNavOpen ? 'dialog' : undefined}
        aria-modal={mobileNavOpen || undefined}
        aria-label="工作区导航"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-dvh w-[232px] shrink-0 flex-col border-r border-border bg-[#f5f8fa] px-4 py-6 transition-transform md:sticky md:top-0 md:z-auto md:translate-x-0',
          mobileNavOpen
            ? 'translate-x-0'
            : '-translate-x-full invisible md:visible',
        )}
      >
        <div className="flex items-center gap-2.5 px-2">
          <div className="brand-mark">
            <Icon name="book" width={22} height={22} />
          </div>
          <div>
            <div className="text-[18px] font-semibold tracking-[-0.7px]">
              knowbase<span className="text-primary">.</span>
            </div>
            <div className="text-[10px] tracking-wider text-muted-foreground">
              团队的知识，共同的积累
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto px-1 md:hidden"
            aria-label="关闭导航"
            onClick={() => setMobileNavOpen(false)}
          >
            <Icon name="close" />
          </Button>
        </div>
        <div className="mb-7 mt-7 flex items-center gap-2.5 rounded-lg border border-border bg-white/70 p-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary text-xs font-semibold">
            K
          </div>
          <div>
            <div className="text-[12px] font-semibold">企业知识空间</div>
            <div className="text-[10px] text-muted-foreground">
              {user?.team || '团队工作区'}
            </div>
          </div>
        </div>
        <p className="mb-2 px-3 text-[10px] font-medium tracking-wider text-muted-foreground">
          知识工作台
        </p>
        <nav aria-label="主要导航" className="space-y-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn('nav-link', isActive && 'nav-link-active')
              }
            >
              <Icon name={item.icon} width={18} height={18} />
              {item.label}
              {item.to === '/ask' && (
                <span className="ml-auto rounded bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">
                  AI
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        {user?.role === 'ADMIN' && (
          <>
            <p className="mb-2 mt-8 px-3 text-[10px] font-medium tracking-wider text-muted-foreground">
              内容管理
            </p>
            <NavLink
              to="/review"
              className={({ isActive }) =>
                cn('nav-link', isActive && 'nav-link-active')
              }
            >
              <Icon name="check" width={18} height={18} />
              审核队列
            </NavLink>
            <NavLink
              to="/index-upgrades"
              className={({ isActive }) =>
                cn('nav-link', isActive && 'nav-link-active')
              }
            >
              <Icon name="files" width={18} height={18} />
              存量索引升级
            </NavLink>
          </>
        )}
        <div className="mt-auto pt-8">
          <NavLink
            to="/ask"
            className="mb-5 block rounded-xl border border-primary/10 bg-[#eaf3f4] p-3.5 text-primary transition-colors hover:bg-[#dfedef]"
          >
            <Icon name="spark" width={18} height={18} />
            <div className="mb-1 mt-2 text-[12px] font-semibold">
              让知识，给出答案
            </div>
            <div className="text-[11px] leading-5 text-muted-foreground">
              向知识库提问，找到有据可循的答案。
              <span className="ml-1 text-primary">↗</span>
            </div>
          </NavLink>
          <div className="flex items-center gap-2.5 border-t border-border px-1 pt-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-[#dceff0] text-xs font-semibold text-primary">
              {(user?.displayName || user?.username || '?')
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium">
                {user?.displayName || user?.username}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {user?.role === 'ADMIN' ? '管理员' : '成员'}
              </div>
            </div>
            <Button
              className="ml-auto px-2"
              variant="ghost"
              size="sm"
              aria-label="退出登录"
              onClick={() => {
                authApi.logout();
                navigate('/login', { replace: true });
              }}
            >
              <Icon name="logout" width={16} height={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-white/95 px-4 backdrop-blur-md md:px-8">
          <Button
            ref={menuRef}
            type="button"
            variant="ghost"
            size="sm"
            className="px-1 md:hidden"
            aria-label="打开导航"
            aria-controls="workspace-navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Icon name="menu" />
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="hidden text-muted-foreground sm:inline">
              工作空间
            </span>
            <Icon
              name="chevron"
              width={12}
              height={12}
              className="hidden text-muted-foreground/50 sm:block"
            />
            <span className="truncate font-medium">{crumb}</span>
          </div>
          <form
            role="search"
            className="ml-auto flex h-9 w-[156px] items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:w-[260px]"
            onSubmit={submitSearch}
          >
            <Icon
              name="search"
              width={15}
              height={15}
              className="shrink-0 text-muted-foreground"
            />
            <input
              ref={searchRef}
              aria-label="全局搜索"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/80 focus-visible:outline-none"
              placeholder="搜索知识库…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <kbd className="hidden rounded border border-border bg-white px-1 text-[10px] text-muted-foreground sm:block">
              ⌘ K
            </kbd>
          </form>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-12 pt-7 sm:px-6 md:px-8 md:pt-9 xl:px-10"
        >
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
        <footer className="flex justify-between gap-4 px-4 pb-5 text-[10px] text-muted-foreground/75 md:px-8 xl:px-10">
          <span>Knowbase · 企业知识空间</span>
          <span>积累知识，连接想法。</span>
        </footer>
      </div>
      <ToastHost />
    </div>
  );
}
