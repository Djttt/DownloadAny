const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "")
  ?? "http://127.0.0.1:8000";

const SESSION_KEY = "downloadany.auth.session";

export interface AuthUser {
  id: number;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
}

interface ApiUser {
  id: number;
  email: string;
  email_verified: boolean;
  has_password: boolean;
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

/** 供非关键的统计请求关联登录用户；统计失败不能影响认证流程。 */
export function currentAccessToken(): string | undefined {
  return session?.accessToken;
}

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
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified,
    hasPassword: user.has_password,
  };
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

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// 后端以 428 要求人机验证：拉取算术题后抛给 UI 渲染。
export class CaptchaRequiredError extends Error {
  constructor(readonly captchaId: string, readonly question: string) {
    super("需要有效的验证码");
  }
}

export interface LoginCaptcha {
  id: string;
  answer: string;
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
  if (!response.ok) throw new ApiError(errorMessage(body, `请求失败 (${response.status})`), response.status);
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

export async function loginWithPassword(email: string, password: string, captcha?: LoginCaptcha): Promise<AuthUser> {
  try {
    const tokens = await request<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, captcha_id: captcha?.id, captcha_answer: captcha?.answer }),
    });
    return acceptTokens(tokens);
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 428) {
      const challenge = await request<{ captcha_id: string; question: string }>("/api/auth/captcha");
      throw new CaptchaRequiredError(challenge.captcha_id, challenge.question);
    }
    throw reason;
  }
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

export async function sendLoginCode(email: string): Promise<string> {
  const result = await request<{ message: string }>("/api/auth/login/code/send", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.message;
}

export async function loginWithCode(email: string, code: string): Promise<AuthUser> {
  const tokens = await request<TokenResponse>("/api/auth/login/code", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  return acceptTokens(tokens);
}

export async function loginWithGoogle(authorization: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<AuthUser> {
  const tokens = await request<TokenResponse>("/api/auth/google/code", {
    method: "POST",
    body: JSON.stringify({
      code: authorization.code,
      code_verifier: authorization.codeVerifier,
      redirect_uri: authorization.redirectUri,
    }),
  });
  return acceptTokens(tokens);
}

export async function changePassword(currentPassword: string | null, newPassword: string): Promise<string> {
  if (!session) throw new Error("登录状态已失效，请重新登录");
  const result = await request<{ message: string }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }, session.accessToken);
  return result.message;
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
