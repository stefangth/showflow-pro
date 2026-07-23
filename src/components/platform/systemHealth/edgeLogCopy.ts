export function edgeLogUnavailableMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? `Log lines unavailable: ${error.message}`
    : "Log lines unavailable.";
}
