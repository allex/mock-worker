/* eslint-disable @typescript-eslint/no-var-requires */

import { EventEmitter } from 'events'
import p from 'path'

import chokidar from 'chokidar'
import findUp from 'find-up'
import express from 'express'
import { debounce, isEmpty } from '@tdio/utils'
import { createProxyMiddleware } from 'http-proxy-middleware'

import { prepareProxy } from './prepareProxy'
import { Router, RequestHandler, ProxyConfig, HPMOptions, CallbackFunc } from './interface'
import { interopDefault, existsSync, ensureArray, relativeId, searchFistFileSync } from './utils'
import { loadConfigFile } from './configLoader'
import { logger } from './logger'

export type ServeWorkerOptions = {
  root: string;
  prefix: string;
  hot?: boolean;
  logLevel?: 'debug' | 'log' | 'info' | 'warn' | 'error' | 'silent';
  proxyConfig?: string;
  proxySetup?: string;
}

type RouteSpecInput = {
  method: string;
  path: string;
}

type RouteSpec = RouteSpecInput & {
  response: RequestHandler | object | number | string;
}

const wrapMiddlewareFn = (handle: RequestHandler): RequestHandler => (req, res, next): void => {
  let fired = false
  const r = handle(req, res, err => {
    next(err)
    fired = true
  })

  if (fired || res.writableEnded) {
    return
  }

  if (r !== undefined) {
    const type = typeof r
    switch (type) {
      case 'object':
        res.json(r)
        break
      default:
        res.send(String(r))
        break
    }
  } else {
    next()
  }
}

const normalizeMiddlewareFn = <T>(o: T): RequestHandler => {
  const t = typeof o
  let fn: RequestHandler
  switch (t) {
    case 'function':
      fn = wrapMiddlewareFn(o as any)
      break
    case 'object':
      fn = (req, res): void => { res.json(o) }
      break
    default:
      fn = (req, res): void => { res.send(o) }
  }
  return fn
}

let mock = v => v
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const m = require('mockjs')
  if (m) {
    mock = m.mock
  }
} catch (e) {
  logger.warn('Optionally load `mockjs` failed, you can install it manually')
}

const watch = (source: string, cb: CallbackFunc, options = {}) => {
  const ref = chokidar.watch(source, options).on('all', cb)
  return function () {
    ref.close()
    ref.unwatch(source)
  }
}

const getProxyMiddleware = (proxyConfig: ProxyConfig) => {
  const context = proxyConfig.context || proxyConfig.path

  // It is possible to use the `bypass` method without a `target`.
  // However, the proxy middleware has no use in this case, and will fail to instantiate.
  if (proxyConfig.target) {
    return createProxyMiddleware(context!, proxyConfig as HPMOptions)
  }
}

export class ServeWorker extends EventEmitter {
  cache: Map<string, {}>;
  indexes: { k: string };
  options: ServeWorkerOptions;
  app: Router;

  constructor (options: ServeWorkerOptions) {
    super()

    const cwd = process.cwd()
    options = {
      ...options,
      prefix: options.prefix || '/',
      root: p.resolve(options.root || cwd)
    }

    if (!options.proxySetup) {
      options.proxySetup = searchFistFileSync(['setupProxy.js'], cwd)
    }
    if (!options.proxyConfig) {
      const name = 'proxy'
      const searchFiles = ['.json', '.js'].reduce((arr, t) => (arr.push(`${name}${t}`, `.${name}${t}`), arr), [] as string[])
      options.proxyConfig = searchFistFileSync(searchFiles, cwd)
    }

    this.options = options
    this.cache = new Map()
    this.indexes = Object.create(null)
    this.app = express.Router()

    this._installTsc()

    this.setupLocalMiddleware()
    this.setupProxyFeature()
  }

  handle (req: express.Request, res: express.Response, next: express.NextFunction): void {
    this.app(req, res, next)
  }

