import type { Config } from "tailwindcss";

const bannedNeutralFamilies = ["gray", "slate", "zinc", "neutral", "stone"] as const;
const bannedNeutralPrefixes = ["text", "bg", "border", "ring", "divide", "placeholder"] as const;
const neutralShades = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
const breakpointVariants = ["", "sm:", "md:", "lg:", "xl:", "2xl:"] as const;
const stateVariants = ["", "hover:", "focus:", "focus-visible:", "active:", "disabled:", "group-hover:", "dark:", "dark:hover:", "dark:focus:"] as const;
const opacitySuffixes = ["", "/5", "/10", "/15", "/20", "/25", "/30", "/40", "/50", "/60", "/70", "/75", "/80", "/90", "/95"] as const;

const bannedNeutralClassPattern =
  /^(?:hover:|focus:|focus-visible:|active:|disabled:|group-hover:|dark:)*(?:text|bg|border|ring|divide|placeholder)-(?:gray|slate|zinc|neutral|stone)-/;

const variants = breakpointVariants.flatMap((breakpoint) =>
  stateVariants.map((state) => `${breakpoint}${state}`),
);

const blocklist = variants.flatMap((variant) =>
  bannedNeutralPrefixes.flatMap((prefix) =>
    bannedNeutralFamilies.flatMap((family) =>
      neutralShades.flatMap((shade) =>
        opacitySuffixes.map((opacity) => `${variant}${prefix}-${family}-${shade}${opacity}`),
      ),
    ),
  ),
);

if (!blocklist.every((candidate) => bannedNeutralClassPattern.test(candidate.replace(/^(?:sm|md|lg|xl|2xl):/, "")))) {
  throw new Error("HiveRunner neutral blocklist generation drifted from the banned class pattern.");
}

export default {
  blocklist,
} satisfies Config;
