import { Options, Filter } from 'http-proxy-middleware'
import express from 'express'

export interface Request extends express.Request {}

export interface Response extends express.Response {}

export interface RequestHandler extends express.RequestHandler {}

export interface Router extends express.Router {}

export interface HPMOptions extends Options {}

export type HPMContextFilter = Filter

export type CallbackFunc<T = any> = (e: Error | {} | null, data?: T) => void;

export interface ProxyConfig extends HPMOptions {
  path?: HPMContextFilter;
  context?: HPMContextFilter;
  bypass?: (req: Request, res: Response, hpmConfig: ProxyConfig) => string;
}
