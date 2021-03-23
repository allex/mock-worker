import Mock from 'mockjs'
import { MockWorker } from './mocks'

function param2Obj (url) {
  const search = url.split('?')[1]
  if (!search) {
    return {}
  }
  return JSON.parse(
    `{"${
      decodeURIComponent(search)
        .replace(/"/g, '\\"')
        .replace(/&/g, '","')
        .replace(/=/g, '":"')
        .replace(/\+/g, ' ')
    }"}`
  )
}

export function middleware (options = {}) {
  // opts
  const baseUrl = options.baseUrl || '/mock/'
  const root = options.rootDir || process.cwd()

  const offset = baseUrl.length
  const mw = new MockWorker({ root })

  console.info('\nInitialize mock middleware...', { root, baseUrl })

  return (req, res, next) => {
    const reqPath = req.path

    if (reqPath.indexOf(baseUrl) === 0) {
      const method = req.method.toUpperCase()
      const path = reqPath.substring(offset)
      const spec = { path, method }

      if (mw.has(spec)) {
        const { response } = mw.get(spec)
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

        return res.json(Mock.mock(result))
      } else {
        console.warn(`Invalid mock request: "${method} ${reqPath}"`)
      }
    }

    next()
  }
}
