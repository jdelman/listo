export const E2E_PORT = 3100;
export const E2E_PASSWORD = "disposable-browser-test-password";
export const E2E_HOSTS = ["localhost", "127.0.0.1", "jdsrv", "jdsrv.local"];
export const usernameFor = (host: string) => `browser_${host.replaceAll(".", "_")}`;
