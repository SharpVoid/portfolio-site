# Main page image sources

Approved Figma section: https://www.figma.com/design/vFTcyblQsYZByxDXdSpH2C?node-id=841-12061

All images are individual cover assets exported by Figma, never whole-page screenshots.

| Asset | Desktop node | Mobile node |
| --- | --- | --- |
| FocusML | 841:12091 | 841:12141 |
| Банк «Доверие» | 841:12097 | 841:12147 |
| Дизайн-арена | 841:12103 | 841:12153 |
| АтомРепорт | 841:12108 | 841:12159 |

The complete image fills are used where a node export includes external shadows or would bake in a narrow crop. The bank desktop is the individual cover export. CSS applies the approved corner radii and shadows. Full phone cover images are sized by height, preserving phone scale between viewport sizes.

FocusML uses separate desktop and mobile/tablet art through picture sources. Its desktop object position interpolates between the 1440 and 1920 compositions. The mobile/tablet source also reproduces the 768 frame.

ProjectCard uses Astro getImage to generate AVIF and WebP at build time, limiting source dimensions to the resolution required by these covers. The shipped page does not request Figma or original PNGs. Temporary Figma asset URLs are deliberately not retained.
