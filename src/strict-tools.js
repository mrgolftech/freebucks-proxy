/**
 * OpenAI Chat Completions strict-tool request validation.
 *
 * This is the Chat-ingress contract from trefeon/freebuff-proxy #636:
 * a strict function tool must expose an object schema, every declared property
 * must be required, and additionalProperties must be false. Roo-compatible
 * sibling placement for required/additionalProperties is accepted.
 */

/**
 * @param {unknown} body
 * @returns {{ ok: true, strictToolNames: Set<string> } | { ok: false, error: { message: string, type: string, code: string, tool?: string } }}
 */
export function validateStrictToolsRequest(body) {
  const strictToolNames = new Set()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: true, strictToolNames }
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) continue
    if (typeof tool.type === 'string' && tool.type && tool.type !== 'function') continue

    const fn =
      tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function)
        ? tool.function
        : null
    if (!fn) continue
    if (fn.strict !== true && tool.strict !== true) continue

    const name = typeof fn.name === 'string' && fn.name ? fn.name : '(unnamed)'
    strictToolNames.add(name)
    const schema = fn.parameters
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return strictViolation(
        name,
        'parameters must be a JSON object schema with type object',
      )
    }
    if (schema.type !== 'object') {
      return strictViolation(name, 'parameters.type must be "object"')
    }

    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? schema.properties
        : {}
    const required = new Set()
    for (const source of [schema.required, fn.required]) {
      if (!Array.isArray(source)) continue
      for (const value of source) {
        if (typeof value === 'string') required.add(value)
      }
    }
    for (const key of Object.keys(properties)) {
      if (!required.has(key)) {
        return strictViolation(
          name,
          `property '${key}' must be listed in required`,
        )
      }
    }

    const additionalProperties =
      Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')
        ? schema.additionalProperties
        : fn.additionalProperties
    if (additionalProperties !== false) {
      return strictViolation(name, 'additionalProperties must be false')
    }
  }

  return { ok: true, strictToolNames }
}

function strictViolation(tool, detail) {
  return {
    ok: false,
    error: {
      message: `Strict tool '${tool}' is invalid: ${detail}`,
      type: 'invalid_request_error',
      code: 'strict_violation',
      tool,
    },
  }
}
