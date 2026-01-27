export function makePromptHistoryId(prefix = 'pth') {
  try {
    return `${String(prefix || 'pth')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `pth_${Date.now()}`;
  }
}

export function redactMcpToolsInRequestBody(body) {
  try {
    const clone = body ? JSON.parse(JSON.stringify(body)) : {};
    const tools = Array.isArray(clone?.tools) ? clone.tools : [];
    for (const tool of tools) {
      if (!tool || tool.type !== 'mcp') continue;
      if (tool.authorization) tool.authorization = '****';
      if (typeof tool.server_url === 'string' && tool.server_url) {
        try {
          const u = new URL(tool.server_url);
          if (u.searchParams.get('token')) u.searchParams.set('token', '****');
          tool.server_url = u.toString();
        } catch {}
      }
    }
    return clone;
  } catch {
    return {};
  }
}

export async function recordPromptConfigHistory(
  pool,
  { promptConfigId, input = null, output = null, requestBody = null, response = null, ms = null } = {}
) {
  try {
    const id = makePromptHistoryId();
    const pcid = String(promptConfigId || '').trim();
    if (!pcid) return;
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(
      `INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW())`,
      [
        id,
        pcid,
        input == null ? null : String(input),
        output == null ? null : String(output),
        requestBody == null ? null : JSON.stringify(requestBody),
        response == null ? null : JSON.stringify(response),
        ms == null ? null : Number(ms),
      ]
    );
  } catch {
    // Best-effort: do not block prompt execution on history writes.
  }
}

