// Preloaded ONLY by the synthetic localhost test runner, never the deployed app.
import http from 'node:http'
import https from 'node:https'
function local(value) {
  const host =
    typeof value === 'string' || value instanceof URL
      ? new URL(value).hostname
      : value?.hostname || value?.host || 'localhost'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error(
      `Synthetic test blocked external network destination: ${host}`,
    )
}
const originalFetch = globalThis.fetch
globalThis.fetch = function (input, init) {
  local(typeof input === 'object' && 'url' in input ? input.url : input)
  return originalFetch(input, init)
}
for (const transport of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = transport[method]
    transport[method] = function (...args) {
      local(args[0])
      return original.apply(this, args)
    }
  }
}
