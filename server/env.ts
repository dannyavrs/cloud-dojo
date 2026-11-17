import { AWS_CONFIG_PATH, CHILD_HOME } from './paths'

export interface EmuInfo {
  endpoint: string
  caPath: string
  credsPath: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Build the environment for a child `aws` process FROM SCRATCH.
 * Never spread process.env here: the parent may hold real AWS credentials,
 * AWS_PROFILE, or ANTHROPIC_API_KEY, and none of that may reach a lesson.
 */
export function buildChildEnv(emu: EmuInfo, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: CHILD_HOME,
    LANG: 'en_US.UTF-8',
    AWS_ENDPOINT_URL: emu.endpoint,
    AWS_SHARED_CREDENTIALS_FILE: emu.credsPath,
    AWS_CONFIG_FILE: AWS_CONFIG_PATH,
    AWS_CA_BUNDLE: emu.caPath,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_DISABLE_HOST_PREFIX_INJECTION: 'true',
    AWS_REGION: 'us-east-1',
    AWS_DEFAULT_REGION: 'us-east-1',
    AWS_PAGER: '',
    ...extra,
  }
}

export function parseCredentialsFile(text: string): { accessKeyId: string; secretAccessKey: string } {
  const get = (k: string) => text.match(new RegExp(`^\\s*${k}\\s*=\\s*(\\S+)`, 'mi'))?.[1]
  const accessKeyId = get('aws_access_key_id')
  const secretAccessKey = get('aws_secret_access_key')
  if (!accessKeyId || !secretAccessKey) throw new Error('could not read emulator credentials file')
  return { accessKeyId, secretAccessKey }
}
