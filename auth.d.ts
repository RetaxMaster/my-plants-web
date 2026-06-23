// Module augmentation for nuxt-auth-utils.
// `User` is serialized to the client; `SecureSessionData` stays server-only
// (the JWT lives here so it never reaches the browser).
declare module '#auth-utils' {
  interface User {
    username: string;
    role: 'USER' | 'ADMIN';
  }

  interface SecureSessionData {
    token: string;
  }

  // The admin impersonation target. Top-level (not secure) so the client banner can read it via
  // useUserSession().session. Absent/null = not impersonating.
  interface UserSession {
    actingAs?: { ownerId: string; label: string } | null;
  }
}

export {};
