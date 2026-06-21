const PUBLIC = [/^\/login$/, /^\/blog$/, /^\/blog\/.+$/];

export default defineNuxtRouteMiddleware((to) => {
  if (PUBLIC.some((re) => re.test(to.path))) return;
  const { loggedIn } = useUserSession();
  if (!loggedIn.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }
});
