# Hermes renderer regression fixture

`hermes-math.html` was generated from the synthetic `hermes-math.md` using the official Desktop baseline `ac28abc96c`: `preprocessMarkdown`, `tailBoundedRemend`, `parseMarkdownIntoBlocksCached`, `remarkSoftBreaks`, `createMemoizedMathPlugin`, and `StreamdownTextPrimitive` (react-streamdown 0.3.5), rendered with React's static renderer.

This snapshot exercises the actual Streamdown/math DOM instead of only a generic remark fixture. The isolated generation harness stubbed media helpers (no media appears in this fixture) and used a quiet HR component. It did not render the entire application, a live streaming response, or an OS clipboard. The live-window regression separately tested current visible bodies with synthetic copy events.

The passage is synthetic; no conversation history, profile names, session ids, or private user message is committed.

`hermes-fallback-math.md` / `.html` use the same unmodified upstream pipeline. They cover the CJK single-dollar escaping rule (including bracket normalization), valid Chinese display math, malformed inline/display KaTeX error spans, escaped punctuation, repeated formulas with different markers, and table cells. Chinese inside math is not inherently invalid: the baseline preprocesses CJK inline math as prose, while valid display math can render normally.

`hermes-media-images.md` and the loading/ready/failed HTML snapshots contain synthetic MEDIA image delivery and surrounding prose/code. Generated against upstream e06df9c2eae6901f4c88f464e0ae6e753c0428b8 using renderMediaTags, preprocessing, Streamdown, math/table/code components, the unchanged MarkdownImageContent render-function excerpt and ZoomableImage. Image state hooks, actions, i18n and stores were isolated; no image files or network were read. The ready snapshot has dummy data URL bytes, which cannot prove the original path. These are isolated renderer checks, not live keyboard/clipboard acceptance.

`hermes-media-file.md` / `.html` cover a standalone script MEDIA directive, prose, code and table cells. Generated with the same upstream e06df9c pipeline plus actual PreviewAttachment; actions, i18n and stores are isolated, no delivered file is read or executed. Addresses are synthetic example.com values.
