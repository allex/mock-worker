import fs from 'fs'
import p from 'path'

const absolutePath = /^(?:\/|(?:[A-Za-z]:)?[\\|/])/
const isAbsolute = (p: string): boolean => absolutePath.test(p)

// eslint-disable-next-line dot-notation
export const interopDefault = (ex: any) => ((ex && ex['__esModule'] && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex)

export const existsSync = (f: string): boolean => fs.existsSync(f)

export const ensureArray = (o: any): any[] => (Array.isArray(o) ? o : [o])

export const relativeId = (id: string) => {
  if (typeof process === 'undefined' || !isAbsolute(id)) return id
  return p.relative(process.cwd(), id)
}

// Returns the first exists filepath
export const searchFistFileSync = (files: string[], cwd: string): string | undefined => {
  for (let f of files) {
    f = p.resolve(cwd, f)
    if (existsSync(f)) return f
  }
}
