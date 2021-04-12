/* eslint @typescript-eslint/no-use-before-define: [1, 'nofunc'] */

import url from 'url'

import address from 'address'
import chalk from 'chalk'
import isGlob from 'is-glob'
import { getLogger } from '@allex/logger'
import { hasOwn } from '@tdio/utils'

import { ProxyConfig, HPMOptions } from './interface'
import { logger } from './logger'

const defaultConfig: Partial<HPMOptions> = {
  logLevel: 'silent',
  secure: false,
  changeOrigin: true,
  ws: true,
  xfwd: true
}

const reRegExp = /(^[^])|([$]$)/
const isStringPath = (s: any) => typeof s === 'string' && (reRegExp.test(s) || !isGlob(s))

// rebuild proxy context, handle regexp if possiable
const normalizeProxyContext = (context: any) => {
  if (isStringPath(context)) {
    // sync with vue-cli#lib/util/prepareProxy
    // improve string context with regexp pattern, http-proxy-middleware/dist/context-matcher.js#matchSingleStringPath
    // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
    return (pathname, req) => !!pathname.match(context as string)
  }

  if (Array.isArray(context)) {
    return context.map(context => normalizeProxyContext(context))
  }

  return context
}

export function prepareProxy (proxyConfig: Partial<ProxyConfig> | ProxyConfig[]): ProxyConfig[] {
  // Support proxy as a string for those who are using the simple proxy option
  if (typeof proxyConfig === 'string') {
    if (!/^http(s)?:\/\//.test(proxyConfig)) {
      logger.error('When "proxy" is specified in package.json it must start with either http:// or https://')
      process.exit(1)
    }
    return [
      { ...defaultConfig, ...createProxyEntry(proxyConfig) }
    ]
  }

  let proxy: ProxyConfig[] = []

  // Otherwise, proxy is an object so create an array of proxies,
  // Assume a proxy configuration specified as:
  // proxy: {
  //   'context': { options }
  // }
  // OR
  // proxy: {
  //   'context': 'target'
  // }
  if (!Array.isArray(proxyConfig)) {
    if (hasOwn(proxyConfig, 'target')) {
      proxy = [proxyConfig]
    } else {
      proxy = Object.keys(proxyConfig).map(context => {
        let proxyOptions
        if (typeof proxyConfig[context] === 'string') {
          proxyOptions = {
            context,
            target: proxyConfig[context]
          }
        } else {
          proxyOptions = { ...proxyConfig[context], context }
        }
        return proxyOptions
      })
    }
  }

  // Normalize common proxy properties
  return proxy.map(config => {
    const entry = createProxyEntry(config.target as string, config)
    return { ...defaultConfig, ...config, ...entry }
  })
}

// Normalize HPM config
function createProxyEntry (target: string | undefined, config?: ProxyConfig): ProxyConfig {
  // shallow clone
  const proxyConfig = { ...config }

  const {
    onProxyReq,
    context
  } = proxyConfig

  // There're a little-known use case that the `target` field is an object rather than a string
  // https://github.com/chimurai/http-proxy-middleware/blob/master/recipes/https.md
  if (typeof target === 'string' && process.platform === 'win32') {
    target = resolveLoopback(target)
  }

  // Enhance context (such as regexp supports etc,.)
  if (context) {
    proxyConfig.context = normalizeProxyContext(context as string)
  }

  return {
    logLevel: 'warn',
    ...proxyConfig,
    target,
    onProxyReq (proxyReq, req, res) {
      if (onProxyReq) {
        onProxyReq(proxyReq, req, res)
      }
      // Browsers may send Origin headers even with same-origin
      // requests. To prevent CORS issues, we have to change
      // the Origin to match the target URL.
      if (!(proxyReq as any).agent && proxyReq.getHeader('origin')) {
        proxyReq.setHeader('origin', target!)
      }
    },
    onError: onProxyError(target || '')
  }
}

function resolveLoopback (target: string) {
  const o = url.parse(target)
  o.host = null
  if (o.hostname !== 'localhost') {
    return target
  }
  // Unfortunately, many languages (unlike node) do not yet support IPv6.
  // This means even though localhost resolves to ::1, the application
  // must fall back to IPv4 (on 127.0.0.1).
  // We can re-enable this in a few years.
  /* try {
    o.hostname = address.ipv6() ? '::1' : '127.0.0.1';
  } catch (_ignored) {
    o.hostname = '127.0.0.1';
  } */

  try {
    // Check if we're on a network; if we are, chances are we can resolve
    // localhost. Otherwise, we can just be safe and assume localhost is
    // IPv4 for maximum compatibility.
    if (!address.ip()) {
      o.hostname = '127.0.0.1'
    }
  } catch (_ignored) {
    o.hostname = '127.0.0.1'
  }
  return url.format(o)
}

// Povide a custom onError function to log custom error messages on the console.
function onProxyError (target: string) {
  return (err, req, res) => {
    const host = req.headers && req.headers.host

    logger.error(`Proxy error: Could not proxy request ${chalk.cyan(req.url)} from ${chalk.cyan(host)} to ${chalk.cyan(target)} ${chalk.cyan(`(${err.code})`)}.`)

    // And immediately send the proper error response to the client.
    // Otherwise, the request will eventually timeout with ERR_EMPTY_RESPONSE on the client side.
    if (res.writeHead && !res.headersSent) {
      res.writeHead(500)
    }
    res.end(`Proxy error: Could not proxy request ${req.url} from ${host} to proxy (${err.code}).`)
  }
}
