import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { TimeoutError } from '../../lib/timeout';
import { dayKey } from '../../lib/streak';

// [NEW-R] React render suite for DashboardPage (task: visual-parity gap
// flagged in A4, M2 brownfield, additive tests only).
//
// SCOPE: the page's RENDER behavior — loading state, the dueCount /
// no-due / statsError branch selection, the streak + daily-goal display
// paths, and the page-level catch mapping (TimeoutError -> degrade to
// zeros, non-timeout -> statsError banner + retry). The read-model's
// data contract is already pinned by dashboardReadModel.test.ts; this
// suite covers ONLY the parts that file cannot reach (the JSX).
//
// Canonical TC IDs come from acceptance-criteria.md (QA section):
// TC-DASH-R-01 .. TC-DASH-R-08.
//
// Mock strategy:
//   - useNavigate          -> vi.fn (no Router needed)
//   - useAuth              -> configurable hoisted state (user/profile/isMock)
//   - fetchDashboardStats  -> configurable hoisted vi.fn (resolve/reject per test)
//   - useLanguage          -> REAL LanguageProvider, locale pinned to 'en'
//     in beforeEach so assertions match en.json strings deterministically.
//
// Re-run: npx vitest run src/pages/__tests__/DashboardPage.render.test.tsx

// ---- react-router-dom: only useNavigate is consumed by the page ----
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// ---- useAuth: configurable per-test (hoisted so the factory can close over it) ----
type MockAuth = {
  user: { id: string; email?: string } | null;
  profile: {
    display_name?: string;
    daily_goal?: number;
    current_streak?: number;
    last_activity_date?: string;
  } | null;
  isMock: boolean;
};
const auth = vi.hoisted(() => ({ value: null as unknown as MockAuth }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth.value,
}));

// ---- read-model seam: configurable resolve/reject per test ----
const readModel = vi.hoisted(() => ({ fetchDashboardStats: vi.fn() }));
vi.mock('../../lib/vocabulary/dashboardReadModel', () => ({
  fetchDashboardStats: readModel.fetchDashboardStats,
}));

import { DashboardPage } from '../DashboardPage';

const today = dayKey(new Date());

// A "happy" Learner: an active 7-day streak (last activity today, so
// displayStreak does NOT reset it) and the default 20-card daily goal.
const defaultAuth = (): MockAuth => ({
  user: { id: 'learner-1', email: 'lan@example.com' },
  profile: {
    display_name: 'Lan',
    daily_goal: 20,
    current_streak: 7,
    last_activity_date: today,
  },
  isMock: true,
});

const renderDashboard = () =>
  render(
    <LanguageProvider>
      <DashboardPage />
    </LanguageProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Pin locale so t() resolves the en.json strings we assert on.
  localStorage.clear();
  localStorage.setItem('learnt_locale', 'en');
  auth.value = defaultAuth();
  // Silence the page's intentional console.error / console.warn in the
  // error / timeout branches — they are expected, not test noise.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('DashboardPage render — loading [TC-DASH-R-01]', () => {
  it('TC-DASH-R-01 shows the loading spinner + loading text while stats are pending', () => {
    // Never resolves -> loading stays true.
    readModel.fetchDashboardStats.mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderDashboard();

    expect(screen.getByText('Loading stats...')).toBeInTheDocument();
    expect(container.querySelector('.spinner')).toBeInTheDocument();
    // The dashboard body has not rendered yet.
    expect(screen.queryByText('Start Practicing')).not.toBeInTheDocument();
  });
});

describe('DashboardPage render — due cards [TC-DASH-R-02]', () => {
  it('TC-DASH-R-02 dueCount>0 renders the due alert + count + "Review Now" CTA', async () => {
    readModel.fetchDashboardStats.mockResolvedValue({ dueCount: 3, reviewedToday: 0 });
    renderDashboard();

    // CTA is the discriminator for the dueCount>0 branch.
    const cta = await screen.findByRole('button', { name: /Review Now/i });
    expect(cta).toBeInTheDocument();
    // The numeric badge shows the count.
    expect(screen.getByText('3')).toBeInTheDocument();
    // The alert description copy.
    expect(
      screen.getByText('You have cards waiting to be reviewed'),
    ).toBeInTheDocument();
    // Clicking the CTA navigates to the Review Session.
    await userEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith('/vocabulary/review');
  });
});

