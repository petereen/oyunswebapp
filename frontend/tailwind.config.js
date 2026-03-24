/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary Brand
        maroon: {
          50: "#EFF4FF",
          100: "#DBE6FE",
          200: "#BFCFFE",
          300: "#93AAFD",
          400: "#6080FA",
          500: "#3B5FF5",
          600: "#1D4ED8",  // Primary Blue — flagship
          700: "#1A44B8",  // Deep Blue — pressed states
          800: "#1B3A96",
          900: "#1B3276",
        },
        gold: {
          50: "#FFFBEB",
          100: "#FFF3C4",
          200: "#FFE588",
          300: "#FFD54F",
          400: "#FFCC33",  // Goldenrod — accent
          500: "#F5B800",
          600: "#D9A000",
          700: "#B38300",
          800: "#8C6700",
          900: "#664A00",
        },
        ivory: {
          50: "#FAFAF6",
          100: "#F5F4EE",
          200: "#E6E0D2",  // Ivory — warm bg
          300: "#D5D0C2",
          400: "#C4BEB0",
        },
        sky: {
          300: "#A8D4D8",
          400: "#89BDC1",  // Sky Blue Accent
          500: "#6AA9AE",
          600: "#4F9299",
        },
        dark: {
          600: "#333333",  // Charcoal Gray
          700: "#2A2A2A",
          800: "#1A1A1A",  // Soft Black
          900: "#111111",
          950: "#0A0A0A",
        },
        surface: {
          50: "#FAFAF6",   // Warm ivory-tinted
          100: "#F5F4EE",
          200: "#E6E0D2",  // Ivory
        },
        silver: "#D5D6D2", // Silver Cloud — dividers
      },
      boxShadow: {
        "card-xs": "0 1px 3px rgba(0,0,0,0.04)",
        card: "0 4px 20px rgba(0,0,0,0.06)",
        "card-md": "0 8px 30px rgba(0,0,0,0.08)",
        "card-lg": "0 12px 40px rgba(0,0,0,0.12)",
        "card-dark": "0 12px 40px rgba(0,0,0,0.3)",
        nav: "0 -4px 24px rgba(0,0,0,0.06)",
        "nav-dark": "0 -4px 24px rgba(0,0,0,0.3)",
        btn: "0 4px 14px rgba(29,78,216,0.25)",
        "btn-success": "0 4px 14px rgba(34,197,94,0.3)",
        "btn-danger": "0 4px 14px rgba(244,63,94,0.3)",
        "btn-gold": "0 4px 14px rgba(255,204,51,0.35)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
        pulse2: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease-out",
        slideUp: "slideUp 0.4s ease-out",
        scaleIn: "scaleIn 0.25s ease-out",
        shimmer: "shimmer 2s infinite linear",
        pulse2: "pulse2 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
