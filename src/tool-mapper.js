/**
 * Request-scoped tool-name virtualization for foreign agent harnesses.
 *
 * Inspired by trefeon/freebuff-proxy v1.11.0 (#653/#654), but deliberately
 * narrower in semantics: this module NEVER translates argument schemas or
 * guesses that two different client tools are equivalent. It only virtualizes
 * names that the mirrored upstream detector explicitly classifies as
 * FOREIGN_HARNESS_TOOL_NAMES, using a collision-free mcp__ namespace alias,
 * and restores the exact client name on the response path.
 *
 * Decision record:
 * .agents/notes/implemented/feature/2026-09-19-universal-tool-translation.md
 */

import { FOREIGN_HARNESS_TOOL_NAMES } from './upstream/foreign-client-signals.js'

function offeredToolNames(tools) {
  const names = []
  if (!Array.isArray(tools)) return names
  for (const tool of tools) {
    const name = tool?.function?.name
    if (typeof name === 'string' && name) names.push(name)
  }
  return names
}

function shouldVirtualize(name) {
  if (typeof name !== 'string' || !name) return false
  if (name.includes('__')) return false
  return FOREIGN_HARNESS_TOOL_NAMES.has(name) || /^cron/i.test(name)
}

function chooseVirtualName(name, occupied) {
  const base = `mcp__${name}`
  if (!occupied.has(base)) return base
  let n = 2
  while (occupied.has(`${base}__fbp${n}`)) n++
  return `${base}__fbp${n}`
}

/**
 * @typedef {{
 *   clientToUpstream: Map<string,string>,
 *   upstreamToClient: Map<string,string>,
 *   size: number
 * }} ToolNameMapper
 */

/**
 * Build a request-scoped, collision-free bidirectional map.
 *
 * @param {unknown} tools
 * @returns {ToolNameMapper}
 */
export function createToolNameMapper(tools) {
  const names = offeredToolNames(tools)
  const occupied = new Set(names)
  const clientToUpstream = new Map()
  const upstreamToClient = new Map()

  for (const name of names) {
    if (!shouldVirtualize(name) || clientToUpstream.has(name)) continue
    const alias = chooseVirtualName(name, occupied)
    clientToUpstream.set(name, alias)
    upstreamToClient.set(alias, name)
    occupied.add(alias)
  }

  return {
    clientToUpstream,
    upstreamToClient,
    size: clientToUpstream.size,
  }
}

function toUpstreamName(name, mapper) {
  return typeof name === 'string'
    ? mapper.clientToUpstream.get(name) || name
    : name
}

function toClientName(name, mapper) {
  return typeof name === 'string'
    ? mapper.upstreamToClient.get(name) || name
    : name
}

function rewriteFunction(fn, rename) {
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return fn
  const nextName = rename(fn.name)
  return nextName === fn.name ? fn : { ...fn, name: nextName }
}

function rewriteToolCall(call, rename) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return call
  const nextFunction = rewriteFunction(call.function, rename)
  return nextFunction === call.function
    ? call
    : { ...call, function: nextFunction }
}

function rewriteMessage(message, rename) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return message
  }
  let changed = false
  const out = { ...message }

  if (Array.isArray(message.tool_calls)) {
    const calls = message.tool_calls.map((call) => rewriteToolCall(call, rename))
    if (calls.some((call, i) => call !== message.tool_calls[i])) {
      out.tool_calls = calls
      changed = true
    }
  }

  const functionCall = rewriteFunction(message.function_call, rename)
  if (functionCall !== message.function_call) {
    out.function_call = functionCall
    changed = true
  }

  if (message.role === 'tool' && typeof message.name === 'string') {
    const nextName = rename(message.name)
    if (nextName !== message.name) {
      out.name = nextName
      changed = true
    }
  }

  return changed ? out : message
}

/**
 * Rewrite all name-bearing locations on the request path.
 *
 * @param {Record<string, any>} body
 * @param {ToolNameMapper} mapper
 * @returns {Record<string, any>}
 */
