import { invoke } from "@/lib/transport";

export type ManagedAuthProvider = "github_copilot" | "codex_oauth";

export interface ManagedAuthAccount {
  id: string;
  provider: ManagedAuthProvider;
  login: string;
  avatar_url: string | null;
  authenticated_at: number;
  is_default: boolean;
}

export interface ManagedAuthStatus {
  provider: ManagedAuthProvider;
  authenticated: boolean;
  default_account_id: string | null;
  migration_error?: string | null;
  accounts: ManagedAuthAccount[];
}

export interface ManagedAuthDeviceCodeResponse {
  provider: ManagedAuthProvider;
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function authStartLogin(
  authProvider: ManagedAuthProvider,
): Promise<ManagedAuthDeviceCodeResponse> {
  return invoke<ManagedAuthDeviceCodeResponse>("auth_start_login", {
    authProvider,
  });
}

export async function authPollForAccount(
  authProvider: ManagedAuthProvider,
  deviceCode: string,
): Promise<ManagedAuthAccount | null> {
  return invoke<ManagedAuthAccount | null>("auth_poll_for_account", {
    authProvider,
    deviceCode,
  });
}

export async function authListAccounts(
  authProvider: ManagedAuthProvider,
): Promise<ManagedAuthAccount[]> {
  return invoke<ManagedAuthAccount[]>("auth_list_accounts", {
    authProvider,
  });
}

export async function authGetStatus(
  authProvider: ManagedAuthProvider,
): Promise<ManagedAuthStatus> {
  return invoke<ManagedAuthStatus>("auth_get_status", {
    authProvider,
  });
}

export async function authRemoveAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
): Promise<void> {
  return invoke("auth_remove_account", {
    authProvider,
    accountId,
  });
}

export async function authSetDefaultAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
): Promise<void> {
  return invoke("auth_set_default_account", {
    authProvider,
    accountId,
  });
}

export async function authLogout(
  authProvider: ManagedAuthProvider,
): Promise<void> {
  return invoke("auth_logout", {
    authProvider,
  });
}

// Web mode auth API - uses direct HTTP fetch to avoid WebSocket chicken-and-egg problem
// (WebSocket requires auth, but auth check needs to happen before WebSocket connects)

const API_BASE = import.meta.env.VITE_CLI_MEMORY_API_BASE || "/api";

export interface AuthStatusResponse {
  enabled: boolean;
}

export interface LoginResponse {
  success: boolean;
  error?: string;
}

export interface SessionCheckResponse {
  valid: boolean;
}

async function authInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // Include cookies
    body: JSON.stringify({ command, payload }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Auth invoke failed for ${command}`);
  }

  const json = JSON.parse(text);
  if (json.error) {
    throw new Error(json.error);
  }
  return json.result as T;
}

export const webAuthApi = {
  async checkStatus(): Promise<AuthStatusResponse> {
    return await authInvoke<AuthStatusResponse>("auth.status", {});
  },

  async login(password: string): Promise<LoginResponse> {
    return await authInvoke<LoginResponse>("auth.login", { password });
  },

  async checkSession(): Promise<SessionCheckResponse> {
    return await authInvoke<SessionCheckResponse>("auth.check", {});
  },
};

export const authApi = {
  authStartLogin,
  authPollForAccount,
  authListAccounts,
  authGetStatus,
  authRemoveAccount,
  authSetDefaultAccount,
  authLogout,
};
