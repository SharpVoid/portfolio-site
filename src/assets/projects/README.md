# Main page image sources

Approved Figma section: https://www.figma.com/design/vFTcyblQsYZByxDXdSpH2C?node-id=1400-17787

All images are individual cover assets exported by Figma, never whole-page screenshots.

| Asset | Desktop node | Mobile node |
| --- | --- | --- |
| FocusML | 841:12091 | 841:12141 |
| Банк «Доверие» | 841:12097 | 841:12147 |
| Дизайн-арена | 841:12103 | 841:12153 |
| ConsulAI | 841:12108 | 841:12159 |

The complete image fills are used where a node export includes external shadows or would bake in a narrow crop. The bank desktop is the individual cover export. CSS applies the approved corner radii and shadows. Full phone cover images are sized by height, preserving phone scale between viewport sizes.

FocusML was updated on 2026-09-08 from user-supplied exports: `focusml-cover-rectanlge.png` and `focusml-cover-square.png` (stored under their original filenames). The approved references are the five `homepage-{width}.png` screenshots supplied in the conversation. Picture sources use the square composition at 390, 768 and 1440 px, and the rectangular composition at 1024 and 1920 px. Both use centered CSS cover cropping; the old desktop offset is no longer needed.

ProjectCard uses Astro getImage to generate AVIF and WebP at build time, limiting source dimensions to the resolution required by these covers. The shipped page does not request Figma or original PNGs. Temporary Figma asset URLs are deliberately not retained.

The homepage was updated on 2026-10-02 from section `1400:17787`, using frames `1396:2`, `1396:61`, `1396:121`, `1396:373`, and `1396:505`. The 2026 FocusML PNG sources match the wide image fill `363544c237bbff19f16835286fd7d0c8724f59e3` and narrow image fill `b394df9fb4753896f139fc088a2505063a4393ce`. The wide source is used at 1024, 1440, and 1920 px, with the approved crop at 1440 px; the narrow source is used at 390 and 768 px. The bank uses the full phone source at every size. The arena and ConsulAI reuse their desktop source across sizes.

