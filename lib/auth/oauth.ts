import OAuth2Server from "@node-oauth/oauth2-server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Accounts, digest, secret, type User } from "./accounts";

export const SCOPES = ["listo:read", "listo:write"];
const clientSchema = z.object({
  client_name: z.string().trim().min(1).max(120).default("MCP application"),
  redirect_uris: z.array(z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return !url.hash && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
  })).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).default(["code"]),
  scope: z.string().optional(),
});
type RegisteredClient = z.infer<typeof clientSchema> & { client_id: string; client_id_issued_at: number };
type TokenRow = { issuer: string; resource: string; access_hash: string; refresh_hash: string; grant_id: string; access_expires: number; refresh_expires: number; used: number; scope: string; user_id: string; client_id: string; revoked: number };

export class OAuthService {
  readonly resource: string;
  constructor(readonly issuer: string, readonly accounts = new Accounts()) { this.resource = `${issuer}/mcp`; }
  client(id: string): RegisteredClient | undefined {
    const row = this.accounts.db.prepare("SELECT data FROM oauth_clients WHERE id=?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  register(data: unknown) {
    this.accounts.throttle("oauth:register", 30);
    const parsed = clientSchema.parse(data);
    if (parsed.scope && !parsed.scope.split(" ").every(s => SCOPES.includes(s))) throw new Error("Invalid scope");
    const client = { ...parsed, scope: SCOPES.join(" "), client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
    this.accounts.db.prepare("INSERT INTO oauth_clients VALUES (?, ?)").run(client.client_id, JSON.stringify(client));
    return client;
  }
  authorization(params: URLSearchParams) {
    const client = this.client(params.get("client_id") || "");
    if (!client || !client.redirect_uris.includes(params.get("redirect_uri") || "")) throw new Error("Invalid application or redirect address");
    if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "")) throw new Error("This application must use authorization code with PKCE S256");
    if (params.get("resource") !== this.resource) throw new Error("Invalid resource");
    const scopes = (params.get("scope") || "listo:read").split(" ");
    if (!scopes.length || !scopes.every(s => SCOPES.includes(s))) throw new Error("Invalid scope");
    return { client, scopes };
  }
  private row(hash: string, refresh = false) {
    return this.accounts.db.prepare(`SELECT t.*, g.user_id, g.client_id, g.revoked FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id WHERE t.${refresh ? "refresh_hash" : "access_hash"}=?`).get(hash) as TokenRow | undefined;
  }
  access(token: string) {
    const row = this.row(digest(token));
    if (!row || row.issuer !== this.issuer || row.resource !== this.resource || row.revoked || row.access_expires <= Date.now() || !this.accounts.user(row.user_id)) return null;
    return { userId: row.user_id, clientId: row.client_id, scopes: row.scope.split(" "), expiresAt: Math.floor(row.access_expires / 1000) };
  }
  revoke(token: string, clientId: string) {
    const row = this.row(digest(token)) || this.row(digest(token), true);
    if (row?.client_id === clientId) this.accounts.db.prepare("UPDATE oauth_grants SET revoked=1 WHERE id=?").run(row.grant_id);
  }
  private model(resource: string): OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel {
    const db = this.accounts.db;
    const clientFor = (id: string): OAuth2Server.Client | false => {
      const client = this.client(id);
      return client ? { id, redirectUris: client.redirect_uris, grants: client.grant_types } : false;
    };
    return {
      getClient: async (id, secretValue) => secretValue ? false : clientFor(id),
      generateAccessToken: async () => secret(), generateRefreshToken: async () => secret(), generateAuthorizationCode: async () => secret(),
      validateScope: async (_user, _client, scope) => (scope || ["listo:read"]).every(s => SCOPES.includes(s)) ? scope || ["listo:read"] : false,
      validateRedirectUri: async (uri, client) => Array.isArray(client.redirectUris) && client.redirectUris.includes(uri),
      saveAuthorizationCode: async (code, client, user) => {
        const grantId = randomUUID();
        const saved = { ...code, client, user: { id: user.id, grantId }, resource, issuer: this.issuer };
        db.transaction(() => {
          if (!this.accounts.user(String(user.id))) throw new Error("Account unavailable");
          db.prepare("INSERT INTO oauth_grants(id,user_id,client_id,scope,created_at) VALUES (?,?,?,?,?)").run(grantId, user.id, client.id, (code.scope || []).join(" "), Date.now());
          // Persist only the code hash; the raw value appears once in the redirect.
          const { authorizationCode: _raw, ...stored } = saved;
          void _raw;
          db.prepare("INSERT INTO oauth_codes VALUES (?,?,?,?)").run(digest(code.authorizationCode), JSON.stringify(stored), code.expiresAt.getTime(), user.id);
        })();
        return saved;
      },
      getAuthorizationCode: async code => {
        const row = db.prepare("SELECT data,expires_at FROM oauth_codes WHERE hash=? AND expires_at>?").get(digest(code), Date.now()) as { data: string; expires_at: number } | undefined;
        if (!row) return false;
        const saved = JSON.parse(row.data);
        if (saved.resource !== resource || saved.issuer !== this.issuer || !this.accounts.user(saved.user.id)) return false;
        return { ...saved, authorizationCode: code, expiresAt: new Date(row.expires_at) };
      },
      revokeAuthorizationCode: async code => db.prepare("DELETE FROM oauth_codes WHERE hash=?").run(digest(code.authorizationCode)).changes === 1,
      saveToken: async (token, client, user) => {
        const grant = db.prepare("SELECT id FROM oauth_grants WHERE id=? AND user_id=? AND client_id=? AND revoked=0").get(user.grantId, user.id, client.id);
        if (!grant || !this.accounts.user(String(user.id))) throw new Error("Grant revoked");
        db.prepare("INSERT INTO oauth_tokens(access_hash,refresh_hash,grant_id,issuer,resource,access_expires,refresh_expires,scope) VALUES (?,?,?,?,?,?,?,?)").run(digest(token.accessToken), digest(token.refreshToken!), user.grantId, this.issuer, resource, token.accessTokenExpiresAt!.getTime(), token.refreshTokenExpiresAt!.getTime(), (token.scope || []).join(" "));
        return { ...token, user, client };
      },
      getAccessToken: async token => {
        const auth = this.access(token);
        if (!auth || resource !== this.resource) return false;
        return { accessToken: token, accessTokenExpiresAt: new Date(auth.expiresAt * 1000), user: { id: auth.userId }, client: clientFor(auth.clientId) as OAuth2Server.Client, scope: auth.scopes };
      },
      getRefreshToken: async token => {
        const row = this.row(digest(token), true);
        if (!row || row.issuer !== this.issuer || row.resource !== this.resource || row.revoked || row.refresh_expires <= Date.now() || !this.accounts.user(row.user_id) || resource !== this.resource) return false;
        if (row.used) { db.prepare("UPDATE oauth_grants SET revoked=1 WHERE id=?").run(row.grant_id); return false; }
        return { refreshToken: token, refreshTokenExpiresAt: new Date(row.refresh_expires), client: clientFor(row.client_id) as OAuth2Server.Client, user: { id: row.user_id, grantId: row.grant_id }, scope: row.scope.split(" ") };
      },
      revokeToken: async token => {
        const result = db.prepare("UPDATE oauth_tokens SET used=1 WHERE refresh_hash=? AND used=0").run(digest(token.refreshToken));
        if (!result.changes) this.revoke(token.refreshToken, token.client.id);
        return result.changes === 1;
      },
      verifyScope: async (token, scope) => scope.every(s => token.scope?.includes(s)),
    };
  }
  private server(resource: string) {
    return new OAuth2Server({ model: this.model(resource), accessTokenLifetime: 3600, refreshTokenLifetime: 30 * 86400 });
  }
  async authorize(params: URLSearchParams, user: User, allowed: boolean) {
    const { scopes } = this.authorization(params);
    params.set("scope", scopes.join(" "));
    const request = new OAuth2Server.Request({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, query: {}, body: { ...Object.fromEntries(params), allowed: allowed ? "true" : "false" } });
    const response = new OAuth2Server.Response();
    try {
      await this.server(this.resource).authorize(request, response, { authorizationCodeLifetime: 300, allowEmptyState: true, authenticateHandler: { handle: async () => user } });
    } catch (error) {
      if (!response.headers?.location) throw error;
    }
    return String(response.headers?.location);
  }
  async token(params: URLSearchParams, headers: Record<string, string>) {
    this.accounts.throttle("oauth:token", 200);
    if (params.get("resource") !== this.resource) throw new Error("Invalid resource");
    if (!["authorization_code", "refresh_token"].includes(params.get("grant_type") || "")) throw new Error("Unsupported grant type");
    const response = new OAuth2Server.Response();
    const request = new OAuth2Server.Request({ method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(params.toString())) }, query: {}, body: Object.fromEntries(params) });
    await this.server(this.resource).token(request, response, { requireClientAuthentication: { authorization_code: false, refresh_token: false }, alwaysIssueNewRefreshToken: true });
    return response.body;
  }
}
