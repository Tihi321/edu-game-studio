# EGS-67 Autoplay bot: optional layout check

From the HUB-28 discoveries: `scripts/play.mjs` `overflowCheck` only compared the document `scrollWidth` with `innerWidth`; clipped content and too-small taps were invisible to it.

`--layout` (off by default): `overflowCheck` (called by the bot on the title, the end screen and the screens the shell drivers name) also runs `layoutCheck`, which fails when a visible control (button, link, select, text field, a checkbox through its label) is under 44 x 44 px, lies outside the window sideways or is cut off by a clipping parent (overflow hidden/clip), or when a clipping box cuts its text off sideways. The failure names the first five per screen. Hidden, `aria-hidden`, `inert` and `.sr-only` elements and `text-overflow: ellipsis` boxes are ignored.

Test: the phone-size (375x667) perfect run of `tests/bot.e2e.test.ts` passes `--layout` on every golden fixture. Checked by hand that the flag fires: a build with `#edu-root button{height:20px}` fails with "layout at title: lang-en is 90x20px ...".
