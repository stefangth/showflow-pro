export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      message ??
        `Assertion failed: expected ${format(actual)} to equal ${
          format(expected)
        }`,
    );
  }
}

export function assertExists<T>(
  actual: T,
  message?: string,
): asserts actual is NonNullable<T> {
  if (actual === null || actual === undefined) {
    throw new Error(message ?? "Assertion failed: expected value to exist");
  }
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;

  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length &&
      actual.every((value, index) => deepEqual(value, expected[index]));
  }

  if (isRecord(actual) && isRecord(expected)) {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return deepEqual(actualKeys, expectedKeys) &&
      actualKeys.every((key) => deepEqual(actual[key], expected[key]));
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function format(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
