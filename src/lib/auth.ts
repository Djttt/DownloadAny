const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "")
  ?? "http://127.0.0.1:8000";

const SESSION_KEY = "downloadany.auth.session";

export interface AuthUser {
  id: number;
  email: string;
  emailVerified: boolean;
}

interface ApiUser {
  id: number;
  email: string;
  email_verified: boolean;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string | null;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

let session = readSession();

function readSession(): StoredSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) as StoredSession : null;
  } catch {
    return null;
  }
}

function saveSession(tokens: TokenResponse): void {
  session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session?.refreshToken ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

function userFromApi(user: ApiUser): AuthUser {
  return { id: user.id, email: user.email, emailVerified: user.email_verified };
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item))
      .join("；");
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : fallback;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new Error("无法连接登录服务，请检查服务是否已启动");
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, `请求失败 (${response.status})`));
  return body as T;
}

async function acceptTokens(tokens: TokenResponse): Promise<AuthUser> {
  saveSession(tokens);
  try {
    return await meWithToken(tokens.access_token);
  } catch (error) {
    clearSession();
    throw error;
  }
}

async function meWithToken(token: string): Promise<AuthUser> {
  return userFromApi(await request<ApiUser>("/api/auth/me", {}, token));
}

export async function loginWithPassword(email: string, password: string): Promise<AuthUser> {
  const tokens = await request<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return acceptTokens(tokens);
}

export async function register(email: string, password: string): Promise<string> {
  const result = await request<{ message: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return result.message;
}

export async function resendVerification(email: string): Promise<string> {
  const result = await request<{ message: string }>("/api/auth/verification/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.message;
}

// 验证成功后端当场签发登录令牌：验证即登录。
export async function verifyEmailCode(email: string, code: string): Promise<AuthUser> {
  const tokens = await request<TokenResponse>("/api/auth/verification/code", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  return acceptTokens(tokens);
}

export async function forgotPassword(email: string): Promise<string> {
  const result = await request<{ message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.message;
}

export async function resetPasswordByEmailCode(email: string, code: string, newPassword: string): Promise<string> {
  const result = await request<{ message: string }>("/api/auth/reset-password/code", {
    method: "POST",
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
  return result.message;
}

export async function loginWithGoogle(credential: string): Promise<AuthUser> {
  const tokens = await request<TokenResponse>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  return acceptTokens(tokens);
}

export async function restoreUser(): Promise<AuthUser | null> {
  if (!session) return null;
  try {
    if (session.expiresAt > Date.now() + 30_000) return await meWithToken(session.accessToken);
    if (!session.refreshToken) throw new Error("No refresh token");
    const tokens = await request<TokenResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    return await acceptTokens(tokens);
  } catch {
    clearSession();
    return null;
  }
}

export async function logout(): Promise<void> {
  const token = session?.accessToken;
  clearSession();
  if (!token) return;
  await request<{ message: string }>("/api/auth/logout", { method: "POST" }, token).catch(() => {});
}

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