describe('DashboardPage render — all caught up [TC-DASH-R-03]', () => {
  it('TC-DASH-R-03 dueCount===0 renders the no-due state, NOT the alert', async () => {
    readModel.fetchDashboardStats.mockResolvedValue({ dueCount: 0, reviewedToday: 0 });
    renderDashboard();

    expect(await screen.findByText('No due cards for today!')).toBeInTheDocument();
    expect(
      screen.getByText('Check back later or learn some new words!'),
    ).toBeInTheDocument();
    // The due-alert CTA must be absent.
    expect(
      screen.queryByRole('button', { name: /Review Now/i }),
    ).not.toBeInTheDocument();
  });
});

describe('DashboardPage render — streak [TC-DASH-R-04]', () => {
  it('TC-DASH-R-04 renders the streak value from profile (displayStreak path)', async () => {
    readModel.fetchDashboardStats.mockResolvedValue({ dueCount: 0, reviewedToday: 0 });
    renderDashboard();

    // current_streak=7 with last_activity_date=today -> displayStreak=7.
    expect(await screen.findByText('7 Days Active!')).toBeInTheDocument();
  });

  it('TC-DASH-R-04 a stale streak (>=2 days idle) collapses to the 0-streak label', async () => {
    // last activity 3 days ago -> displayStreak returns 0 -> "0 streak".
    const stale = dayKey(new Date(Date.now() - 3 * 86_400_000));
    auth.value = {
      ...defaultAuth(),
      profile: { daily_goal: 20, current_streak: 7, last_activity_date: stale },
    };
    readModel.fetchDashboardStats.mockResolvedValue({ dueCount: 0, reviewedToday: 0 });
    renderDashboard();

    expect(await screen.findByText('0 streak')).toBeInTheDocument();
    expect(screen.queryByText('7 Days Active!')).not.toBeInTheDocument();
  });
});

describe('DashboardPage render — daily goal [TC-DASH-R-05]', () => {
  it('TC-DASH-R-05 renders progressPercent from reviewedToday/dailyGoal', async () => {
    // 5 / 20 -> 25%.
    readModel.fetchDashboardStats.mockResolvedValue({ dueCount: 0, reviewedToday: 5 });
    renderDashboard();

    expect(await screen.findByText('25%')).toBeInTheDocument();
    expect(
      screen.getByText('5/20 cards reviewed today'),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage render — stats error mapping [TC-DASH-R-06]', () => {
  it('TC-DASH-R-06 a NON-timeout rejection renders the statsError banner + retry control', async () => {
    readModel.fetchDashboardStats.mockRejectedValue(new Error('network down'));
    renderDashboard();

    // role="alert" wrapper distinguishes the error banner from the due alert.
    const banner = await screen.findByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't load your stats. Please try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Try Again/i }),
    ).toBeInTheDocument();
    // It must NOT have fallen through to the no-due / due states.
    expect(screen.queryByText('No due cards for today!')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Review Now/i }),
    ).not.toBeInTheDocument();
  });
});

describe('DashboardPage render — timeout degrade [TC-DASH-R-07]', () => {
  it('TC-DASH-R-07 a TimeoutError degrades to zeros (all-caught-up), NOT the statsError banner', async () => {
    readModel.fetchDashboardStats.mockRejectedValue(
      new TimeoutError('DashboardPage: due cards count', 8_000),
    );
    renderDashboard();

    // Degrades to dueCount=0 -> the no-due state renders.
    expect(await screen.findByText('No due cards for today!')).toBeInTheDocument();
    // The error banner / retry must be absent (timeout is handled silently).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load your stats. Please try again."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Try Again/i }),
    ).not.toBeInTheDocument();
  });
});

describe('DashboardPage render — retry [TC-DASH-R-08]', () => {
  it('TC-DASH-R-08 clicking retry on the error banner re-invokes fetchDashboardStats', async () => {
    readModel.fetchDashboardStats.mockRejectedValue(new Error('network down'));
    renderDashboard();

    const retry = await screen.findByRole('button', { name: /Try Again/i });
    // Initial mount fetch.
    expect(readModel.fetchDashboardStats).toHaveBeenCalledTimes(1);

    await userEvent.click(retry);

    await waitFor(() =>
      expect(readModel.fetchDashboardStats).toHaveBeenCalledTimes(2),
    );
  });
});
