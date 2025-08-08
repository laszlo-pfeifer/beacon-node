import fp from 'fastify-plugin'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { endHttpTrace, runInSpan, startHttpTrace } from './api.js'
import { executionContext } from './execution-context.js'

// Extended Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    logContext: {
      traceId: string
      spanId: string
      start: bigint
    }
    _logContext?: {
      traceId: string
      spanId: string
      start: bigint
    }
    onRequestCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  }

  interface FastifyReply {
    onReplyCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  }
}

export type BeaconFastifyPluginOptions = {
  onRequestCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  onReplyCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  excludePaths?: string[] // Paths to exclude from trace logging
}

const beaconFastifyPluginAsync: FastifyPluginAsync<
  BeaconFastifyPluginOptions
> = async (fastify, options) => {
  fastify.decorateRequest('logContext', {
    getter() {
      const request = this as FastifyRequest
      return (
        request._logContext || {
          traceId: '',
          spanId: '',
          start: BigInt(0),
          logCount: 0,
          logs: [],
        }
      )
    },
    setter(value) {
      const request = this as FastifyRequest
      request._logContext = value
    },
  })
  fastify.decorateRequest('onRequestCallback', options.onRequestCallback)
  fastify.decorateReply('onReplyCallback', options.onReplyCallback)

  // Helper function to check if path should be excluded
  const shouldExcludePath = (path: string): boolean => {
    if (!options.excludePaths || options.excludePaths.length === 0) {
      return false
    }

    const normalizedPath = path.split('?')[0] // Remove query params for matching
    return options.excludePaths.some((excludePath) => {
      // Support exact match and wildcard patterns
      if (excludePath.endsWith('*')) {
        const prefix = excludePath.slice(0, -1)
        return normalizedPath.startsWith(prefix)
      }
      return normalizedPath === excludePath
    })
  }

  fastify.addHook('onRequest', (request, reply, done) => {
    const start = process.hrtime.bigint()

    runInSpan(async () => {
      request.logContext = {
        traceId: executionContext.getStore()?.traceId || '',
        spanId: executionContext.getStore()?.spanId || '',
        start,
      }
      request.onRequestCallback?.(request, reply)
      if (!shouldExcludePath(request.url)) {
        startHttpTrace({
          method: request.method,
          path: request.url.split('?')[0],
          userAgent: request.headers['user-agent'],
          remoteIP: request.ip,
        })
      }
      done()
    })
  })
  fastify.addHook('onResponse', (request, reply, done) => {
    if (!shouldExcludePath(request.url)) {
      const { start } = request.logContext || {}

      const durationMs = !start
        ? 0
        : Number(process.hrtime.bigint() - start) / 1e6
      endHttpTrace({
        method: request.method,
        path: request.url.split('?')[0],
        statusCode: reply.statusCode,
        durationMs,
      })
    }
    reply.onReplyCallback?.(request, reply)
    done()
  })
}

export const beaconFastifyPlugin = fp(beaconFastifyPluginAsync, {})
