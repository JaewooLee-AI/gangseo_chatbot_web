import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "canvas-ivory": "#FFF8F0",
        "deep-umber": "#3A2E24",
        "warm-brick": "#D9534F",
        "ui-sand": "#EFE6DD",
        "ui-stone": "#D1C7BD",
        "paper-bg": "#FFF8F0",
        "charcoal-text": "#3A2E24",
        "brick-accent": "#D9534F",
        "olive-accent": "#4A5D23",
        "safety-orange": "#FF944C",
        "surface-container-low": "#FFF1E8",
        "surface-container": "#FBEBE1",
        "surface-container-high": "#F5E5DB",
        "surface-container-highest": "#EFE0D5",
        "surface-dim": "#E6D7CD",
        "surface-bright": "#FFF8F5",
        "surface-tint": "#6A5C50",
        "outline-variant": "#D1C4BC",
        "outline": "#7F756E",
        "primary-container": "#3A2E24",
        "secondary": "#AC3231",
      },
      fontFamily: {
        pretendard: ["Pretendard", "sans-serif"],
        "headline-sm": ["Pretendard", "sans-serif"],
        "headline-md": ["Pretendard", "sans-serif"],
        "headline-lg": ["Pretendard", "sans-serif"],
        "display-lg": ["Pretendard", "sans-serif"],
        "label-md": ["Pretendard", "sans-serif"],
        "label-lg": ["Pretendard", "sans-serif"],
        "body-sm": ["Pretendard", "sans-serif"],
        "body-md": ["Pretendard", "sans-serif"],
        "body-lg": ["Pretendard", "sans-serif"],
      },
      fontSize: {
        "headline-sm": ["20px", { lineHeight: "1.4", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        "headline-lg": ["32px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-lg": ["48px", { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "700" }],
        "label-md": ["12px", { lineHeight: "1.2", letterSpacing: "0.04em", fontWeight: "500" }],
        "label-lg": ["14px", { lineHeight: "1.2", letterSpacing: "0.02em", fontWeight: "600" }],
        "body-sm": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
      },
      spacing: {
        "touch-target-min": "56px",
        "margin-mobile": "24px",
        "gutter-mobile": "16px",
        "container-margin": "32px",
        gutter: "16px",
      },
    },
  },
  plugins: [],
};

export default config;

