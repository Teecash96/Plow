# Accessibility audits

The project includes a Playwright Test audit runner with axe core. It checks the rendered accessibility tree, labels, keyboard semantics, contrast rules, and common WCAG violations.

## Run the audit

Install the Chromium browser once on a new machine:

```bash
npx playwright install chromium
```

Run all audits:

```bash
npm run a11y
```

Run with a visible browser:

```bash
npm run a11y:headed
```

Run the token level contrast check:

```bash
npm run a11y:contrast
```

Run both checks before a release:

```bash
npm run a11y
npm run a11y:contrast
```

The Playwright suite starts the Next.js development server automatically. It covers the homepage, agent browse, agent detail, hire wizard, jobs list, and a populated local job detail state. The `color-contrast` axe rule is explicitly enabled for every route. Demo data is used so the audit does not depend on wallet access or a live hire configuration.

## Reading results

Each failure includes the axe rule, impact, affected selector, explanation, and a link to the suggested fix. Treat `critical` and `serious` findings as release blockers. Review `moderate` and `minor` findings before submission, especially if they affect keyboard navigation, labels, focus visibility, or status announcements.

The audit is intentionally separate from production code. It does not change the hiring flow, registry data, or production bundle.

The token checker reads the core palette from `src/app/globals.css`, checks semantic status outlines, borders, the CTA outline, and the focus ring, then exits with a failure code if any ratio is below its threshold. Normal text uses 4.5:1. Large text and UI boundaries use 3:1.

## Contrast token review

The dark palette was reviewed against WCAG 2.2 Level AA. The main ratios are:

| Pair | Ratio |
| --- | ---: |
| Foreground `#f4f4f5` on background `#000000` | 19.11:1 |
| Muted `#9b9b9b` on surface `#181818` | 6.39:1 |
| Brand `#f0b90b` on background `#000000` | 11.65:1 |
| Positive `#39c98a` on success surface `#10271f` | 7.43:1 |
| Warning `#f2b84b` on warning surface `#211d0d` | 9.42:1 |
| Negative `#f06c6c` on error surface `#281313` | 5.92:1 |
| Surface border `#6a6a6a` on surface `#181818` | 3.28:1 |
| Positive outline `#5a9876` on success surface `#10271f` | 4.65:1 |
| Warning outline `#9a843c` on warning surface `#211d0d` | 4.61:1 |
| Negative outline `#ad6565` on error surface `#281313` | 4.05:1 |
| CTA outline `#82660a` on CTA surface `#131209` | 3.45:1 |
| Pre reveal hero text `#767676` on background `#000000` | 4.62:1 |
| Focus ring brand `#f0b90b` on surface `#181818` | 9.85:1 |

The surface border changed from `#313131` to `#6a6a6a`. Status outlines now use higher contrast values: positive `#5a9876`, warning `#9a843c`, and negative `#ad6565`. The homepage CTA outline uses solid `#82660a` instead of a translucent yellow border. The pre reveal hero text uses `#767676`, which remains readable during animation.

Disabled controls retain their subdued treatment. Their text is not used as the only status signal, and WCAG provides an exception for inactive controls.
