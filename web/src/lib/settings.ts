// This device's own MVSEP API token, replacing config.mvsep_token()/NCOSIS_MVSEP_TOKEN. Each
// installer provides their own; it's stored locally and never shared between devices.

import { Preferences } from '@capacitor/preferences'

const TOKEN_KEY = 'ncosis:mvsepToken'

export async function getMvsepToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: TOKEN_KEY })
  return value || null
}

export async function setMvsepToken(token: string): Promise<void> {
  const trimmed = token.trim()
  if (trimmed) await Preferences.set({ key: TOKEN_KEY, value: trimmed })
  else await Preferences.remove({ key: TOKEN_KEY })
}

export async function hasMvsepToken(): Promise<boolean> {
  return (await getMvsepToken()) !== null
}
