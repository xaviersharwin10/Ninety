import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceUrl } from "@/lib/service-url";

afterEach(() => vi.unstubAllGlobals());

describe("serviceUrl", () => {
  it("leaves a full URL alone", () => {
    expect(serviceUrl("http://localhost:8082", "http://internal:1", "http")).toBe(
      "http://localhost:8082",
    );
  });

  it("puts a path under the address the browser loaded the app from", () => {
    vi.stubGlobal("window", { location: { origin: "https://ninety.example" } });
    expect(serviceUrl("/md", "http://localhost:8082", "http")).toBe("https://ninety.example/md");
    expect(serviceUrl("/relay", "ws://localhost:8081", "ws")).toBe("wss://ninety.example/relay");
  });

  it("uses the internal address on the server", () => {
    expect(serviceUrl("/md", "http://localhost:8082", "http")).toBe("http://localhost:8082");
  });
});
