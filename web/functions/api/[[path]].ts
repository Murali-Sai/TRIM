// Cloudflare Pages Function: every request under /api/* (see public/_routes.json).
import { proxy, type ProxyEnv } from '../../edge/proxy';

export const onRequest = (context: { request: Request; env: ProxyEnv }): Promise<Response> =>
  proxy(context.request, context.env);
