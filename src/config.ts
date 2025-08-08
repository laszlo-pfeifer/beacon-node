// Configuration for the beacon client - optimized for 5k+ req/min
export type BeaconConfig = {
  baseUrl: string
  sendEnabled: boolean
  batchSize: number
  batchTimeout: number
  maxRetries: number
  retryDelay: number
  enableValidation: boolean
}

export const DEFAULT_CONFIG: BeaconConfig = {
  baseUrl: process.env['BEACON_URL'] || 'http://localhost:8085',
  sendEnabled:
    !!process.env['BEACON_URL'] &&
    process.env['BEACON_ENABLED']?.toLowerCase() !== 'false',
  batchSize: 50, // Optimized for 5k+ req/min performance
  batchTimeout: 5000, // 5 seconds auto-flush as required
  maxRetries: 3,
  retryDelay: 1000, // 1 second initial delay
  enableValidation: true, // MANDATORY validation to prevent batch failures
}
