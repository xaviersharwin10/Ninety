// A stand-in for the host's plugin SDK: the real one is the running mm CLI, which a test doesn't
// load. Only what the plugin's library code touches at runtime.
export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}
export const InputFieldType = { Text: "text", Select: "select", Boolean: "boolean" } as const;
