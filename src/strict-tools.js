/**
 * OpenAI strict-tool request validation.
 *
 * Mirrors the contract already exercised by trefeon/freebuff-proxy #636:
 * a function with strict:true must expose an object schema, require every
 * declared property, and reject additional properties. Loose tools are left
 * untouched.
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
    const fn =
      tool && typeof tool === 'object' && !Array.isArray(tool)
        ? tool.function
        : null
    if (!fn || typeof fn !== 'object' || fn.strict !== true) continue

    const name = typeof fn.name === 'string' && fn.name ? fn.name : '(unnamed)'
    strictToolNames.add(name)
    const schema = fn.parameters
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return strictViolation(name, 'parameters must be a JSON Schema object')
    }
    if (schema.type !== 'object') {
      return strictViolation(name, "parameters.type must be 'object'")
    }

    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? schema.properties
        : {}
    const propertyNames = Object.keys(properties)
    if (!Array.isArray(schema.required)) {
      return strictViolation(name, 'parameters.required must list every property')
    }
    const required = new Set(schema.required.filter((v) => typeof v === 'string'))
    const missing = propertyNames.filter((key) => !required.has(key))
    if (missing.length > 0) {
      return strictViolation(
        name,
        `parameters.required is missing: ${missing.join(', ')}`,
      )
    }
    if (schema.additionalProperties !== false) {
      return strictViolation(name, 'parameters.additionalProperties must be false')
    }
  }

  // A strict tool call already present in conversation history must carry valid
  // JSON arguments. This prevents replaying malformed strict calls upstream.
  if (strictToolNames.size > 0 && Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object' || message.role !== 'assistant') continue
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      for (const call of calls) {
        const fn = call && typeof call === 'object' ? call.function : null
        if (!fn || typeof fn !== 'object' || !strictToolNames.has(fn.name)) continue
        if (typeof fn.arguments !== 'string') {
          return strictViolation(fn.name, 'tool call arguments must be a JSON string')
        }
        try {
          JSON.parse(fn.arguments)
        } catch {
          return strictViolation(fn.name, 'tool call arguments must contain valid JSON')
        }
      }
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
