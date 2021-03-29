import p from 'path'
import { MockWorker, MockWorkerOptions, RequestHandler } from './mock-worker'

export { MockWorker }

export function middleware (options: MockWorkerOptions = { root: process.cwd() }): RequestHandler {
  console.info('Initialize mock middleware...\n', {
    ...options,
    root: p.relative(process.cwd(), options.root)
  })

  const worker = new MockWorker(options)

  return (req, res, next) => {
    worker.handle(req, res, next)
  }
}
