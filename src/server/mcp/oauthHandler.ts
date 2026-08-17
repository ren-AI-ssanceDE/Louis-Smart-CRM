import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow } from '../db.js';
import { McpOAuthTokenRecord } from '../../types.js';

export async function saveMcpOAuthToken(
  tenantId: string,
  serverId: string,
  provider: string,
  accessToken: string,
  refreshToken?: string,
  expiresInSeconds?: number,
  scopes?: string[]
): Promise<void> {
  const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null;
  const id = `token_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (isUsingFallback) {
    if (!fallbackStore.mcpOauthTokens) fallbackStore.mcpOauthTokens = [];
    const existingIdx = fallbackStore.mcpOauthTokens.findIndex(
      (t) => (t.tenant_id === tenantId || t.tenant_id === '1') && t.server_id === serverId
    );
    const record: McpOAuthTokenRecord = {
      id: existingIdx >= 0 ? fallbackStore.mcpOauthTokens[existingIdx].id : id,
      tenant_id: tenantId,
      server_id: serverId,
      provider,
      access_token: accessToken,
      refresh_token: refreshToken || (existingIdx >= 0 ? fallbackStore.mcpOauthTokens[existingIdx].refresh_token : null),
      expires_at: expiresAt,
      scopes: scopes || null,
      created_at: existingIdx >= 0 ? fallbackStore.mcpOauthTokens[existingIdx].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      fallbackStore.mcpOauthTokens[existingIdx] = record;
    } else {
      fallbackStore.mcpOauthTokens.push(record);
    }
    saveFallbackStore();
    return;
  }

  const query = `
    INSERT INTO mcp_oauth_tokens (id, tenant_id, server_id, provider, access_token, refresh_token, expires_at, scopes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (tenant_id, server_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, mcp_oauth_tokens.refresh_token),
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `;

  await pool.query(query, [id, tenantId, serverId, provider, accessToken, refreshToken || null, expiresAt, scopes || null]);
}

export async function getMcpOAuthToken(
  tenantId: string,
  serverId: string
): Promise<McpOAuthTokenRecord | null> {
  if (isUsingFallback) {
    if (!fallbackStore.mcpOauthTokens) fallbackStore.mcpOauthTokens = [];
    const record = fallbackStore.mcpOauthTokens.find(
      (t) => (t.tenant_id === tenantId || t.tenant_id === '1') && t.server_id === serverId
    );
    return record || null;
  }

  const res = await pool.query(
    `SELECT * FROM mcp_oauth_tokens WHERE server_id = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
    [serverId, tenantId]
  );

  if (res.rows.length === 0) return null;
  return cleanDbRow(res.rows[0]) as McpOAuthTokenRecord;
}

export async function deleteMcpOAuthToken(
  tenantId: string,
  serverId: string
): Promise<void> {
  if (isUsingFallback) {
    if (!fallbackStore.mcpOauthTokens) fallbackStore.mcpOauthTokens = [];
    fallbackStore.mcpOauthTokens = fallbackStore.mcpOauthTokens.filter(
      (t) => !(t.server_id === serverId && (t.tenant_id === tenantId || t.tenant_id === '1'))
    );
    saveFallbackStore();
    return;
  }

  await pool.query(
    `DELETE FROM mcp_oauth_tokens WHERE server_id = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
    [serverId, tenantId]
  );
}

function findEnvVal(obj: Record<string, unknown> | null | undefined, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of Object.keys(obj)) {
    const kUpper = key.toUpperCase();
    if (keys.some(k => k.toUpperCase() === kUpper)) {
      const val = obj[key];
      if (val && typeof val === 'string' && val.trim()) {
        return val.trim();
      }
    }
  }
  return undefined;
}

export function buildOAuthAuthUrl(
  provider: 'google' | 'github' | 'slack',
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[] = []
): string {
  if (provider === 'google') {
    const defaultScopes = scopes.length > 0 ? scopes : [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ];
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(defaultScopes.join(' '))}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  } else if (provider === 'github') {
    const defaultScopes = scopes.length > 0 ? scopes : ['repo', 'read:user', 'user:email'];
    return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(defaultScopes.join(' '))}&state=${encodeURIComponent(state)}`;
  } else if (provider === 'slack') {
    const defaultScopes = scopes.length > 0 ? scopes : ['chat:write', 'channels:read'];
    return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(defaultScopes.join(','))}&state=${encodeURIComponent(state)}`;
  }
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

export async function handleMcpOAuthCallback(
  code: string,
  stateRaw: string,
  redirectUri: string
): Promise<{ success: boolean; message?: string }> {
  let stateObj: { tenantId?: string; serverId?: string; provider?: string; redirectUri?: string } = {};
  try {
    stateObj = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf8'));
  } catch {
    throw new Error('Ungültiger State-Parameter.');
  }

  const { tenantId = '1', serverId, provider, redirectUri: stateRedirectUri } = stateObj;
  if (!serverId || !provider) {
    throw new Error('Server-ID oder Provider fehlt im State.');
  }

  const effectiveRedirectUri = stateRedirectUri || redirectUri;

  // Retrieve client ID and client secret from server config
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const idKeys = ['GOOGLE_CLIENT_ID', 'CLIENT_ID', 'SLACK_CLIENT_ID', 'GITHUB_CLIENT_ID', 'GDRIVE_CLIENT_ID'];
  const secretKeys = ['GOOGLE_CLIENT_SECRET', 'CLIENT_SECRET', 'SLACK_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'GDRIVE_CLIENT_SECRET'];

  if (isUsingFallback) {
    const s = fallbackStore.mcp_external_servers?.find((srv) => srv.id_uuid === serverId);
    if (s?.env_vars) {
      clientId = findEnvVal(s.env_vars, idKeys) || clientId;
      clientSecret = findEnvVal(s.env_vars, secretKeys) || clientSecret;
    }
  } else {
    const res = await pool.query(
      `SELECT env_vars FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [serverId, tenantId]
    );
    if (res.rows.length > 0) {
      const envs = cleanDbRow(res.rows[0]).env_vars;
      if (envs) {
        clientId = findEnvVal(envs, idKeys) || clientId;
        clientSecret = findEnvVal(envs, secretKeys) || clientSecret;
      }
    }
  }

  let accessToken = '';
  let refreshToken: string | undefined = undefined;
  let expiresIn: number | undefined = undefined;
  let scopes: string[] | undefined = undefined;

  if (provider === 'google') {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: effectiveRedirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(`Google OAuth Token Fehler: ${tokenData.error_description || tokenData.error || 'Unbekannt'}`);
    }
    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token;
    expiresIn = tokenData.expires_in;
    if (tokenData.scope) scopes = tokenData.scope.split(' ');
  } else if (provider === 'github') {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: effectiveRedirectUri
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(`GitHub OAuth Token Fehler: ${tokenData.error_description || tokenData.error || 'Unbekannt'}`);
    }
    accessToken = tokenData.access_token;
    if (tokenData.scope) scopes = tokenData.scope.split(',');
  } else if (provider === 'slack') {
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: effectiveRedirectUri
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.ok) {
      throw new Error(`Slack OAuth Token Fehler: ${tokenData.error || 'Unbekannt'}`);
    }
    accessToken = tokenData.access_token;
  }

  if (!accessToken) {
    throw new Error('Kein Access Token empfangen.');
  }

  await saveMcpOAuthToken(tenantId, serverId, provider, accessToken, refreshToken, expiresIn, scopes);
  return { success: true };
}