  setupLocalMiddleware (): void {
    // middleware for serving mock handle
    const handles: any[] = []

    // #1 internal router for daynamic routes registry
    const interopRouter = express.Router()

    this.on('routeChanged', debounce(() => {
      this._rebuildInteropRoutes(interopRouter)
    }, 500))

    this.once('destroy', watch(
      this.options.root,
      this._handleRouteChange.bind(this)
    ))

    handles.push(interopRouter)

    // #2 middleware handle local routes
    handles.push((req, res, next) => {
      const method = req.method.toUpperCase()
      const path = req.path
      const spec = { path, method }

      if (this.has(spec)) {
        const response = this.get(spec).response
        let chain = false
        const result = typeof response === 'function'
          ? response(req, res, err => (next(err), chain = true))
          : response

        // avaid duplicate response
        if (chain || res.writableEnded) return

        res.json(mock(result))
      } else {
        next()
      }
    })

    this.app.use(this.options.prefix, handles)
  }

  /**
   * proxy setup
   */
  setupProxyFeature (): void {
    const {
      proxyConfig: configFile,
      proxySetup
    } = this.options

    if (configFile && existsSync(configFile)) {
      logger.info('Setup default proxy: %s', configFile)

      const defultProxyRouter = express.Router()
      this._setupDefaultProxy(defultProxyRouter, configFile)

      this.once('destroy', watch(configFile, (event, path) => {
        if (event === 'change') {
          logger.info(`Reload default proxy (${relativeId(configFile)})`)

          defultProxyRouter.stack.length = 0

          this._setupDefaultProxy(defultProxyRouter, configFile)
        }
      }, { ignoreInitial: false }))

      this.app.use(defultProxyRouter)
    }

    if (proxySetup && existsSync(proxySetup)) {
      logger.info('Setup custom proxy: %s', proxySetup)

      const setupCustomProxy = (app: Router) => {
        require(proxySetup)(app)
      }

      const customProxyRouter = express.Router()
      setupCustomProxy(customProxyRouter)

      this.once('destroy', watch(proxySetup, (event, path) => {
        if (event === 'change') {
          logger.info(`Reload custom proxy (${relativeId(proxySetup)})`)

          customProxyRouter.stack.length = 0
          delete require.cache[proxySetup]

          setupCustomProxy(customProxyRouter)
        }
      }, { ignoreInitial: false }))

      this.app.use(customProxyRouter)
    }
  }

  /* inspired from webpack-dev-server#setupProxyFeature() */
  _setupDefaultProxy (app: Router, configFile: string): void {
    const proxyConfig = loadConfigFile(configFile)
    const proxy = prepareProxy(proxyConfig)

    // Assume a proxy configuration specified as:
    // proxy: [
    //   { context: ..., ...options... },
    //   // or:
    //   function() {
    //     return { context: ..., ...options... };
    //   }
    // ]
    proxy.forEach((proxyConfigOrCallback: any) => {
      let proxyMiddleware
      let proxyConfig: ProxyConfig = typeof proxyConfigOrCallback === 'function'
        ? proxyConfigOrCallback()
        : proxyConfigOrCallback

      proxyMiddleware = getProxyMiddleware(proxyConfig)

      app.use((req, res, next) => {
        if (typeof proxyConfigOrCallback === 'function') {
          const newProxyConfig = proxyConfigOrCallback()

          if (newProxyConfig !== proxyConfig) {
            proxyConfig = newProxyConfig
            proxyMiddleware = getProxyMiddleware(proxyConfig)
          }
        }

        // - Check if we have a bypass function defined
        // - In case the bypass function is defined we'll retrieve the
        // bypassUrl from it otherwise bypassUrl would be null
        const bypassUrl = typeof proxyConfig.bypass === 'function'
          ? proxyConfig.bypass(req, res, proxyConfig)
          : null

        if (typeof bypassUrl === 'boolean') {
          // skip the proxy
          req.url = ''
          next()
        } else if (typeof bypassUrl === 'string') {
          // byPass to that url
          req.url = bypassUrl
          next()
        } else if (proxyMiddleware) {
          return proxyMiddleware(req, res, next)
        } else {
          next()
        }
      })
    })
  }

