import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { Me } from './api/auth';
import { App } from './App';

const ME: Me = {
  email: 'sam@example.com',
  display_name: 'Sam',
  timezone: 'America/New_York',
  unit_system: 'imperial',
  theme: 'system',
  email_verified: true,
  verify_deadline: null,
  verify_required: false,
  setup: 'done',
};

function stubMe(me: Me | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        me
          ? new Response(JSON.stringify(me), { status: 200 })
          : new Response(JSON.stringify({ detail: 'Not signed in' }), { status: 401 }),
      ),
    ),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

test('both navs list the five sections in order', async () => {
  stubMe(ME);
  renderAt('/');
  const navs = await screen.findAllByRole('navigation', { name: 'Primary' });
  expect(navs).toHaveLength(2);
  for (const nav of navs) {
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Today', 'Log', 'Body', 'Charts', 'Account']);
  }
});

test('marks the current section as active', async () => {
  stubMe(ME);
  renderAt('/body');
  await screen.findByRole('heading', { name: 'Body' });
  const active = screen.getAllByRole('link', { current: 'page' });
  expect(active.map((a) => a.textContent)).toEqual(['Body', 'Body']);
});

test('theme choice applies and persists', async () => {
  stubMe(ME);
  renderAt('/account');
  const select = await screen.findByLabelText('Theme');
  fireEvent.change(select, { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('trim.theme')).toBe('dark');

  fireEvent.change(select, { target: { value: 'system' } });
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  expect(localStorage.getItem('trim.theme')).toBeNull();
});

test('signed-out visitors are sent to the landing page', async () => {
  stubMe(null);
  renderAt('/charts');
  expect(await screen.findByRole('link', { name: 'Sign up' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
});

test('unverified users see the banner during the grace period', async () => {
  stubMe({ ...ME, email_verified: false, verify_deadline: '2026-10-24T12:00:00Z' });
  renderAt('/');
  expect(await screen.findByTestId('verify-banner')).toHaveTextContent('Confirm your email by');
  expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
});

test('after the grace period the app asks for confirmation instead', async () => {
  stubMe({
    ...ME,
    email_verified: false,
    verify_deadline: '2026-10-10T12:00:00Z',
    verify_required: true,
  });
  renderAt('/');
  expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
});
