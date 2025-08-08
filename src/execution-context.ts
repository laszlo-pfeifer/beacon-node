import { AsyncLocalStorage } from 'async_hooks'

export const executionContext = new AsyncLocalStorage<{
  traceId: string
  spanId: string
  logCount: number
  parentSpanId?: string
}>()
