import { MockWorker, MockWorkerOptions, RequestHandler } from './mock-worker'

export { MockWorker }

export function middleware (options: MockWorkerOptions = { root: process.cwd() }): RequestHandler {
  console.info('Initialize mock middleware...\n', options)

  const worker = new MockWorker(options)

  return (req, res, next) => {
    worker.handle(req, res, next)
  }
}
