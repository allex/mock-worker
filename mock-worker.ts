import * as p from 'path'
import { EventEmitter } from 'events'
import * as chokidar from 'chokidar'
import * as findUp from 'find-up'
import Debugger from 'debug'
import * as express from 'express'
import { debounce } from '@tdio/utils'

export type MockWorkerOptions = {
  root: string;
  prefix?: string;
}

type Func = (...args: any[]) => void

export interface RequestHandler extends express.RequestHandler {}

type RouteSpecInput = {
  method: string;
  path: string;
}

type RouteSpec = RouteSpecInput & {
  response: RequestHandler | object | number | string;
}

const isEmpty = o => {
  for (const k in o) if (o.hasOwnProperty(k)) return false
  return true
}
const ensureArray = o => Array.isArray(o) ? o : [o]

const debug = Debugger('mock-worker')

const interopDefault = (ex) => (ex && ex['__esModule'] && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex

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
  const m = require('mockjs')
  if (m) {
    mock = m.mock
  }
} catch (e) {
  console.warn('Optionally load `mockjs` failed, you can install it manuall')
}

export class MockWorker extends EventEmitter {
  root: string;
  prefix: string;
  cache: Map<string, {}>;
  indexes: { k: string };
  router: express.Router;

  constructor({ root, prefix }: MockWorkerOptions) {
    super()

    prefix = prefix || '/'
    root = p.resolve(root || process.cwd())

    this.root = root
    this.prefix = prefix
    this.cache = new Map()
    this.indexes = Object.create(null)

    // fallback middleware ${prefix}/*
    const handleFallback: RequestHandler = (req, res, next): void => {
      const method = req.method.toUpperCase()
      const path = req.path
      const spec = { path, method }

      if (this.has(spec)) {
        const { response } = this.get(spec)
        let chain = false

        const result = typeof response === 'function'
          ? response(req, res, (err) => {
            next(err)
            chain = true
          })
          : response

        // avaid duplicate response
        if (chain || res.writableEnded) {
          return
        }

        res.json(mock(result))
        return
      }

      console.warn(`Invalid mock request: "${method} ${req.originalUrl}"`)
      next()
    }

    // internal router for daynamic routes registry
    const interopRouter = express.Router()

    this.router = express.Router()
    this.router.use(prefix, interopRouter, handleFallback)

    this.on('update', debounce(() => {
      this._rebuildInteropRoutes(interopRouter)
    }, 500))

    this._installTsc()

    const unwatch = this._setupWatcher()
    this.once('destroy', unwatch)
  }

  _installTsc(): void {
    try {
      require('ts-node').register({
        project: findUp.sync('tsconfig.json'),
        transpileOnly: true,
        compilerOptions: {
          module: 'CommonJS'
        },
        include: [
          `${this.root}/**/*.ts`
        ]
      })
    } catch (e) {
      console.warn('Typescript features are disabled because of `ts-node` resolve failed. \nYou can install it manuall', e)
    }
  }

  _setupWatcher(): Func {
    const sourcPath = this.root
    const watcher = chokidar.watch(sourcPath).on('all', (event, path) => {
      if (require.cache[path]) {
        delete require.cache[path]
      }
      if (event === 'addDir') {
        return
      }

      const filepath = p.relative(this.root, path)
      let routes = []

      switch (event) {
        case 'add':
        case 'change':
          const bullets = ensureArray(this._buildRoute(filepath))
          routes = bullets.reduce((arr, { method, path }) => {
            if (!arr.includes(path)) arr.push([method, path])
            return arr
          }, [])

          debug('[SET]: %s %O', filepath, routes)

          bullets.forEach(b => this.set(b))
          this.indexes[filepath] = routes
          break
        case 'unlink':
          routes = this.indexes[filepath]

          debug('[DEL]: %s %O', filepath, routes)

          routes.forEach(([method, path]) => this.delete({ method, path }))
          delete this.indexes[filepath]
          break
      }
      this.emit('update', filepath)
    })
    return () => {
      watcher.close()
      watcher.unwatch(sourcPath)
    }
  }

  _rebuildInteropRoutes(router: express.Router): void {
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

  _buildRoute(file: string): RouteSpec | RouteSpec[] {
    let path = file.replace(/\.[^./]+$/, '') // strip .ext
    if (p.sep === '\\') {
      path = path.split(p.sep).join('/')
    }

    // Ensure leading slash
    if (path[0] !== '/') {
      path = '/' + path
    }

    const moduleName = `${this.root}${p.sep}${file}`
    const ext = p.extname(moduleName)

    if (ext !== '.json' && require.extensions[ext]) {
      let module
      try {
        module = interopDefault(require(moduleName))
      } catch (e) {
        console.error(e)
      }
      if (module && typeof module === 'object') {
        return Object.keys(module).reduce((arr, scheme) => {
          const matches = /([A-Z]+) ([^\s]+)/.exec(scheme)
          if (!matches) {
            return arr
          }
          const [$0, method, path] = matches
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
        return typeof r === 'function'
          ? r(req, res, next)
          : r
      }
    }
  }

  handle(req: express.Request, res: express.Response, next: express.NextFunction): void {
    this.router(req, res, next)
  }

  has(spec: RouteSpecInput): boolean {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return !!(api && api[method])
  }

  get(spec: RouteSpecInput): RouteSpec {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return api && api[method]
  }

  set(spec: RouteSpec): void {
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

  delete(spec: RouteSpecInput): void {
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

  destroy(): void {
    this.emit('destroy')
    this.cache.clear()
  }
}
