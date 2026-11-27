import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#FAF6EE",
        ink: "#1F2A24",
        inkSoft: "#4A5550",
        saffron: "#C7660A",
        saffronDeep: "#9E5006",
        card: "#FFFFFF",
        line: "#E7DFCE",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Noto Sans",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
