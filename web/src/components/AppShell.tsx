import { Navigate, NavLink, Outlet } from 'react-router';
import { useMe } from '../api/auth';
import { useLogout } from '../useLogout';
import { PlusIcon } from './icons';
import { StreakFlame } from './streak/StreakFlame';
import { NAV_ITEMS } from './nav';
import { TitleBlock } from './TitleBlock';
import { VerifyBanner, VerifyRequired } from './VerifyNotice';

// Phone and tablet (under 1024 px): header, bottom tab bar and a floating "+".
// Desktop (1024 px and up): left sidebar with an "Add food" button.
// Signed-out visitors go to the landing page.
export function AppShell() {
  const me = useMe();
  const logout = useLogout();

  if (me.isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (me.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p>TRIM can&apos;t be reached right now.</p>
        <button
          type="button"
          onClick={() => void me.refetch()}
          className="tap rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/welcome" replace />;
  const user = me.data;
  // Body stats and targets come first; the app needs targets to be useful.
  if (!user.verify_required && user.setup !== 'done') return <Navigate to="/setup" replace />;

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        aria-label="Main"
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:gap-6 lg:border-r lg:border-border lg:bg-surface lg:px-4 lg:py-6"
      >
        {/* The flame sits on the TRIM line, to the right, clear of the full form below. */}
        <div className="relative">
          <TitleBlock variant="sidebar" className="px-1" />
          <div className="absolute -right-2 top-0">
            <StreakFlame placement="sidebar" />
          </div>
        </div>
        <NavLink
          to="/log"
          className="tap flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast"
        >
          <PlusIcon />
          Add food
        </NavLink>
        <nav aria-label="Primary">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `tap flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                      isActive
                        ? 'bg-surface-2 font-semibold text-text'
                        : 'text-text-secondary hover:bg-surface-2'
                    }`
                  }
                >
                  <Icon />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 border-b border-border bg-surface pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-safe-top lg:hidden">
          <div className="flex h-14 items-center justify-between gap-2">
            <TitleBlock variant="header" />
            <StreakFlame placement="header" />
          </div>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+5rem)] pt-4 lg:px-8 lg:pb-8 lg:pt-8">
          {user.verify_required ? (
            <VerifyRequired me={user} onLogout={() => logout.mutate()} />
          ) : (
            <>
              {user.email_verified ? null : <VerifyBanner me={user} />}
              <Outlet />
            </>
          )}
        </main>
      </div>

      <NavLink
        to="/log"
        aria-label="Add food"
        // Hidden on Log food itself, where it would only cover the list.
        className={({ isActive }) =>
          isActive
            ? 'hidden'
            : 'fixed bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+1rem)] right-[max(1rem,env(safe-area-inset-right))] z-20 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg lg:hidden'
        }
      >
        <PlusIcon width={28} height={28} />
      </NavLink>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-safe-bottom pl-safe-left pr-safe-right lg:hidden"
        data-testid="tabbar"
      >
        <ul className="mx-auto flex h-tabbar max-w-xl">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `tap flex h-full flex-col items-center justify-center gap-0.5 text-xs ${
                    isActive ? 'font-semibold text-accent' : 'text-text-secondary'
                  }`
                }
              >
                <Icon />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
