# Slide Design Specifications

## Dimensions
Post  (carousel): 1080 × 1080px
Story (carousel): 1080 × 1920px
Phase 1 builds post size only.

## Grid & Spacing
Outer padding : 72px all sides
Content width : 936px (1080 - 144)
Row gap       : 24px
Section gap   : 48px

## Typography Scale (Post 1080×1080)
Cover headline    : 64px, Noto Serif JP, weight 500, line-height 1.2
Content headline  : 52px, Noto Serif JP, weight 400, line-height 1.2
CTA headline      : 44px, Noto Serif JP, weight 400, line-height 1.2, max one line
Subtext           : 22px, DM Sans, weight 300, line-height 1.6
Body              : 26px, DM Sans, weight 300, line-height 1.65
Tag / Label       : 15px, DM Mono, letter-spacing 0.25em, uppercase
Slide number      : 56px, DM Mono, weight 400, saffron, visual anchor
Handle            : 20px, DM Mono, all slides

Note: Google Fonts import must explicitly include weight 500 for Noto Serif JP.
      Use: family=Noto+Serif+JP:wght@300;400;500 in the CDN URL.

## Content Width Constraints
Headline max-width : 936px
Body max-width     : 780px
CTA headline       : 936px but font size keeps it single line

## Accent Line
Width  : 40px
Height : 3px
Color  : saffron (#D4860A) on educator and quicklist
Color  : moss (#4A5240) on challenger
Margin : appears above headline, 16px gap below line

## Slide Structure Per Type

### cover
TOP    → accent line + tag label
MIDDLE → headline (large) + subtext
BOTTOM → @handle

### content
TOP    → slide number (saffron, large) + thin divider
MIDDLE → headline + body text
BOTTOM → @handle
Saffron horizontal rule: width 100% of content area,
height 1px exactly. Use width: 100% not fixed pixels.

### cta
TOP    → accent line
MIDDLE → headline + subline
BOTTOM → @handle (saffron color)

## Slide Layout Positions

### cover
- Tag + accent line : top-left, 72px from top edge
- Headline block    : vertically centered at 45% of slide height
- Subtext           : 24px below headline
- Handle            : 72px from bottom edge

### content
- Content block     : entire block (number + rule + headline + body) vertically centered
                      in the space between the top zone and handle using flexbox
- Slide number      : top of the content block — not the top of the slide
- Saffron rule      : 1px horizontal line, full content width (936px), 16px below slide number
- Headline          : 48px below saffron rule
- Body text         : 24px below headline
- Handle            : pinned 72px from bottom edge, outside the content block
- Rule width        : 100% of content area — use width: 100% on the rule element,
                      not a fixed pixel value. Height: 1px exactly.
- Slide number gap  : 12px fixed between slide number and saffron rule.
                      Use margin-bottom: 12px on the slide number element.

### cta
- Accent line       : top-left, 72px from top edge (top zone, standalone)
- Content block     : headline + subline at true vertical center of slide using flexbox
- Headline          : single line max
- Subline           : 24px below headline
- Handle            : pinned 72px from bottom edge, saffron color

## Layout Implementation Rules

Proven pattern for Puppeteer Chromium rendering.
Use position absolute on all zones, not flexbox
on the slide container.

Slide container : position relative, 1080x1080px,
                  background color per template
Top zone        : position absolute, top 72px, left 72px
Middle zone     : position absolute, top 160px,
                  bottom 120px, left 72px, right 72px,
                  display flex, flex-direction column,
                  align-items flex-start
Inner content   : margin auto 0 on a wrapper div
                  inside middle zone
Bottom zone     : position absolute, bottom 72px,
                  left 72px

Never use flexbox justify-content on the slide container.
Never use margin-top auto on zone elements directly.

## Template-Specific Rules

### educator (bg: #FAFAFA)
- Accent line: saffron
- Slide number: saffron
- Tag label color: saffron #D4860A
- Headline: ink (#1C1C1E)
- Body: ink-soft (#3A3A3C)
- Handle: ink-muted (#8E8E93)

### challenger (bg: #EDE9E1)
- Accent line: moss (#4A5240)
- Slide number: moss
- Tag label color: moss #4A5240
- Headline: ink (#1C1C1E)
- Body: ink-soft (#3A3A3C)
- Handle: ink-muted (#8E8E93)

### quicklist (bg: #4A5240)
- Accent line: saffron
- Slide number: saffron (extra large, decorative)
- Tag label color: saffron #D4860A
- Headline: #FAFAFA (white)
- Body: #EDE9E1 (warm white)
- Handle: saffron (#D4860A)

## Puppeteer Render Settings
viewport          : 1080 × 1080
deviceScaleFactor : 1
                    deviceScaleFactor 2 causes absolute positioning offset in
                    Puppeteer Chromium. 1x is correct and sufficient for
                    Instagram 1080x1080.
format            : PNG
fullPage          : false