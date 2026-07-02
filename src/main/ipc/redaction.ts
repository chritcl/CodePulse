const redactedPath = "%REDACTED_PATH%";
const redactedSecret = "%REDACTED_SECRET%";

const windowsPathPattern = /[A-Za-z]:(?:\\\\|\\)[^"',}\]\r\n]*/g;
const jsonSecretPattern =
  /("[^"]*(?:api[_-]?key|token|secret|password|authorization)[^"]*"\s*:\s*")([^"]*)(")/gi;
const envSecretPattern =
  /(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\s*=\s*)([^\s"',}]+)/gi;
const commandSecretPattern =
  /((?:--?|\/)(?:api[-_]?key|token|secret|password|authorization)(?:=|\s+))("[^"]*"|'[^']*'|[^\s"',}]+)/gi;
const authorizationPattern = /(\bAuthorization\s*[:=]\s*(?:Bearer\s+)?)([^\s"',}]+)/gi;

export const redactDiagnosticText = (text: string): string =>
  text
    .replace(jsonSecretPattern, `$1${redactedSecret}$3`)
    .replace(envSecretPattern, `$1${redactedSecret}`)
    .replace(commandSecretPattern, `$1${redactedSecret}`)
    .replace(authorizationPattern, `$1${redactedSecret}`)
    .replace(windowsPathPattern, redactedPath);
