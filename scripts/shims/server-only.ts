/**
 * A stand-in for the `server-only` marker, used ONLY by the script runner.
 *
 * `server-only` is not an npm package here — Next resolves it inside its own bundler, where it
 * exists to make importing a server module from a client component a build error. Under `tsx` there
 * is no bundler, so the import fails to resolve and any module carrying the marker cannot be
 * loaded, which would put every service in this repository out of reach of a test script.
 *
 * The shim is wired up through `tsconfig.scripts.json` and is invisible to the application build,
 * so the real guarantee — server-only code cannot reach the client bundle — is untouched.
 */
export {}
