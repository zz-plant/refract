/**
 * The CLI's version, stamped into `--version`, the MCP handshake, and the
 * analyzer version recorded in every analysis and replay manifest.
 *
 * It was a literal in four files and all four said 0.5.14 while package.json
 * said 0.5.15, so every manifest recorded a version that had not produced it.
 * scripts/release.ts rewrites this line when it bumps the version, and
 * scripts/check-release.ts fails when it disagrees with package.json.
 */
export const REFRACT_VERSION = "0.6.1";
