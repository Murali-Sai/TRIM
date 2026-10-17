import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

test('both navs list the five sections in order', () => {
  renderAt('/');
  const navs = screen.getAllByRole('navigation', { name: 'Primary' });
  expect(navs).toHaveLength(2);
  for (const nav of navs) {
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Today', 'Log', 'Body', 'Charts', 'Account']);
  }
});

test('marks the current section as active', () => {
  renderAt('/body');
  const active = screen.getAllByRole('link', { current: 'page' });
  expect(active.map((a) => a.textContent)).toEqual(['Body', 'Body']);
});

test('theme choice applies and persists', () => {
  renderAt('/account');
  fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('trim.theme')).toBe('dark');

  fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'system' } });
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  expect(localStorage.getItem('trim.theme')).toBeNull();
});
