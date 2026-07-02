import { describe, expect, it } from "vitest";
import { redactDiagnosticText } from "./redaction";

describe("诊断导出脱敏", () => {
  it("会移除用户目录、项目路径、密钥、Token 和敏感命令参数", () => {
    const raw = JSON.stringify(
      {
        projectPath: "C:\\Users\\fengq\\Desktop\\Work\\杂\\CodePulse",
        userHome: "C:\\Users\\fengq",
        command:
          "codex --api-key sk-live-secret --token ghp_secret_token --project C:\\Users\\fengq\\Desktop\\Work\\杂\\CodePulse",
        authorization: "Bearer eyJ.secret.payload",
        env: {
          OPENAI_API_KEY: "sk-env-secret",
          CODEX_TOKEN: "codex-env-token",
          PATH: "C:\\Users\\fengq\\bin"
        }
      },
      null,
      2
    );

    const redacted = redactDiagnosticText(raw);

    expect(redacted).not.toContain("fengq");
    expect(redacted).not.toContain("C:\\Users");
    expect(redacted).not.toContain("CodePulse");
    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).not.toContain("ghp_secret_token");
    expect(redacted).not.toContain("eyJ.secret.payload");
    expect(redacted).not.toContain("sk-env-secret");
    expect(redacted).not.toContain("codex-env-token");
    expect(redacted).toContain("%REDACTED_PATH%");
    expect(redacted).toContain("%REDACTED_SECRET%");
  });
});
