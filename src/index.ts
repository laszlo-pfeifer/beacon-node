// loggerPlugin.ts
import { randomUUID } from 'crypto'
import fp from 'fastify-plugin'
import { AsyncLocalStorage } from 'async_hooks'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

const executionContext = new AsyncLocalStorage<{
  traceId: string
  spanId: string
  parentSpanId?: string
}>()

type LogRecord = {
  timestamp?: string
  server_id?: string
  severity: 'TRACE' | 'INFO' | 'DEBUG' | 'WARN' | 'ERROR'
  message: string
  trace_id: string
  span_id?: string
  parent_span_id?: string
  duration_ms?: number
  attributes?: Record<string, unknown>
  // attributes: {
  //   statusCode: reply.statusCode.toString(),
  //   method: req.method,
  //   url: req.url,
  //   path: req.params?.path || '',
  // },
}

const BASE_URL = process.env['BEACON_URL'] ?? 'http://localhost:8080'

export const sendLog = async (logRecord: LogRecord) => {
  try {
    // console.log(
    //   `Sending log for ${logRecord.trace_id}:`,
    //   JSON.stringify(logRecord),
    // )
    // Here you would send
    await fetch(`${BASE_URL}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logRecord),
    })
    // console.log(res.status, await res.text())
    // console.log(res)
  } catch (error) {
    console.error(`Failed to send logs for ${logRecord.trace_id}:`, error)
  }
}

export const runInSpan = (cb: () => Promise<unknown>) => {
  executionContext.run(
    {
      traceId: executionContext.getStore()?.traceId || randomUUID(),
      parentSpanId: executionContext.getStore()?.spanId || randomUUID(),
      spanId: randomUUID(),
    },
    cb
  )
}

export const logInfo = (
  message: string,
  extra: Record<string, unknown> = {}
) => {
  const { duration_ms, ...attributes } = extra
  sendLog({
    timestamp: new Date().toISOString(),
    severity: 'INFO',
    message,
    duration_ms: Math.round(duration_ms || 0),
    trace_id: executionContext.getStore()?.traceId || randomUUID(),
    span_id: executionContext.getStore()?.spanId || randomUUID(),
    parent_span_id: executionContext.getStore()?.parentSpanId,
    attributes,
  })
}
export const logWarn = (
  message: string,
  extra: Record<string, unknown> = {}
) => {
  const { duration_ms, ...attributes } = extra
  sendLog({
    timestamp: new Date().toISOString(),
    severity: 'WARN',
    message,
    duration_ms: Math.round(duration_ms || 0),
    trace_id: executionContext.getStore()?.traceId || randomUUID(),
    span_id: executionContext.getStore()?.spanId || randomUUID(),
    parent_span_id: executionContext.getStore()?.parentSpanId,
    attributes,
  })
}
export const logError = (
  message: string,
  extra: Record<string, unknown> = {}
) => {
  const { duration_ms, ...attributes } = extra
  sendLog({
    timestamp: new Date().toISOString(),
    severity: 'ERROR',
    message,
    duration_ms: Math.round(duration_ms || 0),
    trace_id: executionContext.getStore()?.traceId || randomUUID(),
    span_id: executionContext.getStore()?.spanId || randomUUID(),
    parent_span_id: executionContext.getStore()?.parentSpanId,
    attributes,
  })
}

export interface MyPluginOptions {
  onRequestCallback?: (request: FastifyRequest, reply: FastifyReply) => void // Callback to be called on request
  onReplyCallback?: (request: FastifyRequest, reply: FastifyReply) => void // Callback to be called on reply
}

const myPluginAsync: FastifyPluginAsync<MyPluginOptions> = async (
  fastify,
  options
) => {
  fastify.decorateRequest('logContext', 'super_secret_value')
  fastify.decorateRequest('onRequestCallback', options.onRequestCallback)
  fastify.decorateReply('onReplyCallback', options.onReplyCallback)

  fastify.addHook('preHandler', (request, _reply, next) => {
    // Use executionContext to
    const { traceId, spanId } = request.logContext
    // console.log(traceId, spanId, 'request.logContext')
    executionContext.run({ traceId, spanId }, next)
  })
  fastify.addHook('onRequest', async (req, reply) => {
    // console.log(
    //   `Received request: ${req.method} ${
    //     req.url
    //   } at ${new Date().toISOString()}`
    // )
    // console.log(executionContext.getStore(), 'executionContext.getStore()')
    req.onRequestCallback?.call(req, req, reply)
    const traceId = executionContext.getStore()?.traceId || randomUUID()
    const spanId = executionContext.getStore()?.spanId || randomUUID()
    const start = process.hrtime.bigint()

    req.logContext = {
      traceId,
      spanId,
      start,
      logs: [] as unknown[],
    }

    sendLog({
      timestamp: new Date().toISOString(),
      severity: 'INFO',
      message: `Request to ${req.method} ${req.url.split('?')[0]}`,
      trace_id: traceId,
      span_id: spanId,
      attributes: {
        statusCode: reply.statusCode.toString(),
        method: req.method,
        url: req.url,
        path: req.params?.path || '',
      },
    })
  })

  fastify.addHook('onResponse', async (req, reply) => {
    const { traceId, spanId, start } = req.logContext || {}
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    // Send logs to your logging backend
    reply.onReplyCallback?.call(req, req, reply)
    sendLog({
      timestamp: new Date().toISOString(),
      severity: 'INFO',
      message: `Request to ${req.method} ${req.url.split('?')[0]} completed`,
      trace_id: traceId,
      span_id: spanId,
      duration_ms: Math.round(durationMs),
      attributes: {
        statusCode: reply.statusCode.toString(),
        method: req.method,
        url: req.url,
        path: req.params?.path || '',
      },
    })
  })
}

export const loggerPlugin = fp(myPluginAsync, {})
