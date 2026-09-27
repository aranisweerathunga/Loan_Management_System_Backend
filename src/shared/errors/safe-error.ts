type SafeError = {
  name?: string;
  code?: string;
  message: string;
};

function redactConnectionStrings(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]")
    .replace(/password=([^\s&]+)/gi, "password=[redacted]");
}

export function toSafeError(error: unknown): SafeError {
  if (!(error instanceof Error)) {
    return { message: "Unexpected error" };
  }

  const code =
    "code" in error && (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : undefined;

  return {
    name: error.name,
    code,
    message: redactConnectionStrings(error.message),
  };
}
