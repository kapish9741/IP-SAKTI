/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0b0d11",
        card: "#12151b",
        "card-hover": "#171b23",
        wireframe: "#272c38",
        "wireframe-bright": "#3f4657",
        prose: "#f3f4f6",
        subtext: "#9ca3af",
        muted: "#64748b",
        citation: "#1b253b",
        "citation-text": "#93c5fd",
        ambernotice: "#231b0e",
        "ambernotice-border": "#b45309",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
