// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppErrorPage } from './app-error-page';
import { httpError } from '@/lib/api-error';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(error: unknown) {
  const router = createMemoryRouter([
    {
      path: '/',
      hydrateFallbackElement: <p>Loading route</p>,
      element: <p>Page content</p>,
      loader: () => {
        throw error;
      },
      errorElement: <AppErrorPage />,
    },
    { path: '/documents', element: <p>Document home</p> },
  ]);
  render(<RouterProvider router={router} />);
}

describe('route error boundary', () => {
  it('hides render exception details and reloads only when asked', async () => {
    const reload = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {});
    open(new Error('private stack and server details'));
    expect((await screen.findByRole('alert')).textContent).not.toContain(
      'private',
    );
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('maps route HTTP errors without exposing their raw data or status text', async () => {
    open({
      status: 404,
      statusText: 'private status text',
      data: 'private internal data',
      internal: true,
    });
    expect((await screen.findByRole('alert')).textContent).toContain('不存在');
    expect(document.body.textContent).not.toContain('private');
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: '返回文档库' }));
    await screen.findByText('Document home');
  });

  it('preserves the login recovery action of a normalized API error', async () => {
    open(httpError(401, null));
    expect(
      (await screen.findByRole('link', { name: '重新登录' })).getAttribute(
        'href',
      ),
    ).toBe('/login');
    expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
  });
});
