import { homedir } from 'node:os'
import path from 'node:path'

export const APP_DIR = path.resolve(import.meta.dirname, '..')
/** Where the app kept its data before it was renamed. Only ever read, never written or removed. */
export const LEGACY_DATA_DIR = path.join(homedir(), '.aws-academy')
export const DEFAULT_DATA_DIR = path.join(homedir(), '.cloud-dojo')
/** An explicit override: CLOUD_DOJO_DATA_DIR, or the old ACADEMY_DATA_DIR name (still accepted). */
export const DATA_DIR_OVERRIDE = process.env.CLOUD_DOJO_DATA_DIR ?? process.env.ACADEMY_DATA_DIR
/** Everything the app writes outside the repo lives here. */
export const DATA_DIR = DATA_DIR_OVERRIDE ?? DEFAULT_DATA_DIR
export const EMU_HOST_DIR = path.join(DATA_DIR, 'emulator')
export const WORK_ROOT = path.join(DATA_DIR, 'work')
/** A throwaway HOME for child processes so the AWS CLI can never see ~/.aws. */
export const CHILD_HOME = path.join(DATA_DIR, 'child-home')
export const AWS_CONFIG_PATH = path.join(DATA_DIR, 'aws-config')
export const EMULATOR_VERSION = '1.0.341'
export const IMAGE = `cloud-dojo-emulator:${EMULATOR_VERSION}`
export const CONTAINER = process.env.EMULATOR_CONTAINER ?? 'cloud-dojo-emulator'
export const EMU_PORT = Number(process.env.EMULATOR_PORT ?? 9297)
