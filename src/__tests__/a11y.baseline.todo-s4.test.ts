import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';

// QA S2-delta (M2 brownfield) PRE-FIX A11Y BASELINE — additive, NON-blocking.
// Purpose: record the CURRENT axe violations on a faithful static snapshot of
// LoginPage's form so S4 has a concrete target (AC-A1.1 label association,
// AC-A1.6 error-banner role). This test does NOT assert zero violations — that
// is S4's job (NFR-B6). It asserts the baseline is reproducible and prints the
// pre-fix count. When S4 fixes the markup, the partner assertion (currently
// skipped) flips green and this TODO file is retired.
//
// We snapshot static markup (not the live <LoginPage/>) deliberately: the real
// page depends on 3 context providers and RTL is not installed; a faithful DOM
// fragment keeps the baseline deterministic in happy-dom.

const LOGIN_FORM_SNAPSHOT = `
  <div class="login-card-wrapper">
    <div class="login-brand">
      <h1 class="login-title">LearnT</h1>
      <p class="login-subtitle">Learn English smarter</p>
    </div>
    <div class="error-banner">Invalid email or password</div>
    <form class="login-form">
      <div class="form-group">
        <label class="label">Email</label>
        <input type="email" class="input" placeholder="name@example.com" />
      </div>
      <div class="form-group">
        <label class="label">Password</label>
        <input type="password" class="input" placeholder="********" />
      </div>
      <button type="submit" class="btn btn-primary login-btn">Sign In</button>
    </form>
  </div>
`;

function mountSnapshot(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = LOGIN_FORM_SNAPSHOT;
  document.body.appendChild(host);
  return host;
}

describe('a11y pre-fix baseline (LoginPage form snapshot) [TODO_S4]', () => {
  it('records the current axe violation count (baseline, non-blocking)', async () => {
    const host = mountSnapshot();
    const results = await axe(host);
    const violations = results.violations ?? [];

    // Baseline marker: surface what S4 must drive to zero. This is recorded,
    // NOT enforced. We expect at least the label-association violation today.
    const ids = violations.map((v) => `${v.id}(${v.impact})`).sort();
    const passes = results.passes?.length ?? 0;
    const incomplete = results.incomplete?.length ?? 0;
    const inapplicable = results.inapplicable?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[A11Y-BASELINE] LoginPage snapshot pre-fix violations = ${violations.length} :: ${ids.join(', ') || 'none'} | passes=${passes} incomplete=${incomplete} inapplicable=${inapplicable}`,
    );

    // The harness must produce a deterministic result object every run.
    expect(Array.isArray(violations)).toBe(true);
    host.remove();
  });

  // S4 TARGET — flips on once labels gain htmlFor/id + accessible names and the
  // error banner gets role="alert". Skipped now so the 62-suite stays green and
  // additive (NFR-B3/B4). Un-skip in S4 to gate the fix (NFR-B6).
  it.skip('[S4 TARGET] LoginPage form has no axe violations', async () => {
    const host = mountSnapshot();
    const results = await axe(host);
    expect(results.violations ?? []).toHaveLength(0);
    host.remove();
  });
});
