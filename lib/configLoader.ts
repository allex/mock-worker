import fs from 'fs'
import importFresh from 'import-fresh'
import stripJsonComments from 'strip-json-comments'
import varsBraceExpand from 'vars-expand'

import { logger } from './logger'

const readJsFile = (f: string) => {
  try {
    return importFresh(f)
  } catch (e) {
    logger.error('Load config file error: %s, %o', f, e)
  }
}

const readJSONFile = (f: string) => {
  const s = varsBraceExpand(
    stripJsonComments(fs.readFileSync(f, 'utf8')),
    process.env
  )
  try {
    return JSON.parse(s)
  } catch (e) {
    logger.error('Load config file error: %s, %o', f, e)
  }
}

// built-in loaders, can register customize loader by `registerLoader(ext, loader)`
const loaders = {
  '.js': readJsFile,
  '.json': readJSONFile
}

export const loadConfigFile = (f: string) => {
  const ext = f.substr(f.lastIndexOf('.'))
  if (loaders.hasOwnProperty(ext)) {
    return loaders[ext](f)
  }
  throw new Error('config file type not support yet')
}

export const registerLoader = (ext: string, loader: ((f: string) => {})) => {
  loader[ext] = loader
}
