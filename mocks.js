const p = require('path')
const chokidar = require('chokidar')
const findUp = require('find-up')
const Debugger = require('debug')

const permalink = k => k.replace(/([^/]+)\.[^/.]+$/, '$1')
const isEmpty = o => {
  for (const k in o) if (o.hasOwnProperty(k)) return false
  return true
}
const ensureArray = o => Array.isArray(o) ? o : [o]

const debug = Debugger('mock-worker')

const interopDefault = (ex) => (ex && ex['__esModule'] && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex

export class MockWorker {
  constructor(opts = { root: process.cwd() }) {
    this.root = opts.root
    this.cache = new Map

    this.setupWatcher()

    const tsProjectPath = findUp.sync('tsconfig.json')
    require('ts-node').register({
      project: tsProjectPath,
      transpileOnly: true,
      compilerOptions: {
        module: "CommonJS",
      },
      include: [
        `${this.root}/**/*.ts`,
      ]
    })
  }

  setupWatcher () {
    chokidar.watch(this.root).on('all', (event, path) => {
      if (event !== 'error') {
        if (require.cache[path]) {
          delete require.cache[path]
        }
        if (event === 'addDir') {
          return
        }
        const bullets = ensureArray(this.buildRoute(p.relative(this.root, path)))
        switch (event) {
          case 'add':
          case 'change':
            debug('set mock entity => ' + path)
            bullets.forEach(b => this.set(b))
            break;
          case 'unlink':
            debug('delete mock entity => ' + path)
            bullets.forEach(b => this.delete(b))
            break
        }
      }
    })
  }

  buildRoute (file) {
    const path = file
    if (p.sep === '\\') {
      path = path.split(p.sep).join('/')
    }

    const moduleName = `${this.root}${p.sep}${file}`
    const ext = p.extname(moduleName)

    if (ext !== '.json' && require.extensions[ext]) {
      const module = interopDefault(require(moduleName))
      if (module && typeof module === 'object') {
        return Object.keys(module).map(scheme => {
          const matches = /([A-Z]+) \/?([\w-/~]+)/.exec(scheme)
          if (!matches) {
            return
          }
          const [$0, method, path] = matches
          const response = module[scheme]
          return { path, method, response }
        }, []).filter(Boolean)
      }
    }

    return {
      path,
      method: 'POST|GET',
      response: (req, res, next) => {
        const r = interopDefault(require(moduleName))
        return typeof r === 'function'
          ? r(req, res, next)
          : r
      }
    }
  }

  get (spec) {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return api && api[method]
  }

  has (spec) {
    const cache = this.cache
    const { path, method } = spec
    const api = cache.get(path)
    return !!(api && api[method])
  }

  set (spec) {
    const cache = this.cache
    const { method, path, response } = spec
    const short = permalink(path)
    const targets = [path]

    if (short !== path) {
      // build permalink route, eg: /path/foo.json => /path/foo
      targets.push(short)
    }

    const methods = method.split('|')
    targets.forEach(path => {
      let dic = cache.get(path)
      if (!dic) {
        cache.set(path, dic = {})
      }
      methods.forEach(method => {
        dic[method] = {
          path,
          method,
          response
        }
      })
    })
  }

  delete (spec) {
    const cache = this.cache
    const { method, path } = spec
    const short = permalink(path)
    const targets = [path]

    if (short !== path) {
      // build permalink route, eg: /path/foo.json => /path/foo
      targets.push(short)
    }

    const methods = method.split('|')
    targets.forEach(path => {
      const dic = cache.get(path)
      if (!dic) {
        return
      }
      methods.forEach(method => { delete dic[method] })
      if (isEmpty(dic)) {
        cache.delete(path)
      }
    })
  }

  getBullets () {
    return Array.from(this.cache.values())
  }

  destroy () {
    chokidar.unwatch(this.root)
    this.cache.clear()
  }
}
