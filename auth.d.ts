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
}

export {};
