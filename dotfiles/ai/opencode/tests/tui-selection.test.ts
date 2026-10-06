import { expect, test } from "bun:test"
import { routeFor } from "../lib/lifecycle"
import {
  type LocalSelection,
  localSelection,
  readSelection,
  selectLocal,
} from "../lib/tui-selection"

test("the versioned TUI adapter restores agent, model and variant together", () => {
  let agent = "bulk",
    model = { providerID: "opencode", modelID: "glm-5.3" },
    variant: string | undefined = "high"
  const local: LocalSelection = {
    agent: {
      current: () => ({ name: agent }),
      list: () => [{ name: "bulk" }, { name: "coordinator" }],
      set: (name) => {
        agent = name
      },
    },
    model: {
      current: () => model,
      set: (value) => {
        model = value
      },
      variant: {
        current: () => variant,
        set: (value) => {
          variant = value
        },
      },
    },
  }
  const owner = { context: { [Symbol("Local")]: local } }
  expect(localSelection(owner, "1.18.33")).toBe(local)
  selectLocal(local, routeFor("coordinator"))
  expect(readSelection(local)).toEqual({ ...routeFor("coordinator"), variant: undefined })
  expect(localSelection(owner, "1.18.34")).toBe(local)
  expect(() => localSelection(owner, "1.18.35")).toThrow("unverified")
  expect(() => localSelection({ context: {} }, "1.18.33")).toThrow("could not access")
  expect(() => selectLocal(local, routeFor("build"))).toThrow("cannot select")
})
