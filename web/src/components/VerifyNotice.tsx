import { useMutation } from '@tanstack/react-query';
import { resendVerify, type Me } from '../api/auth';
import { ApiError } from '../api/client';

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function useResend() {
  return useMutation({ mutationFn: resendVerify });
}

function ResendButton({ resend }: { resend: ReturnType<typeof useResend> }) {
  return (
    <button
      type="button"
      onClick={() => resend.mutate()}
      disabled={resend.isPending}
      className="tap rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-60"
    >
      {resend.isPending ? 'Sending' : 'Send a new link'}
    </button>
  );
}

function resendMessage(resend: ReturnType<typeof useResend>): string | null {
  if (resend.isSuccess) return 'Sent. Check your inbox.';
  if (resend.error instanceof ApiError && resend.error.userMessage) return resend.error.userMessage;
  if (resend.error) return 'Could not send right now. Try again.';
  return null;
}

/** A banner while the 7-day grace period runs. */
export function VerifyBanner({ me }: { me: Me }) {
  const resend = useResend();
  const message = resendMessage(resend);
  return (
    <div
      className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="verify-banner"
    >
      <p className="text-sm">
        Confirm your email{me.verify_deadline ? ` by ${formatDeadline(me.verify_deadline)}` : ''}.
        We sent a link to <span className="font-semibold break-all">{me.email}</span>.
        {message ? (
          <span className="block font-medium" role="status">
            {message}
          </span>
        ) : null}
      </p>
      <ResendButton resend={resend} />
    </div>
  );
}

/** Shown instead of the app once the grace period has passed. */
export function VerifyRequired({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const resend = useResend();
  const message = resendMessage(resend);
  return (
    <section className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6 text-center">
      <h2 className="text-2xl font-bold">Confirm your email</h2>
      <p className="mt-3">
        To keep using TRIM, open the link we sent to{' '}
        <span className="font-semibold break-all">{me.email}</span>. Your data is safe.
      </p>
      {message ? (
        <p className="mt-3 text-sm font-medium" role="status">
          {message}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <ResendButton resend={resend} />
        <button type="button" onClick={onLogout} className="tap text-sm text-accent underline">
          Log out
        </button>
      </div>
    </section>
  );
}
