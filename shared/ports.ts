/**
 * Ports. The learner's own dev server owns 4747 (API) and 5173 (Vite), and the learner's
 * emulator owns container `cloud-dojo-emulator` on 9297. Anything automated (tests, e2e,
 * screenshots, a throwaway data folder) must use the TEST pair and a dedicated emulator
 * (`cloud-dojo-emulator-test` on 9298), so it can never answer for, or replace, the learner's
 * running session or wipe their live lab.
 */
export const DEFAULT_API_PORT = 4747
export const DEFAULT_WEB_PORT = 5173
export const TEST_API_PORT = 4848
export const TEST_WEB_PORT = 5274
export const DEFAULT_EMU_NAME = 'cloud-dojo-emulator'
export const DEFAULT_EMU_PORT = 9297
export const TEST_EMU_NAME = 'cloud-dojo-emulator-test'
export const TEST_EMU_PORT = 9298
