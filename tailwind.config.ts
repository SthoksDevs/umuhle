import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        plum: {
          DEFAULT: "#9B7FB8",
          light: "#F4EFF8",
          dark: "#7A5F99",
        },
        nude: {
          DEFAULT: "#C28070",
          muted: "rgba(194,128,112,0.28)",
        },
        forest: {
          DEFAULT: "#2B6B45",
          light: "#BFD3C7",
          pale: "#EAF4EE",
        },
        onyx: "#1A1A1A",
        surface: "#FAF1EE",
      },
      fontFamily: {
        display: ["Raleway", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
