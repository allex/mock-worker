import { ServeWorker, ServeWorkerOptions } from './serveWorker'
import { RequestHandler } from './interface'
import { logger } from './logger'

export { ServeWorker }

export function middleware (options: ServeWorkerOptions): RequestHandler {
  const logLevel = options.logLevel
  if (logLevel) {
    logger.setLevel(logLevel)
  }

  logger.info('Init mock middleware... %j', options)

  const worker = new ServeWorker(options)
  return (req, res, next) => {
    worker.handle(req, res, next)
  }
}