  _installTsc (): void {
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies
      require('ts-node').register({
        project: findUp.sync('tsconfig.json'),
        transpileOnly: true,
        compilerOptions: {
          module: 'CommonJS'
        },
        include: [
          `${this.options.root}/**/*.ts`
        ]
      })
    } catch (e) {
      logger.warn('Typescript features are disabled because of `ts-node` resolve failed. \nYou can install it manuall', e)
    }
  }

  _handleRouteChange (event, path): void {
    if (require.cache[path]) {
      delete require.cache[path]
    }

    if (event === 'addDir') {
      return
    }

    const filepath = p.relative(this.options.root, path)
    let routes: Array<[string, string]> = []
    switch (event) {
      case 'add':
      case 'change':
        const bullets = ensureArray(this._buildRoute(filepath))
        routes = bullets.reduce((arr, { method, path }) => {
          if (!arr.includes(path)) arr.push([method, path])
          return arr
        }, [])

        logger.debug('[SET]: %s %j', filepath, routes)

        bullets.forEach(b => this.set(b))
        this.indexes[filepath] = routes
        break
      case 'unlink':
        routes = this.indexes[filepath]

        logger.debug('[DEL]: %s %j', filepath, routes)

        routes.forEach(([method, path]) => this.delete({ method, path }))
        delete this.indexes[filepath]
        break
      default:
    }

    this.emit('routeChanged', filepath)
  }

  _rebuildInteropRoutes (router: Router): void {
    const cache = this.cache
    const reParamsRoute = /[{(*+?:)}]/

    // clear interop routes
    router.stack.length = 0

    // rebuild
    Array.from(cache.keys())
      .filter(p => reParamsRoute.test(p))
      .forEach(p => {
        const dic = cache.get(p)!
        Object.keys(dic).forEach(method => {
          const response = dic[method].response
          const fn = normalizeMiddlewareFn(response)
          router[method.toLowerCase()](p, fn)
        })
      })
  }

  _buildRoute (file: string): RouteSpec | RouteSpec[] {
    let path = file.replace(/\.[^./]+$/, '') // strip .ext
    if (p.sep === '\\') {
      path = path.split(p.sep).join('/')
    }

    // Ensure leading slash
    if (!path.startsWith('/')) {
      path = `/${path}`
    }

    const moduleName = `${this.options.root}${p.sep}${file}`
    const ext = p.extname(moduleName)

    if (ext !== '.json' && require.extensions[ext]) {
      let module
      try {
        module = interopDefault(require(moduleName))
      } catch (e) {
        logger.error(e)
      }
      if (module && typeof module === 'object') {
        return Object.keys(module).reduce((arr, scheme) => {
          const matches = /([A-Z]+) ([^\s]+)/.exec(scheme)
          if (!matches) {
            return arr
          }
          const [_$0, method, path] = matches
          const response = module[scheme]
          return arr.push({ path, method, response }), arr
        }, [] as RouteSpec[])
      }
    }

    return {
      path,
      method: 'GET|POST',
      response: (req, res, next) => {
        const r = interopDefault(require(moduleName))
        return typeof r === 'function' ? r(req, res, next) : r
      }
    }
  }

  has (spec: RouteSpecInput): boolean {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return !!(api && api[method])
  }

  get (spec: RouteSpecInput): RouteSpec {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return api && api[method]
  }

  set (spec: RouteSpec): void {
    const cache = this.cache
    const { method, path, response } = spec

    const methods = method.split('|')
    let dic = cache.get(path)
    if (!dic) {
      cache.set(path, dic = {})
    }
    methods.forEach(method => {
      dic![method] = { path, method, response }
    })
  }

  delete (spec: RouteSpecInput): void {
    const cache = this.cache
    const { method, path } = spec

    const methods = method.split('|')
    const dic = cache.get(path)
    if (!dic) {
      return
    }
    methods.forEach(method => { delete dic[method] })
    if (isEmpty(dic)) {
      cache.delete(path)
    }
  }

  destroy (): void {
    this.emit('destroy')
    this.cache.clear()
  }
}
