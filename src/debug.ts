// ====== DEBUG HELPERS ======

// Debug flag for troubleshooting
export let debugLogging = false

export const enableDebugLogging = (): void => {
  debugLogging = true
  console.log('🔍 Beacon Debug Logging Enabled')
}

export const disableDebugLogging = (): void => {
  debugLogging = false
  console.log('🔍 Beacon Debug Logging Disabled')
}
