# Hermes renderer regression fixture

`hermes-math.html` was generated from the synthetic `hermes-math.md` using the official Desktop baseline `ac28abc96c`: `preprocessMarkdown`, `tailBoundedRemend`, `parseMarkdownIntoBlocksCached`, `remarkSoftBreaks`, `createMemoizedMathPlugin`, and `StreamdownTextPrimitive` (react-streamdown 0.3.5), rendered with React's static renderer.

This snapshot exercises the actual Streamdown/math DOM instead of only a generic remark fixture. The isolated generation harness stubbed media helpers (no media appears in this fixture) and used a quiet HR component. It did not render the entire application, a live streaming response, or an OS clipboard. The live-window regression separately tested current visible bodies with synthetic copy events.

The passage is synthetic; no conversation history, profile names, session ids, or private user message is committed.
