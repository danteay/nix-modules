import { expect, test } from "bun:test"
import { protectedPrompt } from "../lib/paths"

test("env exclusion matches env files but not direnv or devenv names", () => {
  for (const path of [
    ".env",
    ".env.local",
    "config.env",
    "deploy/.env.prod",
    "secrets/auth/dev.ejson",
  ])
    expect(protectedPrompt(`Read ${path}`)).toBe(true)
  for (const path of [".envrc", "devenv.nix", "devenv.lock", "env/config.go", "environment.ts"])
    expect(protectedPrompt(`Read ${path}`)).toBe(false)
})

test("a diff summary that lists .envrc is a valid decide state", () => {
  expect(protectedPrompt("git status:\n M .envrc\n M devenv.nix\n M config/app.go")).toBe(false)
})