export function rewriteToolNamesForUpstream(body, mapper) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !mapper ||
    mapper.size === 0
  ) {
    return body
  }

  const rename = (name) => toUpstreamName(name, mapper)
  let changed = false
  const out = { ...body }

  if (Array.isArray(body.tools)) {
    const tools = body.tools.map((tool) => {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
      const nextFunction = rewriteFunction(tool.function, rename)
      return nextFunction === tool.function
        ? tool
        : { ...tool, function: nextFunction }
    })
    if (tools.some((tool, i) => tool !== body.tools[i])) {
      out.tools = tools
      changed = true
    }
  }

  if (typeof body.tool_choice === 'string') {
    if (!['auto', 'none', 'required'].includes(body.tool_choice)) {
      const next = rename(body.tool_choice)
      if (next !== body.tool_choice) {
        out.tool_choice = next
        changed = true
      }
    }
  } else if (
    body.tool_choice &&
    typeof body.tool_choice === 'object' &&
    !Array.isArray(body.tool_choice)
  ) {
    const nextFunction = rewriteFunction(body.tool_choice.function, rename)
    if (nextFunction !== body.tool_choice.function) {
      out.tool_choice = { ...body.tool_choice, function: nextFunction }
      changed = true
    }
  }

  if (Array.isArray(body.messages)) {
    const messages = body.messages.map((message) =>
      rewriteMessage(message, rename),
    )
    if (messages.some((message, i) => message !== body.messages[i])) {
      out.messages = messages
      changed = true
    }
  }

  return changed ? out : body
}

function restoreCalls(calls, mapper) {
  if (!Array.isArray(calls)) return calls
  const rename = (name) => toClientName(name, mapper)
  return calls.map((call) => rewriteToolCall(call, rename))
}

/**
 * Restore client-visible names in a non-streaming response or one parsed SSE
 * payload.
 *
 * @param {any} payload
 * @param {ToolNameMapper} mapper
 * @returns {any}
 */
export function restoreToolNamesInResponse(payload, mapper) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !mapper ||
    mapper.size === 0 ||
    !Array.isArray(payload.choices)
  ) {
    return payload
  }

  const rename = (name) => toClientName(name, mapper)
  let changed = false
  const choices = payload.choices.map((choice) => {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
      return choice
    }
    let choiceChanged = false
    const out = { ...choice }

    for (const key of ['message', 'delta']) {
      const part = choice[key]
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue

      const calls = restoreCalls(part.tool_calls, mapper)
      const functionCall = rewriteFunction(part.function_call, rename)
      if (calls !== part.tool_calls || functionCall !== part.function_call) {
        out[key] = {
          ...part,
          ...(calls !== part.tool_calls ? { tool_calls: calls } : {}),
          ...(functionCall !== part.function_call
            ? { function_call: functionCall }
            : {}),
        }
        choiceChanged = true
      }
    }

    if (choiceChanged) changed = true
    return choiceChanged ? out : choice
  })

  return changed ? { ...payload, choices } : payload
}

/**
 * Rewrite one OpenAI SSE line. Non-data lines, [DONE], and malformed JSON
 * pass through unchanged.
 *
 * @param {string} line
 * @param {ToolNameMapper} mapper
 * @returns {string}
 */
export function rewriteToolMapperSseLine(line, mapper) {
  if (!mapper || mapper.size === 0 || typeof line !== 'string') return line

  const newline = line.endsWith('\r\n')
    ? '\r\n'
    : line.endsWith('\n')
      ? '\n'
      : ''
  const core = newline ? line.slice(0, -newline.length) : line
  const match = core.match(/^(\s*data:\s*)(.*)$/)
  if (!match) return line
  if (match[2].trim() === '[DONE]') return line

  try {
    const parsed = JSON.parse(match[2])
    const restored = restoreToolNamesInResponse(parsed, mapper)
    return match[1] + JSON.stringify(restored) + newline
  } catch {
    return line
  }
}

/**
 * Incrementally restore names in an SSE body without buffering the response.
 *
 * @param {ToolNameMapper} mapper
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
export function createToolMapperSseTransform(mapper) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''

  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      let newlineAt
      while ((newlineAt = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newlineAt + 1)
        pending = pending.slice(newlineAt + 1)
        controller.enqueue(
          encoder.encode(rewriteToolMapperSseLine(line, mapper)),
        )
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) {
        controller.enqueue(
          encoder.encode(rewriteToolMapperSseLine(pending, mapper)),
        )
      }
    },
  })
}
