/**
 * Ports. The learner's own dev server owns 4747 (API) and 5173 (Vite). Anything automated
 * (tests, e2e, screenshots, a throwaway data folder) must use the TEST pair, so it can never
 * answer for, or replace, the learner's running session.
 */
export const DEFAULT_API_PORT = 4747
export const DEFAULT_WEB_PORT = 5173
export const TEST_API_PORT = 4848
export const TEST_WEB_PORT = 5274
