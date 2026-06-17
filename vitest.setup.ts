import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library does not auto-clean between tests under Vitest's
// globals mode unless we wire it here. Unmount + clear the happy-dom DOM
// after every test so render-based suites stay isolated.
afterEach(() => {
  cleanup();
});
